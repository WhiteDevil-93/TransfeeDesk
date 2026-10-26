import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import express from "express";

test("only verified referrers can submit a referral", async () => {
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
  } finally {
    (db as any).sessionUser = originalSessionUser;
    (db as any).create = originalCreate;
    (db as any).audit = originalAudit;
    (db as any).update = originalUpdate;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
