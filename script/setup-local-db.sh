#!/usr/bin/env bash
# One-shot local Supabase database setup for TransferDesk development.
# Applies every schema migration in order and seeds the global-admin owner
# account (OWNER_USERNAME, default "thendricks").
#
# Prereqs: `supabase start` already run (stack on 127.0.0.1:54322), APP_DB_SECRET
# exported in the environment (>= 32 chars, must match what the app server uses).
set -euo pipefail

DB="${SUPABASE_DB_CONTAINER:-supabase_db_transferdesk-source}"
PSQL="docker exec -i $DB psql -U postgres -d postgres -v ON_ERROR_STOP=1"
cd "$(dirname "$0")/.."

if [ -z "${APP_DB_SECRET:-}" ] || [ "${#APP_DB_SECRET}" -lt 32 ]; then
  echo "ERROR: APP_DB_SECRET must be set (>= 32 chars) before running this script." >&2
  exit 1
fi
SHA="$(printf '%s' "$APP_DB_SECRET" | sha256sum | awk '{print $1}')"
echo "APP_DB_SECRET sha256: $SHA"
OWNER_USERNAME="${OWNER_USERNAME:-thendricks}"
[[ "$OWNER_USERNAME" =~ ^[a-z0-9._-]{3,30}$ ]] || { echo "ERROR: OWNER_USERNAME must be 3-30 lowercase letters, digits, dot, dash or underscore" >&2; exit 1; }

echo "== migration.sql (base schema) =="
$PSQL < supabase/migration.sql

echo "== migration_lockdown.sql (x-app-secret RLS) =="
sed "s/REPLACE_WITH_SHA256_OF_APP_DB_SECRET/$SHA/g" supabase/migration_lockdown.sql | $PSQL

echo "== unit_workflows.sql (teams, followups, rosters, RPCs) =="
sed "s/REPLACE_WITH_OWNER_USERNAME/$OWNER_USERNAME/g" supabase/unit_workflows.sql | $PSQL

echo "== migration_hpcsa.sql (HPCSA iRegister table) =="
# Must run after the lockdown migration: it references public.is_app_server().
$PSQL < supabase/migration_hpcsa.sql

echo "== migration_referrers.sql (referrer role and verification state) =="
$PSQL < supabase/migration_referrers.sql

echo "== migration_hardening.sql (loc_source, profile fields, retention) =="
$PSQL < supabase/migration_hardening.sql

echo "== seed owner (global admin) =="
# scrypt hash of the owner password, same algorithm as server/db.ts.
HASH="$(node -e '
const c=require("crypto");
const s=c.randomBytes(16);
const h=c.scryptSync(process.argv[1],s,64,{N:16384});
console.log("scrypt\$"+s.toString("hex")+"\$"+h.toString("hex"));
' "${OWNER_PASSWORD:?set OWNER_PASSWORD}")"

$PSQL <<SQL
insert into users (username, name, role, pass_hash, active, must_change)
values ('$OWNER_USERNAME', 'Owner', 'admin', '$HASH', true, false)
on conflict (username) do update set pass_hash = excluded.pass_hash, active = true, must_change = false;
SQL

echo "== verify =="
$PSQL -tAc "select 'users='||count(*) from users;"
$PSQL -tAc "select 'policies='||count(*) from pg_policies where tablename in ('users','sessions','referrals','referral_followups','referral_images','unit_rosters','audit_log','settings','hpcsa_register');"
echo "Done. Local DB is ready at http://127.0.0.1:54321"
