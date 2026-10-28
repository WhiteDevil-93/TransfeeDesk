# BaraBridge source code

This is the editable source of the BaraBridge web application, held in the existing TransfeeDesk repository. It is a development handoff, not an Android APK, iPhone build or production-compliance certification. No patient records, real passwords, database credentials or staff contacts are included.

## What is included

| Folder / file | Purpose | Phone-app reuse |
|---|---|---|
| `client/src/App.tsx` | Current web screens: referral form, queue, account access, decisions, on-call and catchment map | Adapt for mobile, or retain inside Capacitor |
| `client/src/workflows.tsx` | Advice, secure follow-up portal, images and unit rosters | Workflows reusable; browser/device code requires adaptation |
| `client/src/admin.tsx` | Unit and global account administration | Retain as a web management interface, or adapt |
| `server/routes.ts` | HTTP API, authentication and unit-access enforcement | Reuse as the hosted backend |
| `server/db.ts` | Persistent database operations, passwords, sessions and image encryption | Reuse on the server only |
| `shared/schema.ts` and `shared/teams.ts` | Validation, types and MEU/TEU/SEU permission helpers | Reuse where appropriate; server remains the authority |
| `supabase/` | Database schema, security policies and migrations | Reuse after configuring for the target environment |
| `tests/` | Unit-permission and API integration tests | Retain for regression testing |
| `WORKFLOW.md` | Roles, referrals, advice, follow-ups and limitations | Read before changing behaviour |
| `roster.json` | Sanitized specialty catalogue with empty schedules and contacts | Replace privately with an authorized roster if needed |

The app uses React/TypeScript, an Express backend and Supabase. The server is not bundled into a mobile app; mobile clients must call a permanently hosted HTTPS API. Never copy server database keys or the image-encryption secret into Android/iPhone client code.

## Local development

Install dependencies and build:

```sh
npm ci
npm run check
npx tsx --test tests/access.test.ts
npm run build
```

After configuring the database and runtime secrets, start the built app:

```sh
npm start
```

The default port is 5000. The build output is `dist/index.cjs` (server) and `dist/public/` (web frontend). The integration tests require a dedicated test database and running API:

```sh
INTEGRATION_DB_ISOLATED=1 TEST_BASE=http://127.0.0.1:5000 npx tsx tests/integration.ts
```

Do not run integration tests against the live hospital database: they create temporary users, referrals and audit events. The script refuses the known live project and requires explicit acknowledgement of a disposable database. Build first: integration also exercises `dist/reencrypt-data.cjs` with synthetic legacy image/card data, verifies plaintext preservation, then confirms a repeat dry-run finds nothing to migrate. Configure an independent test `APP_DATA_KEY` for that check.

## Private configuration

Copy `.env.example` to `.env` and provide your own Supabase URL, anon key and secrets. Store both secrets in a secrets manager:

- `APP_DB_SECRET` authorizes the server to the database (it is sent to Supabase in the `x-app-secret` header). The live application's existing value must be preserved when connecting to its existing database: the lockdown policy checks it, and images written before `APP_DATA_KEY` existed are encrypted with a key derived from it.
- `APP_DATA_KEY` (32+ random characters, different from `APP_DB_SECRET`) is the root of the image and staff-card encryption keys. It never leaves the server, so Supabase holds ciphertext without the key. **Back it up**: losing it makes every image written with it unreadable. Without it the server still runs, logs a warning, and keeps using the legacy key.

After setting `APP_DATA_KEY` on an existing deployment, move older images and staff cards to the new key with `npx tsx script/reencrypt-data.ts --dry-run`, then without `--dry-run`. The script is safe to re-run; already migrated rows are skipped.

For a new, separate development database, apply the SQL files in this order (or run `script/setup-local-db.sh`, which does all of this):

1. `supabase/migration.sql`
2. `supabase/migration_lockdown.sql`, replacing `REPLACE_WITH_SHA256_OF_APP_DB_SECRET` with the lowercase SHA-256 digest of your new server secret
3. `supabase/unit_workflows.sql`
4. `supabase/migration_hpcsa.sql` — the `hpcsa_register` table (HPCSA iRegister snapshot, see below)
5. `supabase/migration_referrers.sql` — referrer role, profile columns and verification state
6. `supabase/migration_integrity.sql` — `referrals.loc_source`, purged-referral follow-up guard, normalized HPCSA numbers and unique account emails. Existing databases need this file too.
7. `supabase/migration_chat_push.sql` — referral chat (`question` and `reply` messages, `referrals.awaiting_info_at`) and push notification tables. The server reads the new column, so apply this before deploying this version.
8. `supabase/migration_profile_retention.sql` — referrer `hospital` and `department` columns, and a retention purge that also clears the patient's location and bed fields.

