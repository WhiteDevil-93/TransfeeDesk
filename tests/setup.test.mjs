import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

test("credential handoff rejects unauthorized attempts and preserves existing image encryption", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "transferdesk-setup-test-"));
  const secret = crypto.randomBytes(32).toString("hex");
  const token = crypto.randomBytes(32).toString("hex");
  const origin = "https://setup-test.invalid";
  const imageKey = Buffer.from(crypto.hkdfSync("sha256", secret, "transferdesk-images-v1", "private-clinical-images", 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", imageKey, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from("synthetic image, no clinical data")), cipher.final()]);
  let invalidImage = false;
  let openPolicies = false;
  let writes = 0;
  const upstream = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/rest\/v1\/(users|referrals|sessions)\?/.test(req.url) && !req.headers["x-app-secret"]) {
      return res.end(JSON.stringify(openPolicies ? [{ id: 1 }] : []));
    }
    if (req.url === "/rest/v1/rpc/is_app_server" && req.method === "POST") {
      return res.end(JSON.stringify(req.headers["x-app-secret"] === secret));
    }
    if (req.method !== "GET") writes++;
    if (req.url.startsWith("/rest/v1/referral_images?") && req.headers["x-app-secret"] === secret) {
      return res.end(JSON.stringify([{ cipher: encrypted.toString("base64"), iv: iv.toString("base64"), tag: (invalidImage ? Buffer.alloc(16) : cipher.getAuthTag()).toString("base64") }]));
    }
    res.writeHead(403); res.end("{}");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const envPath = path.join(dir, "runtime.env");
  const child = spawn(process.execPath, ["deploy/setup.mjs"], {
    env: { ...process.env, SETUP_ORIGIN: origin, SETUP_TOKEN: token, SETUP_EXPIRES: String(Date.now() + 60000), SETUP_PORT: "0", SUPABASE_URL: `http://127.0.0.1:${upstream.address().port}`, SUPABASE_PUBLISHABLE_KEY: "test-public-key", RUNTIME_ENV: envPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const started = await Promise.race([once(child.stdout, "data"), new Promise((_, reject) => setTimeout(() => reject(new Error("Setup startup timeout")), 5000).unref())]);
    const port = /port (\d+)/.exec(started[0].toString())[1];
    const base = `http://127.0.0.1:${port}`;
    const submit = (value, overrides = {}) => fetch(base + "/setup/verify", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "x-setup-token": token, ...overrides }, body: JSON.stringify({ secret: value }) });
    const page = await fetch(base + "/setup");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal((await submit(secret, { "x-setup-token": "wrong" })).status, 403);
    assert.equal((await submit(secret, { Origin: "https://attacker.invalid" })).status, 403);
    assert.equal((await submit("incorrect-secret-value-longer-than-32-characters")).status, 401);
    await assert.rejects(access(envPath));
    openPolicies = true;
    assert.equal((await submit(secret)).status, 409, "an unlocked database must never receive credentials");
    await assert.rejects(access(envPath));
    openPolicies = false;
    invalidImage = true;
    assert.equal((await submit(secret)).status, 502);
    await assert.rejects(access(envPath));
    invalidImage = false;
    assert.equal((await submit(secret)).status, 200);
    const saved = await readFile(envPath, "utf8");
    assert.ok(saved.includes(`APP_DB_SECRET="${secret}"`));
    assert.equal((await submit(secret)).status, 410);
    assert.equal(await readFile(envPath, "utf8"), saved);
    assert.equal(writes, 0, "handoff must not mutate database records");
  } finally {
    child.kill();
    await once(child, "exit");
    await new Promise(resolve => upstream.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
