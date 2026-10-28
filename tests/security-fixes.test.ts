import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";

process.env.APP_DB_SECRET = "security-test-secret-longer-than-thirty-two-characters";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "security-test-key";
process.env.HPCSA_CHECKLIST = "/dev/null";

const { db, hashPw } = await import("../server/db");
const { registerRoutes, pruneHits, rateLimitKeyCount } = await import("../server/routes");
const { applyHttpHardening, CONTENT_SECURITY_POLICY } = await import("../server/http-hardening");

async function serve(app: express.Express) {
  const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (token: string | null, path: string, method = "GET", body?: any) => fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
  return { request, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const people: any[] = [
  { id: 1, role: "admin", team: null },
  { id: 4, role: "clinician", team: "MEU" },
  { id: 5, role: "unit_admin", team: null },
  { id: 7, role: "referrer", team: null, name: "Jane Smith", verifyStatus: "verified", hpcsaNumber: "MP0123456" },
  { id: 8, role: "referrer", team: null, verifyStatus: "card_pending" },
  { id: 9, role: "referrer", team: null, verifyStatus: "hpcsa" },
].map(u => ({ active: true, name: `Person ${u.id}`, username: `p${u.id}`, phone: `08200000${u.id}`, mustChange: false, ...u }));

test("referrers cannot list staff or other referrers, and only verified referrers see the roster", async t => {
  t.mock.method(db, "sessionUser", async (token: string) => people.find(u => String(u.id) === token) || null);
  t.mock.method(db, "users", async () => people);
  const { request, close } = await serve((() => { const app = express(); app.use(express.json()); return app; })());
  try {
    for (const id of ["7", "8"]) assert.equal((await request(id, "/api/team")).status, 403);
    assert.deepEqual((await (await request("4", "/api/team")).json()).map((u: any) => u.id), [4]);
    assert.deepEqual((await (await request("5", "/api/team")).json()), [], "staff without a unit see no one, not every unit-less account");
    assert.deepEqual((await (await request("1", "/api/team")).json()).map((u: any) => u.id), [1, 4, 5], "referrers never appear in the staff list");
    for (const id of ["8", "9"]) assert.equal((await request(id, "/api/referrer/roster")).status, 403);
    assert.equal((await request("7", "/api/referrer/roster")).status, 200);
    assert.equal((await request("1", "/api/referrer/roster")).status, 200);
  } finally { await close(); }
});

test("login lockout cannot be re-armed by one failure, does not reveal locks, and unknown users cost the same", async t => {
  const stored: any = { id: 4, username: "p4", name: "Person 4", active: true, pass_hash: await hashPw("correct-password"), failed: 0, locked_until: null };
  const updates: any[] = [];
  t.mock.method(db, "userByName", async (name: string) => name === "p4" ? stored : null);
  t.mock.method(db, "updateUser", async (id: number, patch: any) => { updates.push(patch); Object.assign(stored, patch); });
  t.mock.method(db, "audit", async () => {});
  t.mock.method(db, "createSession", async () => "4");
  t.mock.method(db, "sessionUser", async () => people[1]);
  const { request, close } = await serve((() => { const app = express(); app.use(express.json()); return app; })());
  const login = (password: string, username = "p4") => request(null, "/api/login", "POST", { username, password });
  try {
    for (let i = 0; i < 4; i++) assert.equal((await login("wrong")).status, 401);
    assert.equal(stored.failed, 4);
    assert.equal((await login("wrong")).status, 401);
    assert.ok(new Date(stored.locked_until).getTime() > Date.now(), "fifth failure locks the account");
    const lockedUpdates = updates.length;
    assert.equal((await login("wrong")).status, 401, "a wrong password during a lock looks like any other failure");
    assert.equal(updates.length, lockedUpdates, "failures during a lock do not extend it");
    assert.equal((await login("correct-password")).status, 423, "only the real password holder learns about the lock");
    stored.locked_until = new Date(Date.now() - 1000).toISOString();
    assert.equal((await login("wrong")).status, 401);
    assert.equal(stored.locked_until, null, "one failure after an expired lock does not lock again");
    assert.equal(stored.failed, 1);
    assert.equal((await login("correct-password")).status, 200);
    const time = async (username: string) => { const s = performance.now(); await login("wrong", username); return performance.now() - s; };
    let known = 0, unknown = 0;
    for (let i = 0; i < 3; i++) { stored.failed = 0; stored.locked_until = null; known += await time("p4"); unknown += await time("nobody"); }
    assert.ok(unknown > known / 3, `unknown usernames still run the password hash (known ${known.toFixed(0)}ms, unknown ${unknown.toFixed(0)}ms)`);
  } finally { await close(); }
});

test("changing a password ends the account's other sessions", async t => {
  const me = { ...people[1] };
  const stored: any = { id: 4, username: "p4", pass_hash: await hashPw("current-password") };
  const ended: any[] = [];
  t.mock.method(db, "sessionUser", async () => me);
  t.mock.method(db, "userByName", async () => stored);
  t.mock.method(db, "updateUser", async () => {});
  t.mock.method(db, "audit", async () => {});
  t.mock.method(db, "endOtherSessions", async (id: number, keep: string) => { ended.push([id, keep]); });
  const { request, close } = await serve((() => { const app = express(); app.use(express.json()); return app; })());
  try {
    assert.equal((await request("current-token", "/api/me/password", "POST", { current: "wrong", next: "new-password-123" })).status, 400);
    assert.deepEqual(ended, []);
    assert.equal((await request("current-token", "/api/me/password", "POST", { current: "current-password", next: "new-password-123" })).status, 200);
    assert.deepEqual(ended, [[4, "current-token"]]);
  } finally { await close(); }
});

test("referrer verification: register matches need an admin, identity changes are re-checked, cards are validated", async t => {
  const added: any[] = [], marked: number[] = [];
  t.mock.method(db, "sessionUser", async (token: string) => people.find(u => String(u.id) === token) || null);
  t.mock.method(db, "audit", async () => {});
  t.mock.method(db, "userByIdentity", async () => null);
  t.mock.method(db, "hpcsaLookup", async () => ({ number: "MP0123456", name: "", rows: [{ full_name: "Jane Smith", hpcsa_number: "MP0123456", status: "ACTIVE" }] }));
  t.mock.method(db, "addReferrer", async (b: any) => { added.push(b); return { id: 30, username: b.username } as any; });
  t.mock.method(db, "updateReferrer", async () => people[4]);
  t.mock.method(db, "markHpcsaMatched", async (id: number) => { marked.push(id); });
  const demoted: number[] = [];
  t.mock.method(db, "demoteReferrer", async (id: number) => { demoted.push(id); });
  t.mock.method(db, "emailTaken", async () => false);
  t.mock.method(db, "approveReferrer", async (id: number) => id === 8);
  t.mock.method(db, "rejectReferrer", async (id: number) => id === 8);
  const { request, close } = await serve((() => { const app = express(); app.use(express.json()); return app; })());
  try {
    const signup = await request(null, "/api/referrer/signup", "POST", { username: "jsmith", password: "long-enough-password", name: "Jane Smith", email: "jane@example.invalid", phone: "0710000000", specialty: "Emergency", profession: "doctor", hpcsa: "MP 0123456", hospital: "QA Hospital" });
    assert.equal(signup.status, 200);
    const body = await signup.json();
    assert.equal(body.autoApproved, false);
    assert.equal(body.hpcsaMatched, true);
    assert.equal(added[0].verifyStatus, "hpcsa", "a public-register match is flagged, never verified");
    assert.equal(added[0].hospital, "QA Hospital");
    assert.equal((await (await request("7", "/api/referrer/profile", "POST", { hpcsa: "mp 0123456", phone: "0720000000" })).json()).reverify, undefined, "same number, reformatted, is not a change");
    assert.deepEqual(demoted, []);
    assert.equal((await (await request("7", "/api/referrer/profile", "POST", { hpcsa: "MP9999999" })).json()).reverify, true, "a verified referrer who changes number is re-verified by an admin");
    assert.deepEqual(demoted, [7]);
    const png = { name: "card.png", mime: "image/png", data: Buffer.from("not really a png").toString("base64") };
    assert.equal((await request("7", "/api/referrer/card", "POST", { image: png })).status, 409, "verified accounts are not downgraded by a card upload");
    const bad = await request("8", "/api/referrer/card", "POST", { image: png });
    assert.equal(bad.status, 400); assert.match((await bad.json()).message, /JPEG, PNG and WebP/);
    assert.equal((await request("1", "/api/pending-referrers/4/approve", "POST")).status, 404, "only referrer accounts can be approved");
    assert.equal((await request("1", "/api/pending-referrers/4/reject", "POST")).status, 404);
    assert.equal((await request("1", "/api/pending-referrers/8/approve", "POST")).status, 200);
  } finally { await close(); }
});

test("decision notes are only written together with a decision", async t => {
  t.mock.method(db, "sessionUser", async () => people[1]);
  t.mock.method(db, "get", async (id: number) => ({ id, team: "MEU", ref: "QA" }) as any);
  const updated = t.mock.method(db, "update", async () => ({ id: 1 }) as any);
  const { request, close } = await serve((() => { const app = express(); app.use(express.json()); return app; })());
  try {
    assert.equal((await request("4", "/api/referrals/1", "PATCH", { decisionNote: "Silent edit" })).status, 400);
    assert.equal(updated.mock.callCount(), 0);
  } finally { await close(); }
});

test("rate-limit state for attacker-chosen keys is pruned", async t => {
  t.mock.method(db, "byRef", async () => null);
  const { request, close } = await serve((() => { const app = express(); app.use(express.json()); return app; })());
  try {
    const before = rateLimitKeyCount();
    for (let i = 0; i < 25; i++) await request(null, "/api/status", "POST", { ref: `TX-PROBE-${i}`, phone: "0710000000" });
    assert.ok(rateLimitKeyCount() >= before + 25);
    pruneHits(Date.now() + 2 * 3600e3);
    assert.equal(rateLimitKeyCount(), 0);
  } finally { await close(); }
});

test("only image routes accept large bodies; production responses carry a CSP", async () => {
  const app = express(); applyHttpHardening(app, true);
  app.post(["/api/login", "/api/referrals"], (req, res) => res.json({ size: JSON.stringify(req.body).length }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const big = JSON.stringify({ data: "x".repeat(500_000) });
  const post = (path: string) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: big });
  try {
    assert.equal((await post("/api/login")).status, 413);
    const ok = await post("/api/referrals");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-security-policy"), CONTENT_SECURITY_POLICY);
    assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'(;|$)/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
