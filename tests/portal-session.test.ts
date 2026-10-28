import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";

process.env.APP_DB_SECRET = "portal-test-secret-longer-than-thirty-two-characters";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "portal-test-key";
const { PORTAL_IDLE_MS, PORTAL_MAX_MS, issuePortalToken, readPortalToken } = await import("../server/portal-session");

test("portal tokens expire, cannot be forged, and end when the follow-up code is reset", () => {
  const now = 1_800_000_000_000;
  const { token } = issuePortalToken(7, "hash-a", { now });
  assert.equal(readPortalToken(token, now + 1000)?.rid, 7);
  assert.equal(readPortalToken(token, now + PORTAL_IDLE_MS + 1), null, "idle expiry");
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), rid: 8 })).toString("base64url");
  assert.equal(readPortalToken(`${forged}.${sig}`, now), null, "payload edits are rejected");
  assert.equal(readPortalToken(`${body}.${sig}x`, now), null);
  assert.equal(readPortalToken("garbage", now), null);
  assert.equal(readPortalToken("", now), null);
  const refreshed = issuePortalToken(7, "hash-a", { now: now + PORTAL_MAX_MS - 1000, iat: now });
  assert.equal(readPortalToken(refreshed.token, now + PORTAL_MAX_MS - 500)?.rid, 7);
  assert.equal(readPortalToken(refreshed.token, now + PORTAL_MAX_MS + 1), null, "sliding refresh never outlives the absolute limit");
  assert.notEqual(readPortalToken(issuePortalToken(7, "hash-b", { now }).token, now)?.fp, readPortalToken(token, now)?.fp);
});

test("follow-up portal: the code is exchanged once and polling, updates and images use the token", async t => {
  const { db } = await import("../server/db");
  const { registerRoutes } = await import("../server/routes");
  const { issuePortalToken: issue } = await import("../server/portal-session");
  const CODE = "a".repeat(32);
  let portalHash = "hash-current", purged = false;
  const referral = { id: 21, ref: "TX-PORTAL", team: "MEU", status: "pending", doctorName: "Dr Q", openedAt: null };
  const appended: any[] = [], logins: any[] = [];
  t.mock.method(db, "portalLogin", async (ref, code) => { logins.push([ref, code]); return code === CODE && ref.toUpperCase() === "TX-PORTAL" ? { referral: referral as any, portalHash } : null; });
  t.mock.method(db, "portalById", async id => id === 21 && !purged ? { referral: referral as any, portalHash } : null);
  t.mock.method(db, "timeline", async () => []);
  t.mock.method(db, "images", async () => []);
  t.mock.method(db, "image", async (id, rid) => id === 5 && rid === 21 ? { id: 5, mime: "image/jpeg", data: "AAAA" } as any : null);
  t.mock.method(db, "append", async (...args) => { appended.push(args); return {} as any; });
  t.mock.method(db, "audit", async () => {});
  const app = express(); app.use(express.json());
  const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (path: string, body?: any, token?: string) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-portal-token": token } : {}) }, body: JSON.stringify(body ?? {}) });
  try {
    assert.equal((await post("/api/portal", { ref: "TX-PORTAL", code: "0".repeat(32) })).status, 404);
    const first = await post("/api/portal", { ref: "tx-portal", code: CODE });
    assert.equal(first.status, 200);
    const opened = await first.json();
    assert.equal(opened.ref, "TX-PORTAL"); assert.ok(opened.portalToken); assert.ok(opened.portalExpiresAt);
    assert.equal(logins.length, 2);

    const poll = await post("/api/portal", undefined, opened.portalToken);
    assert.equal(poll.status, 200);
    assert.equal(logins.length, 2, "polling with a token never re-checks the code");
    const tokenNow = (await poll.json()).portalToken;

    assert.equal((await post("/api/portal/followup", { body: "New findings" }, tokenNow)).status, 200);
    assert.deepEqual(appended[0].slice(0, 5), [21, "Dr Q", null, "update", "New findings"]);
    assert.equal((await post("/api/portal/image/5", undefined, tokenNow)).status, 200);
    assert.equal((await post("/api/portal/image/6", undefined, tokenNow)).status, 404);
    assert.equal((await post("/api/portal/followup", { ref: "TX-PORTAL", code: CODE, body: "Older client" })).status, 200, "older clients that send the code still work");

    assert.equal((await post("/api/portal", undefined, "not-a-token")).status, 410);
    assert.equal((await post("/api/portal/followup", { body: "x1" }, "not-a-token")).status, 410);
    const stale = issue(21, "hash-current", { now: Date.now() - 2 * PORTAL_IDLE_MS }).token;
    assert.equal((await post("/api/portal", undefined, stale)).status, 410, "idle token");

    for (let i = 0; i < 320; i++) assert.equal((await post("/api/portal", undefined, tokenNow)).status, 200, `poll ${i}`);

    portalHash = "hash-reset";
    assert.equal((await post("/api/portal", undefined, tokenNow)).status, 410, "a portal code reset ends earlier sessions");
    portalHash = "hash-current"; purged = true;
    assert.equal((await post("/api/portal", undefined, tokenNow)).status, 410, "a purged referral ends the session");
    assert.equal((await post("/api/portal/image/5", undefined, tokenNow)).status, 410);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
