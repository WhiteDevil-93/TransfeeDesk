#!/usr/bin/env bash
# One-shot: verify RLS gating on hpcsa_register via the PostgREST API.
cd "$(dirname "$0")/.."
set -a; source .env; set +a
node -e "
const { createClient } = require('@supabase/supabase-js');
(async () => {
  const noSec = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const a = await noSec.from('hpcsa_register').select('registration_number');
  console.log('no-secret rows:', a.data.length, 'err:', a.error && a.error.message);
  const sec = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { 'x-app-secret': process.env.APP_DB_SECRET } } });
  const b = await sec.from('hpcsa_register').select('registration_number');
  console.log('with-secret rows:', b.data.length, 'err:', b.error && b.error.message);
})();
"
