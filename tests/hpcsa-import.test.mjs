import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("importing HPCSA helpers does not start a scrape", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "--eval", "import('./script/hpcsa-scrape.ts').then(() => console.log('imported'))"], {
    cwd: process.cwd(),
    env: { ...process.env, HPCSA_CHECKLIST: "/nonexistent/hpcsa-checklist" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 5000);
  try {
    const [code] = await once(child, "exit");
    assert.equal(code, 0, stderr);
    assert.equal(stdout.trim(), "imported");
  } finally {
    clearTimeout(timer);
  }
});
