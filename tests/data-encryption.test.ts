import assert from "node:assert/strict";
import { test } from "node:test";
import crypto from "node:crypto";

test("new data is sealed with APP_DATA_KEY while legacy rows stay readable", async () => {
  const dbSecret = "encryption-test-db-secret-longer-than-thirty-two";
  process.env.APP_DB_SECRET = dbSecret;
  process.env.APP_DATA_KEY = "encryption-test-data-key-also-longer-than-thirty-two";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "encryption-test-key";
  const { encryptImages, encryptCard, openBytes, dataKeys } = await import("../server/db");
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("synthetic")]);

  const [sealed] = encryptImages([{ name: "scan.png", mime: "image/png", data: png.toString("base64") }]);
  assert.ok(sealed.iv.startsWith("v2:"));
  assert.deepEqual(openBytes(sealed, dataKeys.image), png);
  assert.throws(() => openBytes(sealed, { legacy: dataKeys.image.legacy, current: null }), /APP_DATA_KEY/);
  const legacyOnly = { ...sealed, iv: sealed.iv.slice(3) };
  assert.throws(() => openBytes(legacyOnly, dataKeys.image), "a v2 ciphertext cannot be read with the key Supabase can see");

  // Rows written before APP_DATA_KEY existed, exactly as the old server and deploy/setup.mjs derive the key.
  const oldKey = Buffer.from(crypto.hkdfSync("sha256", dbSecret, "transferdesk-images-v1", "private-clinical-images", 32));
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", oldKey, iv);
  const legacy = { cipher: Buffer.concat([cipher.update(png), cipher.final()]).toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  assert.deepEqual(openBytes(legacy, dataKeys.image), png);

  assert.ok(encryptCard({ mime: "image/png", data: png.toString("base64") }).iv.startsWith("v2:"));
  assert.throws(() => encryptCard({ mime: "image/png", data: Buffer.from("plain text").toString("base64") }), /JPEG, PNG and WebP/);
});
