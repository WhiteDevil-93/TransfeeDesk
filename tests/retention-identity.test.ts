import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import express from "express";
import os from "node:os";
import path from "node:path";

// Sign-ups queue surnames for the register refresh: keep that out of the repo
// checklist and away from the public iRegister.
process.env.HPCSA_CHECKLIST = path.join(os.tmpdir(), `hpcsa-checklist-${process.pid}.txt`);
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => String(input?.url ?? input).startsWith("http://127.0.0.1:") ? realFetch(input, init) : Promise.reject(new Error("external network disabled in tests"))) as typeof fetch;
process.env.APP_DB_SECRET ||= "test-only-secret-longer-than-thirty-two-characters";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ||= "test-only-key";
const { db, verifyPw, hashPw } = await import("../server/db");
const { registerRoutes } = await import("../server/routes");
const { normalizeHpcsaNumber, hpcsaIdentityMatches } = await import("../server/hpcsa-verification");
const { registerNumber } = await import("../script/hpcsa-scrape");

async function withApp(run: (base: string) => Promise<void>) {
  const app = express(); app.use(express.json());
  const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const post = (url: string, body: unknown, token?: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

test("malformed stored password hashes fail closed instead of throwing", async () => {
  const good = await hashPw("correct horse battery");
  assert.equal(await verifyPw("correct horse battery", good), true);
  assert.equal(await verifyPw("wrong", good), false);
  for (const bad of ["", "plain", "scrypt$abc$def", good.slice(0, -2), good.replace("scrypt", "bcrypt"), null as any]) assert.equal(await verifyPw("x", bad), false);
});

test("login with a corrupted hash is a normal failed attempt, not a server error", async t => {
  const updates: any[] = [], identityEdits: boolean[] = [];
  t.mock.method(db, "userByName", async () => ({ id: 5, active: true, failed: 0, pass_hash: "scrypt$zz$truncated" }) as any);
  t.mock.method(db, "updateUser", async (_id: number, patch: any) => { updates.push(patch); return [] as any; });
  t.mock.method(db, "audit", async () => {});
  await withApp(async base => {
    const res = await post(`${base}/api/login`, { username: "someone", password: "anything" });
    assert.equal(res.status, 401);
    assert.equal(updates[0]?.failed, 1, "failed attempt still counts towards lockout");
  });
});

test("public status lookup reveals nothing about purged referrals", async t => {
  let purged = false;
  t.mock.method(db, "byRef", async () => ({ ref: "TX-1", phone: "0712345678", status: "accepted", priority: "P2", bedStatus: "Bed allocated", createdAt: "2026-01-01", purgedAt: purged ? "2026-04-01" : null }) as any);
  await withApp(async base => {
    assert.equal((await post(`${base}/api/status`, { ref: "TX-1", phone: "0712345678" })).status, 200);
    purged = true;
    assert.equal((await post(`${base}/api/status`, { ref: "TX-1", phone: "0712345678" })).status, 404);
  });
});

const signup = { username: "new_referrer", password: "long-enough-password", name: "Jane Smith", email: "jane@example.invalid", phone: "0712345678", specialty: "Emergency", profession: "doctor" };

test("referrer sign-up: lookup failures and duplicate races never create a second account", async t => {
  t.mock.method(db, "audit", async () => {});
  const statuses: string[] = [];
  const identity = t.mock.method(db, "userByIdentity", async () => { throw new Error("upstream timeout"); });
  const add = t.mock.method(db, "addReferrer", async (b: any) => (statuses.push(b.verifyStatus), { id: 9, username: "new_referrer" }) as any);
  await withApp(async base => {
    assert.equal((await post(`${base}/api/referrer/signup`, signup)).status, 500, "a failed identity check is not 'no account'");
    assert.equal(add.mock.callCount(), 0);
    identity.mock.mockImplementation(async () => null);
    add.mock.mockImplementation(async () => { throw new Error('duplicate key value violates unique constraint "users_email_unique"'); });
    assert.equal((await post(`${base}/api/referrer/signup`, { ...signup, username: "new_referrer2" })).status, 409);
    statuses.length = 0;
    add.mock.mockImplementation(async (b: any) => (statuses.push(b.verifyStatus), { id: 9, username: "new_referrer3" }) as any);
    assert.equal((await post(`${base}/api/referrer/signup`, { ...signup, username: "new_referrer3", hpcsa: "" })).status, 200);
    assert.deepEqual(statuses, ["card_pending"], "sign-ups without an HPCSA number reach the owner's verification queue");
  });
});

test("referrer profile email changes cannot take another account's address", async t => {
  t.mock.method(db, "sessionUser", async () => ({ id: 3, role: "referrer", name: "Jane Smith", verifyStatus: "verified", mustChange: false }) as any);
  t.mock.method(db, "audit", async () => {});
  const update = t.mock.method(db, "updateReferrer", async () => ({ id: 3, verifyStatus: "verified" }) as any);
  t.mock.method(db, "emailTaken", async (email: string) => email === "taken@example.invalid");
  await withApp(async base => {
    assert.equal((await post(`${base}/api/referrer/profile`, { email: "taken@example.invalid" }, "t")).status, 409);
    assert.equal(update.mock.callCount(), 0);
    update.mock.mockImplementation(async () => { throw new Error('duplicate key value violates unique constraint "users_email_unique"'); });
    assert.equal((await post(`${base}/api/referrer/profile`, { email: "raced@example.invalid" }, "t")).status, 409, "a concurrent claim is caught by the unique index");
    update.mock.mockImplementation(async () => { throw new Error("REFERRER_PROFILE_CONFLICT"); });
    const stale = await post(`${base}/api/referrer/profile`, { phone: "0711111111" }, "t");
    assert.equal(stale.status,409);assert.match((await stale.json()).message,/Reload/);
  });
});

test("a verified referrer who changes name or HPCSA number goes back to the admin, flagged when the register matches", async t => {
  const stored = { name: "Jane Smith", hpcsaNumber: "MP0123456" };
  t.mock.method(db, "sessionUser", async () => ({ id: 3, role: "referrer", ...stored, verifyStatus: "verified", mustChange: false }) as any);
  t.mock.method(db, "audit", async () => {});
  t.mock.method(db, "emailTaken", async () => false);
  const updates: any[] = [], identityEdits: boolean[] = [];
  t.mock.method(db, "updateReferrer", async (_id: number, b: any, _before: any, changed: boolean) => (identityEdits.push(changed), updates.push(b), { id: 3, name: b.name ?? stored.name, hpcsaNumber: b.hpcsa !== undefined ? normalizeHpcsaNumber(b.hpcsa) : stored.hpcsaNumber, verifyStatus: "verified" }) as any);
  let registered: any[] = [];
  const lookup = t.mock.method(db, "hpcsaLookup", async () => ({ rows: registered }) as any);
  const demote = t.mock.method(db, "demoteReferrer", async () => {});
  const marked = t.mock.method(db, "markHpcsaMatched", async () => {});
  const entry = (full_name: string, hpcsa_number: string, status = "ACTIVE") => ({ full_name, hpcsa_number, status });
  const update = async (base: string, body: any) => (await post(`${base}/api/referrer/profile`, body, "t")).json();
  await withApp(async base => {
    assert.deepEqual(await update(base, { phone: "0711111111" }), { ok: true }, "phone");
    assert.deepEqual(updates[0], { phone: "0711111111" }, "a partial update touches only the fields sent (no blanked HPCSA number or hospital)");
    assert.deepEqual(await update(base, { name: "  jane   SMITH ", hpcsa: "mp 0123456" }), { ok: true }, "same");
    assert.equal(lookup.mock.callCount(), 0, "unchanged identity needs no register check");
    assert.equal(demote.mock.callCount(), 0);

    registered = [];
    const renamed = await update(base, { name: "Jane Brown" });
    assert.equal(renamed.reverify, true);
    assert.equal(identityEdits.at(-1), true, "the identity write must revoke verification atomically");

    assert.equal(marked.mock.callCount(), 0);

    registered = [entry("BROWN JANE", "MP 0123456")];
    assert.equal((await update(base, { name: "Jane Brown" })).reverify, true, "the public register cannot prove the new identity is this person");
    assert.equal(identityEdits.at(-1), true);
    assert.equal(marked.mock.callCount(), 1, "a register match is flagged for the administrator");

    registered = [entry("SMITH JANE", "MP0123456", "REMOVED")];
    assert.equal((await update(base, { hpcsa: "MP 0999999" })).reverify, true);
    assert.equal(identityEdits.at(-1), true, "a number that is not on the register is not trusted");
    assert.equal(marked.mock.callCount(), 1);
  });
});

test("a verified referrer re-uploading a staff card keeps verification", async t => {
  let status = "verified";
  t.mock.method(db, "sessionUser", async () => ({ id: 3, role: "referrer", name: "Jane Smith", verifyStatus: status, mustChange: false }) as any);
  t.mock.method(db, "audit", async () => {});
  const attach = t.mock.method(db, "attachCard", async () => {});
  const image = { name: "card.png", mime: "image/png", data: Buffer.from("png").toString("base64") };
  await withApp(async base => {
    assert.equal((await post(`${base}/api/referrer/card`, { image }, "t")).status, 409);
    assert.equal(attach.mock.callCount(), 0);
    status = "card_pending";
    assert.equal((await post(`${base}/api/referrer/card`, { image }, "t")).status, 200);
    assert.equal(attach.mock.callCount(), 1);
  });
});

test("opening a case marks follow-ups seen only up to the one the viewer was shown", async t => {
  t.mock.method(db, "sessionUser", async () => ({ id: 1, role: "clinician", team: "MEU", name: "Dr A", mustChange: false }) as any);
  t.mock.method(db, "audit", async () => {});
  t.mock.method(db, "get", async (id: number) => ({ id, team: "MEU", ref: "TX-1", latestFollowupAt: "2026-10-28T06:00:00.123456+00:00" }) as any);
  t.mock.method(db, "timeline", async () => []);
  t.mock.method(db, "images", async () => []);
  const opened = t.mock.method(db, "markOpened", async () => {});
  await withApp(async base => {
    assert.equal((await fetch(`${base}/api/referrals/4`, { headers: { authorization: "Bearer t" } })).status, 200);
    assert.deepEqual(opened.mock.calls[0].arguments, [4, "Dr A", "2026-10-28T06:00:00.123456+00:00"]);
  });
});

test("HPCSA numbers are stored and matched in one normalized form", () => {
  assert.equal(normalizeHpcsaNumber(" mp 012 3456 "), "MP0123456");
  assert.equal(registerNumber("MP 0123456"), "MP0123456");
  assert.equal(registerNumber("NOREG_JANE_SMITH"), "");
  assert.equal(hpcsaIdentityMatches("Jane Smith", "mp0123456", { full_name: "SMITH JANE", hpcsa_number: "MP 0123456", status: "ACTIVE" }), true);
});
