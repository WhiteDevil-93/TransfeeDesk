import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";

test("global admin covers referral workflows; staff and unit managers cannot escalate or cross units", async t => {
  process.env.APP_DB_SECRET = "role-test-secret-longer-than-thirty-two-characters";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "role-test-key";
  const { db } = await import("../server/db");
  const { registerRoutes } = await import("../server/routes");
  const users: any[] = [
    { id: 1, role: "admin", team: null }, { id: 2, role: "unit_admin", team: "MEU" },
    { id: 3, role: "unit_admin", team: "TEU" }, { id: 4, role: "clinician", team: "MEU" },
    { id: 5, role: "clinician", team: "TEU" }, { id: 6, role: "unit_admin", team: "MEU" },
    { id: 7, role: "referrer", team: null, verifyStatus: "verified" },
    { id: 8, role: "admin", team: null, mustChange: true }, { id: 9, role: "unit_admin", team: null },
  ].map(u => ({ active: true, name: `QA role ${u.id}`, username: `qa${u.id}`, ...u }));
  const refs: any[] = [{ id: 11, team: "MEU", referrerId: 7 }, { id: 12, team: "TEU", referrerId: 99 }];
  const changes: any[] = [], additions: any[] = [], audits: any[] = [], lists: any[] = [];
  let creator: number | null = null;
  t.mock.method(db, "sessionUser", async token => users.find(u => String(u.id) === token) || null);
  t.mock.method(db, "users", async () => users);
  t.mock.method(db, "userById", async id => users.find(u => u.id === id) || null);
  t.mock.method(db, "userByName", async () => null);
  t.mock.method(db, "addUser", async (_username, _name, role, _pw, team) => { additions.push({ role, team }); return { id: 20, role, team } as any; });
  t.mock.method(db, "updateUser", async (id, patch) => { changes.push({ id, patch }); });
  t.mock.method(db, "endUserSessions", async () => {});
  t.mock.method(db, "audit", async row => { audits.push(row); });
  t.mock.method(db, "list", async (team, owner) => { lists.push({ team, owner }); return refs.filter(r => (team === undefined || r.team === team) && (owner === undefined || r.referrerId === owner)); });
  t.mock.method(db, "get", async id => refs.find(r => r.id === id));
  t.mock.method(db, "timeline", async () => []);
  t.mock.method(db, "images", async () => []);
  t.mock.method(db, "create", async (_body, owner) => { creator = owner!; return { id: 13, ref: "QA-ROLE", followupCode: "fixture" } as any; });
  t.mock.method(db, "roster", async (team, day) => ({ team, day, entries: [] }) as any);
  t.mock.method(db, "saveRoster", async () => {});
  t.mock.method(db, "purgeOlderThan", async () => 0);
  t.mock.method(db, "settings", async () => ({ retentionDays: 90 }) as any);
  t.mock.method(db, "markOpened", async () => {});
  const app = express(); app.use(express.json());
  const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (id: number, path: string, method = "GET", body?: any) => fetch(base + path, { method, headers: { authorization: `Bearer ${id}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    for (const id of [4, 5, 7, 9]) assert.equal((await request(id, "/api/users")).status, 403);
    const managed = await request(2, "/api/users"); assert.equal(managed.status, 200);
    assert.deepEqual((await managed.json()).map((u: any) => u.id), [4]);
    assert.equal((await request(1, "/api/users")).status, 200);
    const scoped = await request(2, "/api/referrals?team=TEU");
    assert.deepEqual((await scoped.json()).map((r: any) => r.id), [11], "query parameters cannot override the session's unit");
    assert.equal((await request(2, "/api/referrals/11")).status, 200);
    assert.equal((await request(2, "/api/referrals/12")).status, 404);
    assert.equal((await request(2, "/api/referrals/12", "PATCH", { priority: "P1" })).status, 404);
    for (const target of [1, 2, 3, 5, 6]) assert.equal((await request(2, `/api/users/${target}`, "PATCH", { phone: "0700000000" })).status, 403);
    for (const patch of [{ role: "unit_admin" }, { role: "admin" }, { team: "TEU" }, { role: "", phone: "0700000000" }]) assert.equal((await request(2, "/api/users/4", "PATCH", patch)).status, 403);
    assert.deepEqual(changes, []);
    assert.equal((await request(2, "/api/users/4", "PATCH", { active: false })).status, 200);
    assert.equal(changes[0].id, 4);
    const newUser = { username: "new_qa", name: "QA Staff", password: "temporary-test-password", role: "clinician", team: "MEU" };
    assert.equal((await request(4, "/api/users", "POST", newUser)).status, 403);
    assert.equal((await request(2, "/api/users", "POST", { ...newUser, role: "unit_admin" })).status, 403);
    assert.equal((await request(2, "/api/users", "POST", { ...newUser, team: "TEU" })).status, 403);
    assert.equal((await request(2, "/api/users", "POST", newUser)).status, 200);
    assert.deepEqual(additions, [{ role: "clinician", team: "MEU" }]);
    assert.equal((await request(1, "/api/users/5", "PATCH", { role: "unit_admin", team: "SEU" })).status, 200);
    assert.equal((await request(2, "/api/unit-roster?team=TEU&day=2026-10-26")).status, 403);
    const roster = { team: "MEU", day: "2026-10-26", entries: [{ userId: 4, duty: "On call" }] };
    assert.equal((await request(2, "/api/unit-roster", "PUT", { ...roster, team: "TEU" })).status, 403);
    assert.equal((await request(2, "/api/unit-roster", "PUT", { ...roster, entries: [{ userId: 5, duty: "On call" }] })).status, 400);
    assert.equal((await request(2, "/api/unit-roster", "PUT", roster)).status, 200);
    for (const path of ["/api/audit", "/api/pending-referrers"]) for (const id of [2, 4]) assert.equal((await request(id, path)).status, 403);
    assert.equal((await request(2, "/api/settings", "PUT", { retentionDays: 1 })).status, 403);
    assert.equal((await request(2, "/api/referrer/my-referrals")).status, 403);
    assert.equal((await request(4, "/api/referrer/my-referrals")).status, 403);
    const all = await request(1, "/api/referrer/my-referrals"); assert.deepEqual((await all.json()).map((r: any) => r.id), [11, 12]);
    assert.equal(lists.at(-1).owner, undefined);
    const own = await request(7, "/api/referrer/my-referrals"); assert.deepEqual((await own.json()).map((r: any) => r.id), [11]);
    assert.equal((await request(1, "/api/referrer/referrals/12")).status, 200);
    assert.equal((await request(7, "/api/referrer/referrals/12")).status, 404);
    assert.equal((await request(8, "/api/referrer/my-referrals")).status, 403, "temporary admin must change password first");
    const referral = { team: "TEU", consultType: "advice", doctorName: "QA admin", hospital: "QA facility", phone: "0700000000", specialty: "other", patientInitials: "Q.T.", age: "30", sex: "M", diagnosis: "QA only", history: "Synthetic history", exam: "Synthetic examination", investigations: "Synthetic results", reason: "Advice request", suggestedPriority: "P3", consent: true, lat: "-26.1", lon: "27.9" };
    for (const id of [2, 4]) assert.equal((await request(id, "/api/referrals", "POST", referral)).status, 403);
    assert.equal((await request(1, "/api/referrals", "POST", referral)).status, 200); assert.equal(creator, 1);
    assert.equal(audits.find(a => a.action === "referral_submitted")?.userId, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
