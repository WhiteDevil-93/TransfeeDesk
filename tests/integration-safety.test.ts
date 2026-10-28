import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("database integration refuses unacknowledged databases and the known live project before any test writes", () => {
  for (const [isolated, url, message] of [
    ["", "http://127.0.0.1:9", /dedicated disposable test database/],
    ["1", "https://vfvwisaqdvigjdngmlyo.supabase.co", /refuse the live BaraBridge database/],
  ] as const) {
    const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tests/integration.ts"], {
      encoding: "utf8", timeout: 15000, windowsHide: true,
      env: { ...process.env, INTEGRATION_DB_ISOLATED: isolated, SUPABASE_URL: url,
        SUPABASE_PUBLISHABLE_KEY: "test-key", SUPABASE_ANON_KEY: "test-key",
        APP_DB_SECRET: "integration-guard-test-secret-longer-than-thirty-two", APP_DATA_KEY: "" },
    });
    assert.equal(r.status, 1); assert.match(r.stderr, message);
  }
});
