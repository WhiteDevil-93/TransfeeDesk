# BaraBridge role access

| Capability | Global admin | Unit admin | Team member | Referrer |
| --- | --- | --- | --- | --- |
| Receiving queue and case actions | Every unit | Own unit | Own unit | No |
| Referral form and submission | Yes, attributed to admin | No | No | After verification |
| Referrer workspace and case history | All consults | No | No | Own consults |
| Administration navigation | Admin | Unit admin | Hidden | Hidden |
| Provision/reset/deactivate staff | Across units, protected global account excluded | Own-unit clinicians only | No | No |
| Change staff role or unit | Yes | No | No | No |
| Manage another unit administrator | Yes | No, including same-unit administrators | No | No |
| Unit duty roster changes | Every unit | Own unit | Read own unit | Read hospital roster after verification |
| Staff directory (`/api/team`) | Every unit | Own unit | Own unit | No |
| Referrer verification, audit, privacy/data settings | Yes | No | No | No |

Referrer accounts are verified only by the global administrator. A matching
name and number in the public HPCSA register marks the account "HPCSA register
match" in the verification queue but does not verify it on its own. A
verified referrer who changes their name or HPCSA number goes back into that
queue until the administrator confirms the new identity, and referrals take
the referring doctor's name, cellphone and email from the account rather than
the submitted form.

Global admin has an explicit **Refer** navigation item and **Open referral form**
and **Open referral workspace** links in Admin. The form uses the same validation,
consent and receipt workflow as a verified referrer. The administrator stays
signed in under their own role, and the API records the actual submitting user.
Admin access does not require a fabricated referrer verification status.

Unit administration lists only clinicians that the current unit admin can
manage. Role changes, unit transfers, administrator creation, other-unit staff
changes and edits to any existing administrator are rejected by the server.
An unassigned unit admin receives no manager access. The shared case permission
also explicitly excludes referrers even if they have a non-null unit field.

The global-admin exception applies to referral creation and the referrer
workspace's list, detail, images, follow-up and roster routes. Ordinary team
accounts cannot use those routes to escape unit restrictions. First-login
password changes are still enforced for staff/admin accounts, including when
they visit referrer routes. Refreshing the installed app returns to neutral Home
instead of sending every role to Admin.

## Verification

`tests/role-boundaries.test.ts` runs real Express authorization handlers with
synthetic principals and a database fixture. It checks denied role escalation,
cross-unit staff/case/roster access, protected administrator targets, own-unit
positive operations, admin referral creation and attribution, all/own consult
scoping, and the temporary-password gate. Existing ownership/session/schema
tests remain required.

`tests/navigation-smoke.mjs` checks hidden regular-staff administration links,
the direct-URL guard, admin form/all-consults navigation, and unit-admin views
without foreign staff/global tabs/role-grant controls. Browser fixtures write no
Supabase records. Production verification uses a short-lived admin test session
to open the form and workspace without submitting or editing clinical records;
the test session is deleted afterward.

## Atomic referrer identity edits

An identity edit clears verification in the same database update as the changed
name or HPCSA number. The write compares the authenticated name, number and
verification state; a concurrent edit or approval returns 409 and asks the
referrer to reload. A late register lookup can flag only the identity it checked.
Changing a pending identity also clears an old register-match flag. Public
register matches still require an administrator to approve the account.
