import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";

test("the on-call roster is only served to verified referrers and the global administrator", async t => {
  process.env.APP_DB_SECRET = "roster-test-secret-longer-than-thirty-two-characters";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "roster-test-key";
  const { db } = await import("../server/db");
  const { registerRoutes } = await import("../server/routes");
  const users: Record<string, any> = {
    pending: { id: 1, role: "referrer", verifyStatus: "card_pending", active: true },
    none: { id: 2, role: "referrer", verifyStatus: "none", active: true },
    rejected: { id: 3, role: "referrer", verifyStatus: "rejected", active: true },
    verified: { id: 4, role: "referrer", verifyStatus: "verified", active: true },
    admin: { id: 5, role: "admin", active: true },
    staff: { id: 6, role: "clinician", team: "MEU", active: true },
  };
  t.mock.method(db, "sessionUser", async token => users[token] || null);
  t.mock.method(db, "audit", async () => {});
  const app = express(); app.use(express.json());
  const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const get = (token: string) => fetch(`${base}/api/referrer/roster`, { headers: { authorization: `Bearer ${token}` } });
  try {
    for (const who of ["pending", "none", "rejected"]) assert.equal((await get(who)).status, 403, `${who} referrer`);
    assert.equal((await get("staff")).status, 403);
    for (const who of ["verified", "admin"]) assert.equal((await get(who)).status, 200, who);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
