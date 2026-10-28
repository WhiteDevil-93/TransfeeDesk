import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";

process.env.APP_DB_SECRET = "auto-verification-test-secret-at-least-thirty-two-characters";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-only-key";
process.env.HPCSA_CHECKLIST = path.join(os.tmpdir(), `bb-auto-verification-${process.pid}.txt`);
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => String(input?.url ?? input).startsWith("http://127.0.0.1:") ? realFetch(input, init) : Promise.reject(Error("external network disabled in tests"))) as typeof fetch;
const { db, hashPw } = await import("../server/db");
const { registerRoutes } = await import("../server/routes");
const { verifyPendingReferrer } = await import("../server/referrer-verification");
const entry = { surname: "SMITH", full_name: "JANE MARIE", hpcsa_number: "MP0123456", status: "ACTIVE" };
const profile = { username: "auto_referrer", password: "test-password-long-enough", name: "Jane Smith", email: "qa@example.invalid", phone: "0700000000", profession: "doctor", specialty: "Emergency", hpcsa: "mp 0123456" };
const user = { id: 71, active: true, role: "referrer", name: "Jane Smith", hpcsaNumber: "MP0123456", verifyStatus: "hpcsa", mustChange: false } as any;
async function serve(run: (request: (route: string, body?: any, token?: string) => Promise<Response>) => Promise<void>) {
  const app = express(); app.use(express.json()); const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try { await run((route, body, token) => fetch(base + route, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

test("sign-up automatically verifies matching practitioner identities, never misses or ineligible records", async t => {
  t.mock.method(db, "userByIdentity", async () => null);
  t.mock.method(db, "audit", async () => {});
  let rows = [entry], unavailable = false;
  t.mock.method(db, "hpcsaLookup", async () => { if (unavailable) throw Error("lookup unavailable"); return { rows } as any; });
  const saved: any[] = [];
  t.mock.method(db, "addReferrer", async (input: any) => { saved.push(input); return { id: 71, username: input.username } as any; });
  await serve(async request => {
    for (const number of ["mp 0123456", "12345678"]) {
      rows = [{ ...entry, hpcsa_number: number.replaceAll(" ", "").toUpperCase() }];
      const response = await request("/api/referrer/signup", { ...profile, profession: number === "12345678" ? "nurse" : "doctor", hpcsa: number });
      assert.equal(response.status, 200); const body = await response.json();
      assert.equal(body.autoApproved, true); assert.equal(body.hpcsaMatched, true);
      assert.equal(saved.at(-1).verifyStatus, "verified"); assert.match(body.message, /send referrals now/);
    }
    for (const record of [null, { ...entry, full_name: "JOHN" }, { ...entry, hpcsa_number: "MP9999999" }, { ...entry, status: "REMOVED" }]) {
      rows = record ? [record] : [];
      const response = await request("/api/referrer/signup", profile); assert.equal(response.status, 200);
      assert.equal((await response.json()).autoApproved, false); assert.equal(saved.at(-1).verifyStatus, "card_pending");
    }
    unavailable = true;
    assert.equal((await request("/api/referrer/signup", profile)).status, 200);
    assert.equal(saved.at(-1).verifyStatus, "card_pending");
  });
});

test("pending accounts automatically verify at sign-in and authenticated refresh", async t => {
  t.mock.method(db, "audit", async () => {});
  t.mock.method(db, "updateUser", async () => {});
  const pass_hash = await hashPw(profile.password);
  t.mock.method(db, "userByName", async () => ({ ...user, pass_hash }));
  t.mock.method(db, "createSession", async () => "qa-session");
  t.mock.method(db, "sessionUser", async () => ({ ...user }));
  t.mock.method(db, "hpcsaLookup", async () => ({ rows: [entry] }) as any);
  const approve = t.mock.method(db, "verifyMatchedReferrer", async () => ({ ...user, verifyStatus: "verified" }));
  await serve(async request => {
    const login = await request("/api/login", { username: profile.username, password: profile.password });
    assert.equal(login.status, 200); assert.equal((await login.json()).user.verifyStatus, "verified");
    assert.equal((await (await request("/api/me", undefined, "qa-session")).json()).user.verifyStatus, "verified");
    assert.equal((await (await request("/api/referrer/profile", undefined, "qa-session")).json()).profile.verifyStatus, "verified");
    assert.equal(approve.mock.callCount(), 3);
  });
});

test("automatic recheck preserves rejections, disabled accounts and snapshot conflicts", async t => {
  t.mock.method(db, "audit", async () => {});
  const lookup = t.mock.method(db, "hpcsaLookup", async () => ({ rows: [entry] }) as any);
  const approve = t.mock.method(db, "verifyMatchedReferrer", async () => null);
  for (const patch of [{ verifyStatus: "none" }, { active: false }, { role: "clinician" }, { verifyStatus: "verified" }, { hpcsaNumber: "" }]) {
    const account = { ...user, ...patch }; assert.deepEqual(await verifyPendingReferrer(account), account);
  }
  assert.equal(lookup.mock.callCount(), 0); assert.equal(approve.mock.callCount(), 0);
  t.mock.method(db, "userById", async () => ({ ...user, name: "Jane Brown", verifyStatus: "card_pending" }));
  assert.equal((await verifyPendingReferrer(user)).verifyStatus, "card_pending", "a late register result cannot approve a changed identity");
  lookup.mock.mockImplementation(async () => { throw Error("unavailable"); });
  assert.equal((await verifyPendingReferrer(user)).verifyStatus, "hpcsa", "lookup failure grants no verification");
});
