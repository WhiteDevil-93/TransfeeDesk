import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const ORDER = ["migration.sql", "migration_lockdown.sql", "unit_workflows.sql", "migration_hpcsa.sql", "migration_referrers.sql", "migration_integrity.sql", "migration_chat_push.sql", "migration_profile_retention.sql"];
const sql = (file: string) => fs.readFileSync(`supabase/${file}`, "utf8").replace(/--[^\n]*/g, "");

function referralColumns(): Set<string> {
  const cols = new Set<string>();
  for (const file of ORDER) {
    const text = sql(file);
    const create = /create table if not exists referrals\s*\(([\s\S]*?)\);/i.exec(text);
    if (create) for (const part of create[1].split(",")) { const name = part.trim().split(/\s+/)[0]; if (name) cols.add(name); }
    for (const m of text.matchAll(/alter table referrals add column if not exists (\w+)/gi)) cols.add(m[1]);
  }
  return cols;
}

test("the documented migrations create every referral column the server reads or writes", async () => {
  process.env.APP_DB_SECRET ||= "migration-test-only-secret-longer-than-thirty-two";
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY ||= "migration-test-only-key";
  const { REFERRAL_QUEUE_COLUMNS } = await import("../server/db");
  const cols = referralColumns();
  const needed = [...REFERRAL_QUEUE_COLUMNS.split(","), "referrer_id", "portal_hash", "loc_source", "history", "exam", "investigations", "folder_no", "email"];
  assert.deepEqual(needed.filter(c => !cols.has(c)), []);
});

test("README and the local setup script apply the same complete migration order", () => {
  const readme = fs.readFileSync("README.md", "utf8");
  const script = fs.readFileSync("script/setup-local-db.sh", "utf8");
  const positions = (text: string) => ORDER.map(file => text.indexOf(`supabase/${file}`));
  for (const [name, text] of [["README.md", readme], ["setup-local-db.sh", script]] as const) {
    const at = positions(text);
    assert.ok(at.every(i => i >= 0), `${name} must apply ${ORDER.filter((_, i) => at[i] < 0).join(", ")}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, `${name} must apply migrations in order`);
  }
  const shipped = fs.readdirSync("supabase").filter(f => f.endsWith(".sql") && f !== "bootstrap_owner_once.sql");
  assert.deepEqual(shipped.filter(f => !ORDER.includes(f)), [], "every routine migration is in the documented order");
});

test("migrations never grant open access and routine files are safe to re-run", () => {
  for (const file of ORDER) assert.doesNotMatch(sql(file), /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i, `${file} grants unconditional access`);
  for (const file of ORDER) assert.doesNotMatch(sql(file), /delete from (sessions|users)\b|update users set role/i, `${file} changes accounts; keep that in bootstrap_owner_once.sql`);
});
