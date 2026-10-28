#!/usr/bin/env bash
# One-shot local Supabase database setup for TransferDesk development.
# Applies every schema migration in the order documented in README.md and
# seeds the global-admin owner account.
#
# Prereqs: `supabase start` already run (stack on 127.0.0.1:54322), APP_DB_SECRET
# exported in the environment (>= 32 chars, must match what the app server uses).
set -euo pipefail

DB="${SUPABASE_DB_CONTAINER:-supabase_db_transferdesk-source}"
PSQL="${PSQL:-docker exec -i $DB psql -U postgres -d postgres -v ON_ERROR_STOP=1}"
OWNER="${OWNER_USERNAME:-thendricks}"
cd "$(dirname "$0")/.."

if [ -z "${APP_DB_SECRET:-}" ] || [ "${#APP_DB_SECRET}" -lt 32 ]; then
  echo "ERROR: APP_DB_SECRET must be set (>= 32 chars) before running this script." >&2
  exit 1
fi
SHA="$(printf '%s' "$APP_DB_SECRET" | sha256sum | awk '{print $1}')"
echo "APP_DB_SECRET sha256: $SHA"

echo "== migration.sql (base schema, deny-by-default) =="
$PSQL < supabase/migration.sql

echo "== migration_lockdown.sql (x-app-secret RLS) =="
sed "s/REPLACE_WITH_SHA256_OF_APP_DB_SECRET/$SHA/g" supabase/migration_lockdown.sql | $PSQL

echo "== unit_workflows.sql (teams, followups, rosters, RPCs) =="
$PSQL < supabase/unit_workflows.sql

echo "== migration_hpcsa.sql (HPCSA iRegister table) =="
# Must run after the lockdown migration: it references public.is_app_server().
$PSQL < supabase/migration_hpcsa.sql

echo "== migration_referrers.sql (referrer role, profile, ownership) =="
$PSQL < supabase/migration_referrers.sql

echo "== migration_integrity.sql (loc_source, purge guards, unique email) =="
$PSQL < supabase/migration_integrity.sql

echo "== migration_chat_push.sql (referral chat, push subscriptions, purge update) =="
$PSQL < supabase/migration_chat_push.sql

echo "== seed owner (global admin) =="
# scrypt hash of the owner password, same algorithm as server/db.ts.
HASH="$(node -e '
const c=require("crypto");
const s=c.randomBytes(16);
const h=c.scryptSync(process.argv[1],s,64,{N:16384});
console.log("scrypt\$"+s.toString("hex")+"\$"+h.toString("hex"));
' "${OWNER_PASSWORD:?set OWNER_PASSWORD}")"

$PSQL -v owner="$OWNER" -v hash="$HASH" <<'SQL'
insert into users (username, name, role, pass_hash, active, must_change)
values (:'owner', 'Owner', 'admin', :'hash', true, false)
on conflict (username) do update set pass_hash = excluded.pass_hash, active = true, must_change = false;
SQL

echo "== verify =="
$PSQL -tAc "select 'users='||count(*) from users;"
$PSQL -tAc "select 'policies='||count(*) from pg_policies where tablename in ('users','sessions','referrals','referral_followups','referral_images','unit_rosters','push_subscriptions','push_sent','audit_log','settings','hpcsa_register');"
echo "Done. Local DB is ready at http://127.0.0.1:54321"
