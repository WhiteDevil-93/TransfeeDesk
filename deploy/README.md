# renderer-b deployment

Target: Ubuntu ARM64 at `84.12.115.40`. Public origin:
`https://barabridge.84-12-115-40.sslip.io`. The former TransferDesk address
redirects browser pages to BaraBridge while retaining its existing API and PWA
asset routes for older clients.

The existing Supabase project remains authoritative. No schema, account, key,
or image-encryption policy is changed by deployment.

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

If credential checks fail, leave the clinical service unavailable; do not rotate
the secret or weaken RLS. If a release fails, point `current` at the preceding
release and restart only TransferDesk. Restore the saved Caddy configuration if
the proxy change fails. Never stop/restart unrelated renderer or bot services.

`data.js` is imported from the private CHBAH-call-roster repository into the
runtime directory. It is never served as a public static asset. Its existing
authenticated API readers remain responsible for access control. The source
repo's daily watcher is independent; automated deployment of new roster commits
must be configured and verified separately.

The application runs behind Caddy on loopback port 5000; setup uses loopback 5001.
Only ports 80 and 443 are added to the host firewall. Bulk HPCSA refresh is
disabled in the web process (`HPCSA_AUTO_REFRESH=0`) pending an independent job.
After `supabase/migration_hpcsa.sql` is applied, run the packaged
`dist/hpcsa-scrape.cjs` worker under `transferdesk-hpcsa.service` to seed the
surname checklist. Enable `transferdesk-hpcsa.timer` only after that run
passes. The timer refreshes the checklist twice monthly without restarting
the clinical server. It does not perform the full A-Z register export.

This deployment does not claim native Windows/Android/iOS packaging, push
delivery, live clinical workflow validation, or tested backup restoration.
