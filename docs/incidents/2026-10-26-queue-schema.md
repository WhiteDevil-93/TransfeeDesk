# Staff queue failure after the UX release

At 20:23 SAST the owner reported a signed-in admin screen displaying the queue
load error. Renderer-b logged `GET /api/referrals 500` and
`column referrals.referrer_id does not exist`. A temporary five-minute owner
admin session reproduced HTTP 500 against the public API; the session was then
deleted. No patient data or session credentials were written to test evidence.

The hosted database had not received `supabase/migration_referrers.sql`:
zero-row probes also confirmed that `users.email` is missing. Application keys
can read/write permitted records but cannot apply schema DDL. The local Supabase
CLI has no administrative access token. The owner has been supplied the exact
transactional migration to run in the SQL Editor; it adds fields and indexes
without deleting clinical records or changing row-level policies.

The owner subsequently requested Supabase MCP setup. The project-scoped server
was registered and OAuth completed in the already signed-in Chrome session.
The current chat's tool inventory did not reload the new server mid-turn, so
the existing migration was applied in a separate new Supabase SQL Editor query,
wrapped in `begin`/`commit` with a PostgREST schema-cache notification. The
owner's pre-existing SQL query was preserved. Supabase reported
`Success. No rows returned`; independent server-side zero-row queries then
confirmed every referrer profile/card field and `referrals.referrer_id`.

## Immediate repair

- Staff list queries select only columns required by the staff queue. This
  restores their compatibility with the existing hosted schema.
- Referrer queries still select and filter by `referrer_id`. They fail closed
  when the ownership migration is missing, with no unscoped retry.
- Readiness validates the real staff projection with a zero-row query as well
  as the server-secret check. A correct secret alone previously returned ready
  even when the queue could not load.

The local browser fixture replaced database functions and therefore did not
exercise the deployed schema. The original live checks covered public entry
pages and rejection of unauthenticated access, leaving authenticated database
queries untested. The regression test now uses the actual Supabase query
builder against a local PostgREST fixture that rejects missing columns. It
checks global/unit staff queries, unassigned staff isolation, referrer failure
without fallback, owner filtering after migration, and readiness failure for
an invalid core projection.

## Verification and remaining work

`npm run check`, the production build and nine selected tests passed before
deployment. Live before/after reports are kept under ignored
`artifacts/queue-fix/`; the post-deployment check authenticates a temporary
five-minute administrator session, loads the real phone queue, navigates to
Admin and returns to Queue, then deletes the session. It does not change any
referral or account and does not save clinical screenshots.

After hotfix `05d49bf`, the live authenticated API returned HTTP 200 and two
existing referrals. A 390 x 844 browser loaded the admin queue, navigated to
Admin and returned to Queue with zero runtime errors. The temporary session
was deleted. After the migration, the same live checks passed again and the
queue-aware health endpoint returned HTTP 200 `ready`. `codex mcp list`
reported the exact project/feature URL as `enabled` with `OAuth` authentication.

Restoring the staff queue alone does not establish end-to-end signup/card
verification or clinician acceptance. Future releases must
check all required migrations and an authenticated read, rather than infer
database compatibility from public navigation or server-secret health alone.
