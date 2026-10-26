import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import express from "express";

test("verified submission and referrer follow-up stay confined to the owner's cases", async (t) => {
  process.env.APP_DB_SECRET ||= "test-only-secret-longer-than-thirty-two-characters";
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY ||= "test-only-key";
  const { db } = await import("../server/db");
  const { registerRoutes } = await import("../server/routes");
  const originalSessionUser = db.sessionUser;
  const originalCreate = db.create;
  const originalAudit = db.audit;
  const originalUpdate = db.update;
  let createdFor: number | null = null;
  (db as any).sessionUser = async (token: string) => {
    if (token === "staff") return { id: 1, role: "admin", mustChange: false };
    if (token === "pending") return { id: 2, role: "referrer", verifyStatus: "card_pending", mustChange: true };
    if (token === "verified") return { id: 3, role: "referrer", verifyStatus: "verified", mustChange: true };
    return null;
  };
  (db as any).create = async (_body: unknown, referrerId: number) => {
    createdFor = referrerId;
    return { id: 11, ref: "QA-TEST", followupCode: "test-code" };
  };
  (db as any).audit = async () => {};
  (db as any).update = async () => {};
  t.mock.method(db, "get", async (id: number) => ({ id, referrerId: id === 11 ? 3 : 99, ref: "QA-TEST", team: "MEU", history: "Own clinical history" } as any));
  t.mock.method(db, "timeline", async () => []);
  t.mock.method(db, "images", async () => []);
  t.mock.method(db, "image", async (imageId: number, referralId: number) => referralId === 11 ? { id: imageId, data: "test-image", mime: "image/png" } as any : null);
  const appended: number[] = [];
  t.mock.method(db, "append", (async (id: number) => { appended.push(id); }) as any);
  const opened = t.mock.method(db, "markOpened", (async () => {}) as any);
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  try {
    await registerRoutes(server, app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/referrals`;
    const body = { team: "MEU", consultType: "advice", doctorName: "QA referrer", hospital: "QA facility", phone: "0700000000", specialty: "other", patientInitials: "Q.T.", age: "30", sex: "M", diagnosis: "QA only", history: "Synthetic history", exam: "Synthetic examination", investigations: "Synthetic results", reason: "Advice request", suggestedPriority: "P3", consent: true, lat: "-26.1", lon: "27.9" };
    const submit = (token?: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.equal((await submit()).status, 401);
    assert.equal((await submit("staff")).status, 403);
    assert.equal((await submit("pending")).status, 403);
    assert.equal(createdFor, null);
    const approved = await submit("verified");
    assert.equal(approved.status, 200, await approved.text());
    assert.equal(createdFor, 3);
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: "Bearer verified", "content-type": "application/json" };
    const detail = await fetch(`${base}/api/referrer/referrals/11`, { headers });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).history, "Own clinical history");
    assert.equal(opened.mock.callCount(), 0, "referrer viewing must not count as receiving-staff opening");
    assert.equal((await fetch(`${base}/api/referrer/referrals/12`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/referrer/referrals/11`, { headers: { authorization: "Bearer staff" } })).status, 403);
    assert.equal((await fetch(`${base}/api/referrer/referrals/11`)).status, 401);
    assert.equal((await fetch(`${base}/api/referrals`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/referrer/referrals/11/images/7`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/referrer/referrals/12/images/7`, { headers })).status, 404);
    const update = (id: number, body: string) => fetch(`${base}/api/referrer/referrals/${id}/followup`, { method: "POST", headers, body: JSON.stringify({ body }) });
    assert.equal((await update(12, "Foreign update")).status, 404);
    assert.deepEqual(appended, []);
    assert.equal((await update(11, "x")).status, 400);
    assert.equal((await update(11, "Clinical update from my account")).status, 200);
    assert.deepEqual(appended, [11]);
  } finally {
    (db as any).sessionUser = originalSessionUser;
    (db as any).create = originalCreate;
    (db as any).audit = originalAudit;
    (db as any).update = originalUpdate;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
