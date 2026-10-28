// Run after npm run build; validates the shipped assets rather than source-only presence.
import fs from "node:fs/promises";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const root = "dist/public/";
const manifest = JSON.parse(await fs.readFile(root + "manifest.webmanifest", "utf8"));
assert.equal(manifest.theme_color, "#0B7F75");
assert.equal(manifest.icons.length, 3);
assert(manifest.icons.some(icon => icon.purpose === "maskable"));
for (const icon of manifest.icons) {
  const bytes = await fs.readFile(root + icon.src);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(icon.sizes, `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
}
const inventory = (await fs.readFile("branding/SHA256SUMS.txt", "utf8")).trim().split(/\r?\n/);
for (const line of inventory) {
  const [, digest, path] = line.match(/^([a-f0-9]{64})\s+(.+)$/) || [];
  assert(digest && path && !path.includes(".."));
  assert.equal(crypto.createHash("sha256").update(await fs.readFile(root + "branding/" + path)).digest("hex"), digest, path);
}
const gallery = await fs.readFile(root + "branding/index.html", "utf8");
for (const [, link] of gallery.matchAll(/(?:href|src)="([^"]+)"/g)) {
  if (!/^(?:https?:|#)/.test(link)) await fs.access(root + "branding/" + link);
}
const html = await fs.readFile(root + "index.html", "utf8");
assert(html.includes("branding/icons/favicon.ico") && html.includes("branding/icons/app-teal-180.png"));
const worker = await fs.readFile(root + "sw.js", "utf8");
assert(!worker.includes("branding/wallpapers/"), "wallpapers must not bloat the install cache");
assert(worker.includes("branding/icons/app-teal-192.png"));
assert((await fs.readFile(root + "push-sw.js", "utf8")).includes("branding/icons/app-teal-192.png"));
console.log(`PASS branding build: ${inventory.length} checksummed assets, gallery links, PWA sizes/maskable icon, favicon/Apple icon, notification icon and bounded offline cache`);
