# BaraBridge unit workflow

The app has three separate receiving units: MEU (Medical Emergency Unit), TEU (Trauma Emergency Unit), and SEU (Surgical Emergency Unit). Unit boundaries are checked by the server for lists, individual cases, updates, images, doctor contacts, user management and duty rosters.

## Accounts and permissions

| Role | Referral access | User management | Roster changes |
|---|---|---|---|
| Global administrator | All units and unassigned legacy cases; can reroute cases | Assign units, appoint unit consultants, deactivate members, reset passwords | All units |
| Unit admin / consultant | Own unit only | Create, deactivate/reactivate and reset passwords for clinicians in own unit; cannot promote admins or change unit assignments | Own unit |
| Team member | Own unit only; send referral links, review cases, accept/wait/decline and record advice | None | Read own unit roster |

Existing referrals and existing non-global accounts remain unassigned rather than being classified automatically. The global administrator assigns them. No existing password is changed by this upgrade.

## Referral and advice

A unit-specific referral link selects the receiving unit. The referring doctor chooses transfer request or advice only, completes the clinical sections and can add up to three clinical images. The receipt contains a reference and a separate private follow-up code. Save both.

The receiving team opens the referral, reviews images and the clinical timeline, then accepts, declines, waits, or types clinical advice. “Save and send advice” records an advice response in the private portal; it does not accept a transfer. Every response records its author and time, and earlier responses remain in the timeline. WhatsApp buttons open a draft; they do not automatically send it or prove delivery.

## Follow-ups

The referring doctor opens “Follow up referral” and enters the reference plus private code. This shows first-opening time, response author, advice, decision history and images. A new update can include new examination findings, investigation results, deterioration, a follow-up question and up to three further images.

The receiving team can ask the referrer for more information from the History & chat tab; the referral then shows as waiting for the referrer, who is notified (and reminded) and replies from the same page. Questions and replies stay on the referral timeline. Updates do not overwrite the original history. New updates are flagged on the receiving unit’s queue, including follow-ups to already accepted/declined/advised cases. While a case is open its timeline refreshes; unopened updates trigger a browser notification and sound on a signed-in desk.

Lost-code recovery is restricted to consultants and the global administrator. They must verify the referring doctor’s identity before generating and privately delivering a replacement code. The old code immediately stops working.

## Opened notifications

The first authorized case opening records who opened it and when. The private portal refreshes every 20 seconds. If notifications are allowed and the portal remains open, it can show a browser notification when an unopened referral is opened or a response arrives. There is also a one-tap WhatsApp “referral opened” draft for the receiving clinician.

No automatic WhatsApp/SMS delivery, closed-browser push service, or delivery receipts are configured. An opening does not imply acceptance for transfer. Emergency escalation must not depend on browser notifications.

## Images and retention

Images are resized to a maximum dimension of 2400 pixels and re-encoded as JPEG in the browser to remove embedded metadata. They are additionally encrypted with AES-256-GCM before storage in the persistent database. Only authorized unit members, the global administrator and the holder of the private referral code can retrieve them. Limits: three images per submission, under 12 MB source each, under 2 MB stored each. JPEG, PNG and WebP are supported; HEIC, PDF and DICOM are not.

Crop names, ID numbers and faces before sending. These image copies are supplementary and not replacements for original diagnostic studies. The existing retention purge now removes clinical timelines and images as well as the original clinical details; the private code expires with the record. Backups may retain older copies according to the provider’s approved backup policy.

The image-encryption key is derived from the existing server database secret. Preserve that secret in a secure backup; do not rotate it without a controlled image-key migration.

## Verification

The repository includes permission unit tests and an API integration suite. The suite uses synthetic accounts and referrals and checks all three unit boundaries, cross-unit case/image access, role escalation, user deactivation, unit rosters, advice attribution, private portal credentials, follow-up images and global rerouting. Production use still requires hospital governance, approved operator agreements, a retention policy and tested independent backups.