`migration.sql` creates no access policies, so the API roles are denied everything until the lockdown migration runs. Do not expose the service until the lockdown migration is complete; `tests/migrations.test.ts` checks that every column the queue reads is created by these files.

Moving an existing database to unit workflows also requires the one-time `supabase/bootstrap_owner_once.sql` (`psql -v owner=<username> -f …`), which signs out and demotes every other global admin. It is deliberately kept out of the routine migrations so they can be re-run safely. Provision the owner account separately with a scrypt password hash generated by `hashPw` in `server/db.ts`; no bootstrap account or default password is included in this export. For the existing deployment, users and referrals already live in its separate database and are intentionally not exported.

For standalone hosting or a phone app, replace the preview-specific `__PORT_5000__` API configuration in `client/src/lib/queryClient.ts` with the production API origin or same-origin routing. Add a strict approved-origin CORS policy if the client and server are on different origins; the current API does not yet implement that mobile-origin configuration.

## Referrer accounts and HPCSA verification

Referring clinicians (doctors, nurses and other professionals) get a lightweight
account on the referral PWA, separate from receiving-staff accounts but in the
same `users` table with the role `referrer`. On signup they supply their HPCSA
registration number. The register is public, so a match against the
`hpcsa_register` table (name + number, active status) only shows the person
exists: the account is flagged "HPCSA register match" in the owner's
verification queue and still needs the owner's approval. A miss, or no HPCSA
number, puts the account in the same queue with a staff-card photo upload
(encrypted at rest, same scheme as clinical images). Until approved, a referrer
cannot send referrals or see the on-call roster. A verified referrer who changes
their name or HPCSA number returns to the queue until the owner confirms it.
Referrals carry the account's name, cellphone and email rather than whatever
the form submitted.

The register snapshot is scraped from the public HPCSA iRegister
(`hpcsaonline.custhelp.com`):

- `script/hpcsa-scrape.ts` — searches iRegister by surname (wildcard) and
  upserts matches. Run with `npx tsx script/hpcsa-scrape.ts SURNAMES...`, or
  with no arguments to process `script/hpcsa_surnames.txt`.
- **Bulk export** — a single wildcard call returns *all* practitioners whose
  surname matches a prefix (`surName="A*"` ≈ 10–60k rows, ~1–11 MB), so the
  whole ~600k-row register is 26 requests (A–Z, a few minutes):
  `bash script/run-hpcsa-bulk.sh` (or `--bulk C D` for specific letters).
  Progress is tracked in `script/hpcsa_bulk_state.json` — an interrupted
  sweep resumes where it stopped. Re-run after any interruption to finish.
- The web process does not refresh the register unless `HPCSA_AUTO_REFRESH=1`
  (bulk export every 14 days, `server/index.ts`); production uses the separate
  `transferdesk-hpcsa` service instead. `HPCSA_NOW=1` forces a refresh ~15 s
  after boot (dev). Bulk resume state defaults to `/var/lib/transferdesk` when
  that directory exists, otherwise `script/`.
- When a referrer signup cannot be verified, the server appends the surname to
  the checklist and fetches that one surname immediately, so the next signup
  attempt can verify without waiting 14 days.

After a bulk export, `hpcsa_register` covers the entire public register —
name-based signup verification no longer depends on the surname checklist
(the checklist still runs between bulk sweeps for targeted refreshes). Referrer
referral rows are
tagged with `referrals.referrer_id` so each referrer sees only their own
consults; patient data of other referrers stays invisible. Verified referrers
see the full on-call roster (`/api/referrer/roster`).

## Referral chat, push notifications and who is on duty

**Chat.** Inside a referral the receiving team can ask the referrer for more information (`POST /api/referrals/:id/question`, History & chat tab) and the referrer answers from their consult (signed-in referrers) or the follow-up page. Questions and replies are rows in the same append-only `referral_followups` timeline as updates and advice, so they are audited, included in the administrator's referral export, and deleted by the same retention purge. A question sets `referrals.awaiting_info_at`, which shows "Waiting for referrer" on the queue and a banner on the referrer's side; the referrer's reply, a decline or an advice-only answer clears it. A question does not change the referral's status.

**Who is on duty.** The On call page lists the unit's active accounts. Ticking an account for a date means it is taking consults that day. Today's ticked accounts receive push notifications for every new referral, every referrer follow-up or reply and every waiting-list reminder for the unit. If nobody is ticked, the whole unit is notified. The roster page shows which accounts have no push device. Rosters are by calendar day (South African time) so a night shift that crosses midnight needs both days ticked.

**Escalation.** Notifications go to the rostered accounts straight away. If a new referral is still unopened, or a follow-up is still unread, after the escalation delay (Alerts settings, default 10 minutes), every active member of the unit is notified, then again at each further interval, at most three times. A waiting-list referral notifies at its reminder time and repeats at the reminder interval, reaching the whole unit from the second repeat. The referrer is notified immediately when a question or a decision is posted and reminded after the same delay while a question is unanswered. A single in-process timer runs once a minute; each alert is recorded in `push_sent` first, so a restart or a second process does not send it twice.

