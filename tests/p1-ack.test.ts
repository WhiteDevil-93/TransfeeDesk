import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";

test("P1 acknowledgement records where it came from and never stores the marker", async t => {
  process.env.APP_DB_SECRET = "ack-test-secret-longer-than-thirty-two-characters";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "ack-test-key";
  const { db } = await import("../server/db");
  const { registerRoutes } = await import("../server/routes");
  const updates: any[] = [], audits: any[] = [];
  t.mock.method(db, "sessionUser", async () => ({ id: 1, name: "Dr Admin", role: "admin", active: true }) as any);
  t.mock.method(db, "get", async () => ({ id: 9, team: "MEU", priority: "P1", status: "pending" }) as any);
  t.mock.method(db, "update", async (_id: number, patch: any) => { updates.push(patch); return { id: 9 } as any; });
  t.mock.method(db, "audit", async row => { audits.push(row); });
  const app = express(); app.use(express.json());
  const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const patch = (body: any) => fetch(`${base}/api/referrals/9`, { method: "PATCH", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await patch({ ack: "spoofed", ackVia: "alarm" })).status, 200);
    assert.equal((await patch({ ack: "spoofed", ackVia: "case" })).status, 200);
    assert.equal((await patch({ priority: "P2" })).status, 200);
    assert.equal((await patch({ ack: "x", ackVia: "queue" })).status, 400, "unknown origins are rejected");
    assert.deepEqual(updates, [{ ack: "Dr Admin" }, { ack: "Dr Admin" }, { priority: "P2" }]);
    const details = audits.filter(a => a.action === "update_referral").map(a => a.detail);
    assert.match(details[0], /ack=Dr Admin.*ackVia=alarm/);
    assert.match(details[1], /ackVia=case/);
    assert.doesNotMatch(details[2], /ackVia/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
