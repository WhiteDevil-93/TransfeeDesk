import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

test("staff queues work before the referrer migration; ownership queries stay scoped and fail closed", async () => {
  let migrated = false;
  let queueBroken = false;
  const requests: URL[] = [];
  const rows = [{ id: 1, team: "MEU", referrer_id: 7 }, { id: 2, team: "TEU", referrer_id: 8 }];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://fixture.invalid"); requests.push(url);
    res.setHeader("Content-Type", "application/json");
    if (url.pathname.endsWith("/rpc/is_app_server")) { res.end("true"); return; }
    if (queueBroken) { res.writeHead(400); res.end(JSON.stringify({ code: "42703", message: "column referrals.team does not exist" })); return; }
    if (!migrated && url.searchParams.get("select")?.split(",").includes("referrer_id")) {
      res.writeHead(400); res.end(JSON.stringify({ code: "42703", message: "column referrals.referrer_id does not exist" })); return;
    }
    const result = rows.filter(row => (!url.searchParams.has("team") || url.searchParams.get("team") === `eq.${row.team}`) && (!url.searchParams.has("referrer_id") || url.searchParams.get("referrer_id") === `eq.${row.referrer_id}`));
    res.end(JSON.stringify(url.searchParams.get("limit") === "0" ? [] : result));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.APP_DB_SECRET = "schema-test-only-secret-with-more-than-thirty-two-characters";
    process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
    process.env.SUPABASE_PUBLISHABLE_KEY = "schema-test-only-key";
    const { db, REFERRAL_QUEUE_COLUMNS } = await import("../server/db");
    const { databaseReady } = await import("../server/readiness");
    assert.equal(await databaseReady(), true);
    queueBroken = true;
    assert.equal(await databaseReady(), false, "health fails when the actual queue projection is invalid even if the secret is correct");
    queueBroken = false;
    assert.equal(REFERRAL_QUEUE_COLUMNS.split(",").includes("referrer_id"), false);
    assert.equal((await db.list()).length, 2);
    assert.deepEqual((await db.list("MEU")).map(row => row.id), [1]);
    const before = requests.length;
    assert.deepEqual(await db.list(null), []);
    assert.equal(requests.length, before, "staff without a unit never issue a global query");
    await assert.rejects(db.list(undefined, 7), /referrer_id does not exist/);
    assert.equal(requests.length, before + 1, "no unscoped fallback after missing ownership column");
    assert.equal(requests.at(-1)!.searchParams.get("referrer_id"), "eq.7");
    migrated = true;
    assert.deepEqual((await db.list(undefined, 7)).map(row => row.id), [1]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
