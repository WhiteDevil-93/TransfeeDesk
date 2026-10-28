import assert from "node:assert/strict";
import { test } from "node:test";

process.env.APP_DB_SECRET ||= "audit-test-secret-longer-than-thirty-two-characters";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ||= "audit-test-key";
const { db, sb, auditStatus, flushAuditQueue } = await import("../server/db");

test("failed audit writes are retried, kept in order, and reported until they land", async t => {
  const written: any[] = [];
  let healthy = false, attempts = 0;
  t.mock.method(console, "error", () => {});
  t.mock.method(sb, "from", ((table: string) => ({ insert: async (row: any) => { attempts++; if (!healthy) return { error: { message: "database unavailable" } }; written.push({ table, ...row }); return { error: null }; } })) as any);

  await db.audit({ action: "first", userName: "A" });
  assert.equal(attempts, 2, "one immediate retry");
  assert.deepEqual(auditStatus(), { queued: 1, dropped: 0 });

  await db.audit({ action: "second", userName: "B" });
  assert.equal(auditStatus().queued, 2, "later entries wait behind the failed one");

  healthy = true;
  await flushAuditQueue();
  assert.deepEqual(auditStatus(), { queued: 0, dropped: 0 });
  assert.deepEqual(written.map(w => w.action), ["first", "second"]);
  assert.equal(written[0].table, "audit_log");

  await db.audit({ action: "third" });
  assert.deepEqual(written.map(w => w.action), ["first", "second", "third"]);
});

test("a database that throws is treated like one that errors, and the backlog is bounded", async t => {
  t.mock.method(console, "error", () => {});
  t.mock.method(sb, "from", (() => ({ insert: async () => { throw new Error("socket closed"); } })) as any);
  const before = auditStatus();
  for (let i = 0; i < 510; i++) await db.audit({ action: `burst-${i}` });
  const after = auditStatus();
  assert.equal(after.queued, 500);
  assert.equal(after.dropped - before.dropped, 10 + before.queued, "oldest entries are dropped and counted, never silently");
});
