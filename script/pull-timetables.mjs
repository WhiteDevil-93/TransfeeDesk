// Pull the CHBAH "Timetables" folder from Google Drive into ./timetables/ using the
// themyscira service-account key. No googleapis dependency — pure Node fetch + JWT.
// Usage: node script/pull-timetables.mjs
//   TIMETABLES_FOLDER  = Drive folder id (defaults to the CHBAH Timetables folder)
//   OUT_DIR            = local output dir (defaults to ./timetables under the project root)
//   KEY_FILE           = service-account key path (defaults to agent-workspace/themyscira-key.json)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const KEY_FILE = process.env.KEY_FILE || "C:/Users/anon3/agent-workspace/themyscira-key.json";
const FOLDER = process.env.TIMETABLES_FOLDER || "1Mj9g0ktkCwJya-w4wzAESBxqaC_Uy7cb";
const OUT_DIR = process.env.OUT_DIR || path.join(root, "timetables");

const key = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }

async function accessToken(scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: key.client_email, scope, aud: key.token_uri, iat: now, exp: now + 3600 };
  const jwt = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(claims));
  const sig = crypto.createSign("RSA-SHA256").update(jwt).sign(key.private_key, "base64");
  const tok = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + encodeURIComponent(jwt + "." + sig),
  }).then(r => r.json());
  if (tok.error) throw new Error("token: " + tok.error + " " + (tok.error_description || ""));
  return tok.access_token;
}

const AT = await accessToken("https://www.googleapis.com/auth/drive.readonly");
const hdr = { Authorization: "Bearer " + AT };

async function list(folderId, prefix = "") {
  let pageToken, items = [];
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,md5Checksum,size)&pageSize=1000${pageToken ? "&pageToken=" + pageToken : ""}`;
    const j = await fetch(url, { headers: hdr }).then(r => r.json());
    if (j.error) throw new Error("list: " + JSON.stringify(j.error));
    items = items.concat(j.files || []);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return items.map(f => ({ ...f, prefix }));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const all = await list(FOLDER);
let pdfs = 0, folders = 0;
const manifest = [];

for (const f of all) {
  if (f.mimeType === "application/vnd.google-apps.folder") {
    folders++;
    console.log(`[folder] ${f.name}  (skipping subfolder contents for now)`);
    continue;
  }
  if (f.mimeType !== "application/pdf") { console.log(`[skip] ${f.name}  (${f.mimeType})`); continue; }
  const exportUrl = `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`;
  const buf = Buffer.from(await (await fetch(exportUrl, { headers: hdr })).arrayBuffer());
  const safe = f.name.replace(/[^\w.\- ]+/g, "_");
  const dest = path.join(OUT_DIR, safe);
  fs.writeFileSync(dest, buf);
  pdfs++;
  manifest.push({ id: f.id, name: f.name, md5: f.md5Checksum, size: buf.length, local: safe });
  console.log(`[pdf] ${f.name}  ${buf.length}B`);
}

fs.writeFileSync(path.join(OUT_DIR, "_manifest.json"), JSON.stringify({ folderId: FOLDER, pulledAt: new Date().toISOString(), files: manifest }, null, 2));
console.log(`\nDONE: ${pdfs} PDFs + ${folders} subfolder(s) → ${OUT_DIR}`);
