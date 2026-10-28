import assert from "node:assert/strict";
import { test } from "node:test";
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

const dbSecret = "reencrypt-test-db-secret-longer-than-thirty-two";
const dataKey = "reencrypt-test-data-key-longer-than-thirty-two!";
const legacyKey = (info: string) => Buffer.from(crypto.hkdfSync("sha256", dbSecret, "transferdesk-images-v1", info, 32));
const seal = (key: Buffer, bytes: Buffer) => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
  return { cipher: Buffer.concat([c.update(bytes), c.final()]).toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64") };
};

test("re-encryption moves legacy images and cards to APP_DATA_KEY and is idempotent", async () => {
  const image = Buffer.from("synthetic image bytes"), card = Buffer.from("synthetic card bytes");
  const tables: Record<string, any[]> = {
    referral_images: [{ id: 1, ...seal(legacyKey("private-clinical-images"), image) }],
    users: [{ id: 5, ...Object.fromEntries(Object.entries(seal(legacyKey("referrer-staff-cards"), card)).map(([k, v]) => [`card_${k}`, v])) }, { id: 6, card_cipher: null, card_iv: null, card_tag: null }],
  };
  const upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture.invalid"), table = url.pathname.split("/").pop()!;
    const ivCol = table === "users" ? "card_iv" : "iv", cipherCol = table === "users" ? "card_cipher" : "cipher";
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-app-secret"] !== dbSecret) { res.writeHead(401); return res.end("{}"); }
    if (req.method === "GET") {
      const after = Number(url.searchParams.get("id")?.replace("gt.", "") || 0);
      return res.end(JSON.stringify(tables[table].filter(r => r.id > after && r[cipherCol] !== null && !String(r[ivCol]).startsWith("v2:"))));
    }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const id = Number(url.searchParams.get("id")!.replace("eq.", "")), expectedIv = url.searchParams.get(ivCol)!.replace(/^eq\./, "");
    const row = tables[table].find(r => r.id === id);
    if (row && row[ivCol] === expectedIv) Object.assign(row, JSON.parse(raw));
    res.writeHead(204); res.end();
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const run = async (...args: string[]) => {
    const child = spawn(process.execPath, ["--import", "tsx", "script/reencrypt-data.ts", ...args], {
      env: { ...process.env, APP_DB_SECRET: dbSecret, APP_DATA_KEY: dataKey, SUPABASE_URL: `http://127.0.0.1:${(upstream.address() as any).port}`, SUPABASE_PUBLISHABLE_KEY: "fixture-key" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = ""; child.stdout.on("data", d => out += d); child.stderr.on("data", d => out += d);
    const [code] = await once(child, "exit"); return { code, out };
  };
  try {
    const dry = await run("--dry-run");
    assert.equal(dry.code, 0, dry.out); assert.match(dry.out, /Would re-encrypt 1 image\(s\) and 1 staff card\(s\)/);
    assert.ok(!tables.referral_images[0].iv.startsWith("v2:"), "dry run writes nothing");
    const real = await run();
    assert.equal(real.code, 0, real.out); assert.match(real.out, /Re-encrypted 1 image\(s\) and 1 staff card\(s\)/);
    process.env.APP_DB_SECRET = dbSecret; process.env.APP_DATA_KEY = dataKey;
    process.env.SUPABASE_URL = "https://example.supabase.co"; process.env.SUPABASE_PUBLISHABLE_KEY = "fixture-key";
    const { openBytes, dataKeys } = await import("../server/db");
    assert.ok(tables.referral_images[0].iv.startsWith("v2:"));
    assert.deepEqual(openBytes(tables.referral_images[0], dataKeys.image), image);
    const u = tables.users[0];
    assert.deepEqual(openBytes({ cipher: u.card_cipher, iv: u.card_iv, tag: u.card_tag }, dataKeys.card), card);
    assert.match((await run()).out, /Re-encrypted 0 image\(s\) and 0 staff card\(s\)/);
  } finally { await new Promise(resolve => upstream.close(resolve)); }
});
