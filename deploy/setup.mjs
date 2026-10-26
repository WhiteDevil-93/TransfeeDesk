// Temporary, token-protected credential handoff. Never logs request bodies.
import http from "node:http";
import crypto from "node:crypto";
import { readFile, writeFile, rename, access } from "node:fs/promises";

const origin = process.env.SETUP_ORIGIN;
const token = process.env.SETUP_TOKEN;
const expires = Number(process.env.SETUP_EXPIRES);
const dbUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const envPath = process.env.RUNTIME_ENV || "/var/lib/transferdesk/runtime.env";
if (!origin || !token || token.length < 40 || !expires || !dbUrl || !key) throw new Error("Setup configuration missing");
const expected = crypto.createHash("sha256").update(token).digest();
let busy = false;
let saved = false;
let attempts = [];

async function database(path, secret, method = "GET") {
  const response = await fetch(`${dbUrl}/rest/v1/${path}`, {
    method, headers: { apikey: key, "x-app-secret": secret, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: "{}" } : {}), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Database verification failed");
  return response.json();
}

const html = await readFile(new URL("setup.html", import.meta.url), "utf8");
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  const reply = (status, message) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message }));
  };
  try {
    if (saved || Date.now() > expires) return reply(410, "Setup link expired or already used.");
    try { await access(envPath); return reply(410, "Credentials already configured."); } catch (e) { if (e.code !== "ENOENT") throw e; }
    if (req.method === "GET" && req.url === "/setup") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'" });
      return res.end(html);
    }
    if (req.method !== "POST" || req.url !== "/setup/verify") return reply(404, "Not found");
    if (req.headers.origin !== origin) return reply(403, "Origin rejected");
    const received = crypto.createHash("sha256").update(String(req.headers["x-setup-token"] || "")).digest();
    if (!crypto.timingSafeEqual(received, expected)) return reply(403, "Setup link invalid");
    attempts = attempts.filter(t => Date.now() - t < 60000);
    if (busy || attempts.length >= 5) return reply(429, "Please try again in one minute.");
    attempts.push(Date.now());
    busy = true;
    try {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return reply(413, "Input too large");
      }
      const { secret } = JSON.parse(raw);
      if (typeof secret !== "string" || secret.length < 32 || secret.length > 2048 || /[\r\n\0]/.test(secret)) return reply(400, "Enter the original APP_DB_SECRET (at least 32 characters).");
      if (await database("rpc/is_app_server", "", "POST") !== false) return reply(409, "Database access policy needs review; nothing saved.");
      if (await database("rpc/is_app_server", secret, "POST") !== true) return reply(401, "This secret does not unlock the existing database. Nothing changed.");
      // Read only ciphertext for one existing image. Never return image contents.
      const images = await database("referral_images?select=cipher,iv,tag&limit=1", secret);
      let imageCheck = "No stored image was available to verify decryption.";
      if (images.length) {
        const imageKey = Buffer.from(crypto.hkdfSync("sha256", secret, "transferdesk-images-v1", "private-clinical-images", 32));
        const decipher = crypto.createDecipheriv("aes-256-gcm", imageKey, Buffer.from(images[0].iv, "base64"));
        decipher.setAuthTag(Buffer.from(images[0].tag, "base64"));
        decipher.update(Buffer.from(images[0].cipher, "base64"));
        decipher.final();
        imageCheck = "Existing image decryption verified.";
      }
      // JSON quoting is compatible with systemd EnvironmentFile double-quoted values.
      const env = Object.entries({ SUPABASE_URL: dbUrl, SUPABASE_PUBLISHABLE_KEY: key, APP_DB_SECRET: secret, HOST: "127.0.0.1", PORT: "5000", HPCSA_AUTO_REFRESH: "0", HPCSA_CHECKLIST: "/var/lib/transferdesk/hpcsa_surnames.txt", HPCSA_BULK_STATE: "/var/lib/transferdesk/hpcsa_bulk_state.json" })
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n") + "\n";
      await writeFile(`${envPath}.new`, env, { mode: 0o600, flag: "wx" });
      await rename(`${envPath}.new`, envPath);
      saved = true;
      console.log("Credentials verified and saved; " + imageCheck);
      reply(200, "Verified and saved securely. " + imageCheck + " Return to the chat to finish activation.");
    } finally { busy = false; }
  } catch {
    reply(502, "Verification could not complete. Nothing was changed in Supabase.");
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(Number(process.env.SETUP_PORT || 5001), "127.0.0.1", () => console.log("Temporary setup service ready on port " + server.address().port));