**Setup.** Push uses Web Push (VAPID). Generate keys once with `npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:` an operator address) in the server environment. Without them push is off, `/api/health` reports `push: "not configured"` and the browser toggle explains this. Users turn push on per device from the bell menu (staff) or the consult list (referrers, and the follow-up page for anonymous referrers). Signing out turns it off for that device. Push needs the installed or production build with its service worker and HTTPS; on iPhone the app must be added to the Home Screen first. The server only sends to the push services browsers use (Google, Mozilla, Apple, Microsoft); other endpoints are rejected. Payloads carry the reference, unit and priority only, never patient details. Delivery is best effort and still not a guaranteed emergency channel: keep the P1 alarm and a telephone escalation path.

## Two phone-app routes

- **Capacitor:** package the existing React web UI in Android/iOS projects, then adapt API routing, notification registration, image capture, authentication storage and external-link handling. Capacitor supports integration with an existing React project ([Capacitor React guide](https://capacitorjs.com/solution/react)).
- **React Native / Expo:** reuse the hosted backend, shared validation and workflows, but build new mobile screens with native components instead of the web components in this frontend ([React Native components](https://reactnative.dev/docs/intro-react-native-components)).

Neither route is implemented in this export. There are no `android/` or `ios/` projects, signing keys or mobile push credentials included. Camera capture, native push notifications, secure on-device token storage and signed installable builds still require implementation and device testing.

## Safety and operations

Technical access controls do not establish POPIA compliance. Production still needs hospital approval, operator agreements, a documented retention policy, independent tested backups, monitoring and a breach process. The browser alerts and web push notifications are not a guaranteed emergency notification service. Confirm P1 acknowledgement and retain a telephone escalation pathway.

Rate limits for sign-in, sign-up, status lookup, the follow-up portal and submissions are held in the API process's memory. They assume one API process on one host: a restart resets them and each additional process multiplies the allowance. Add proxy-level or shared-store limits before running more than one instance. Account lockout after five failed sign-ins is stored in the database and is not affected.

Sign-in tokens for every role are kept in the browser's session storage, so closing the tab or app signs the user out (referrers who used an older version are signed out once). The follow-up page exchanges the private code for a signed 30-minute token (12-hour maximum) and uses that for refreshes, updates and image reads; resetting the code or purging the referral ends it. Older clients that still send the code with each request continue to work. The on-call roster, which lists staff phone numbers, is served only to verified referrers and the global administrator. WhatsApp drafts to referring doctors carry the reference only.

Audit-log writes that fail are retried and held in a bounded in-memory queue (500 entries, lost if the process restarts). `/api/health` reports `audit.state` as `degraded`, with the queued and dropped counts, whenever that backlog is not empty or an entry has ever been dropped; alert on it. Case reads and changes are not blocked while the audit log is unavailable.

Only the dependency versions locked in this archive were checked during export. Dependencies, policies and clinical workflows require ongoing review.

## Dependency audit (audited 28 October 2026)

Re-run `npm audit` after every dependency change and replace this section with
its actual output.

- `npm audit --omit=dev` (what ships to the server): **0 vulnerabilities**.
- `npm audit` (including build tools): **4 low-severity**, one underlying issue.
  `deepmerge` (prototype poisoning in `mergeObject()`,
  [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)) is
  reached through `vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-node-resolve`.
  It runs only while the service worker is generated at build time, on trusted
  input, and is not in the server or the client bundle. The latest published
  `deepmerge` (4.3.1) is inside the affected range, and the only suggested "fix" (`npm audit fix --force`) installs
  `vite-plugin-pwa@0.2.1`, a major downgrade, so it is carried as an accepted
  build-time-only risk.

Fixed on this date by `npm audit fix` within the existing semver ranges: `zod`
4.6.5 → 4.6.7 (memory exhaustion on oversized collections), `express`'s
`body-parser` 2.3.0 → 2.4.0 (compressed-body DoS), `qs` 6.16.0 → 6.17.0,
`fast-uri` 3.1.8 → 3.1.9, `vite` 7.3.6 → 7.3.7 and `serialize-javascript`
7.1.2 → 7.1.4. The earlier `braces` advisory no longer appears. The unused
`drizzle-kit` dev dependency and the `db:push` script were removed: this project
has no Drizzle configuration, and the schema is managed by the SQL files in
`supabase/`. The unused template dependencies `passport`, `passport-local`,
`express-session` and `memorystore` (and their type packages) were removed too. Typecheck, the unit tests and the production build pass on the
updated tree, and a clean `npm ci` installs it.
