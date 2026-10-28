# renderer-b deployment

Target: Ubuntu ARM64 at `84.12.115.40`. Public origin:
`https://barabridge.84-12-115-40.sslip.io`. The former TransferDesk address
redirects browser pages to BaraBridge while retaining its existing API and PWA
asset routes for older clients.

The existing Supabase project remains authoritative. Keep `APP_DB_SECRET`
unchanged. Apply the documented migrations before activating server code that
depends on them; introduce `APP_DATA_KEY` only after its recovery copy is verified.

## Gates and recovery

```text
Hosted credentials ---- publishable key + ORIGINAL image secret ---+
Network -------------- DNS + OCI ingress + host firewall ---------+--> Working HTTPS API
Runtime -------------- Node 24 + built bundle + service account ---+
Preservation --------- separate services; existing workloads intact+
```

1. Build with `npm ci`, `npm run check`, `npx tsx --test tests/access.test.ts`,
   and `npm run build`. Package only built files, dependency manifests, roster,
   runtime surname checklist, and deploy files. Never package `.env` or databases.
2. Install Node 24 ARM64 (verify official SHA256), Caddy from its official apt
   repository, and production dependencies under a versioned release directory.
   Keep prior releases; change `/opt/transferdesk/current` only after checks pass.
3. Run `transferdesk-setup.service` with a root-protected environment file and a
   random 256-bit capability token expiring after 24 hours. The private setup URL
   carries its token in a fragment, not a request URL. The page accepts only the
   original APP_DB_SECRET, checks negative and positive Supabase policy results,
   and verifies decryption of an existing image if present. It writes the runtime
   environment with mode 0600 only after verification. No database writes occur.
4. Activate `transferdesk.service` only after credentials verify. Require HTTP 200
   and `status=ready` at `/api/health`, valid public TLS, blocked anonymous access
   to clinical API routes, and no direct external access to port 5000.
5. Stop and disable the temporary setup service after handoff. Remove its token
   environment file. Never record the token or secret in Git, logs, or job cards.

6. Before activating this version, apply the README's missing migrations in
   order: `migration_integrity.sql`, `migration_chat_push.sql`, then
   `migration_profile_retention.sql` (additive and re-runnable). Generate
   `APP_DATA_KEY` (for example `openssl rand -hex 32`),
   store it in the secrets manager first, append it to
   `/var/lib/transferdesk/runtime.env` as `APP_DATA_KEY="..."`, restart
   `transferdesk.service`, and run `node dist/reencrypt-data.cjs --dry-run`, then
   without `--dry-run`, with the same environment to move existing images and staff cards off the
   `APP_DB_SECRET`-derived key. Until then the server logs a warning and keeps
   using the legacy key.

If credential checks fail, preserve the working deployment; do not rotate
the database secret or weaken RLS. If a release fails, use a tested compatible
release and restart only TransferDesk. Once any `v2:` image/card has been written,
keep `APP_DATA_KEY` and do not roll back to a legacy-only server: it cannot read
those records. A pre-v2 rollback also requires restoring a matching protected
pre-migration data backup. Restore the saved Caddy configuration if
the proxy change fails. Never stop/restart unrelated renderer or bot services.

`data.js` is imported from the private CHBAH-call-roster repository into the
runtime directory. It is never served as a public static asset. Its existing
authenticated API readers remain responsible for access control. The source
repo's daily watcher is independent; automated deployment of new roster commits
must be configured and verified separately.

The application runs behind Caddy on loopback port 5000; setup uses loopback 5001.
Only ports 80 and 443 are added to the host firewall. Bulk HPCSA refresh is
disabled in the web process (it only runs with `HPCSA_AUTO_REFRESH=1`; the
handoff also writes `HPCSA_AUTO_REFRESH=0`) pending an independent job.
After `supabase/migration_hpcsa.sql` is applied, run the packaged
`dist/hpcsa-scrape.cjs` worker under `transferdesk-hpcsa.service` to seed the
surname checklist. Enable `transferdesk-hpcsa.timer` only after that run
passes. The timer refreshes the checklist twice monthly without restarting
the clinical server. It does not perform the full A-Z register export.

Web push is off until `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
are added to `/var/lib/transferdesk/runtime.env` (keys from `npx web-push
generate-vapid-keys`) and `supabase/migration_chat_push.sql` is applied; restart
TransferDesk afterwards and check that `/api/health` reports `push: "enabled"`.

This deployment does not claim native Windows/Android/iOS packaging, push
delivery, live clinical workflow validation, or tested backup restoration.
