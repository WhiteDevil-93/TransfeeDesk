# BaraBridge UX Pilot implementation

Eight coordinated mobile screens were generated with UX Pilot after the user
approved one default Glide run. Job `ObArydpyV6Am8IWWC4fr` completed for 28 credits.
The [design page](https://uxpilot.ai/a/ui-design?page=cvlOiJaPeFpRofkHJ7yj) and the
[exact brief](ux-pilot-brief.md) preserve the source and scope.

## Screen mapping

| Generated screen | Application implementation |
| --- | --- |
| Home | `App.tsx`: role cards, account-aware continuation, public follow-up and privacy links |
| SignIn | `App.tsx` and `referrer-auth.tsx`: audience switch, password visibility, role-aware authentication, recovery routes |
| Onboarding | `referrer-auth.tsx` and `portal.tsx`: professional profile, account details, real verification outcome and card-received state |
| MyConsults | `portal.tsx`: compact patient-first cards, search, primary new referral, labelled phone navigation |
| NewReferral | `referral-form.tsx`: referral, clinical details, review/send; preserved input, inline errors, consent and private receipt |
| CaseDetail | `portal.tsx`: accessible dialog, clear decision/advice, response history and follow-up composer |
| ReceivingQueue | `App.tsx`: compact counts and filters, urgency-first sorting, clinical cards, desktop sidebar |
| ReceivingCase | `App.tsx` and `admin.tsx`: patient banner, real information tabs, separate decision actions, account administration |

`clinical.css` and the shared controls provide the teal/slate palette, white
cards, focus states, larger primary controls, fixed labelled phone navigation,
safe-area spacing and desktop layout. Screen/account changes reset scroll;
referral steps focus their heading while accounting for the sticky header.
The receiving case header and close control stay outside its scrolling body;
account changes clear notices belonging to the previous session.

## Deliberate corrections to generated content

- Sign-in uses the real username contract and 30-minute inactivity timeout.
- Facility and department are required/collected where appropriate on each
  referral; signup no longer collects profile fields the database cannot save.
- No draft autosave, unread/delivery guarantee, generated avatar, fake history,
  invented clinical fields or clinical quick replies were added.
- An opened receipt remains separate from acceptance for transfer. Advice-only,
  accepted, waiting and declined retain their distinct server actions.
- A safe `hasCard` boolean reports an uploaded staff card without returning its
  encrypted contents. The existing verification and access rules remain in force.
- Clinical form code loads separately from entry pages to keep their initial
  JavaScript bundle below 500 kB uncompressed.

## Validation

Run `npm run check`, `npm run build`, and the access, referral-submission-auth,
session-expiry and HPCSA-verification test files. Then start
`npx tsx tests/navigation-fixture.ts` and run `tests/navigation-smoke.mjs` against
the built client. The fixture uses synthetic accounts/cases and real Express
handlers with an in-memory database, without writing to Supabase.

Browser checks cover role recovery, signup/card feedback, verification gating,
three-step validation and input preservation, private receipts, case updates,
urgent-first sorting, receiving-team advice, admin navigation, password change,
P1 acknowledgment, session expiry and recovery. Screenshots use 390 x 844 and 1280 x 900 viewports;
finite transitions finish before capture. Long pages are captured from the top;
dialogs use viewport captures. Evidence is saved in the ignored
`artifacts/navigation-audit/` directory.
Start a fresh fixture process for a repeat run: production authentication rate
limits intentionally remain active in the fixture.

Production public-entry checks use `--public-only` with `TEST_BASE` set to the
live origin. These checks do not establish real clinician acceptance, external
notification delivery or manual verification quality; those still need pilot
testing with the receiving teams.
