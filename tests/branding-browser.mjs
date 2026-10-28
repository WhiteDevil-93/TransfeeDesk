// Run against the built navigation fixture; exercises a real installed service worker.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:5188/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.goto("http://127.0.0.1:5188/branding/");
  assert.match(await page.locator("h1").innerText(), /BaraBridge/i);
  await page.screenshot({ path: "artifacts/pr5-branding/gallery-mobile.png" });
  const wallpaper = (await fs.readdir("branding/wallpapers")).find(f => f.endsWith(".png"));
  assert(wallpaper);
  const response = await page.goto("http://127.0.0.1:5188/branding/wallpapers/" + encodeURIComponent(wallpaper));
  assert(response?.headers()["content-type"].startsWith("image/png"), "installed app must not replace artwork downloads with the SPA shell");
  const digest = b => crypto.createHash("sha256").update(b).digest("hex");
  assert.equal(digest(await response.body()), digest(await fs.readFile("branding/wallpapers/" + wallpaper)));
  await context.setOffline(true);
  await page.goto("http://127.0.0.1:5188/branding/");
  assert.match(await page.locator("h1").innerText(), /BaraBridge/i);
  assert.deepEqual(errors, []);
  console.log("PASS real service worker: branding gallery online/offline, wallpaper bytes served as image, no runtime errors");
} finally { await browser.close(); }
