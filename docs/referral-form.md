# Emergency-unit referral form

New referrals select MEU, TEU or SEU as the receiving destination. The hospital
specialty selector and requested bed-type field have been removed. Transfer
versus advice and the patient's current location remain. The API defaults absent
legacy specialty/bed-needed values to empty strings; existing referrals retain
their original values. Empty legacy fields are omitted from case details.

The clinical step has separate observation cards for systolic BP, diastolic BP,
heart rate, respiratory rate, oxygen saturation, temperature, GCS total and
glucose. Unit labels are explicit. Readings are optional and start blank;
unavailable readings are never replaced by normal values or zeros. Examination
findings remain a separate required narrative. Back/Next and review edits keep
the entered readings in component state; starting a fresh consult clears them.

On submission, the readings and their units are combined with findings in the
existing examination record. That record is already retained by the server,
shown to receiving teams/referrers and included in exports. This requires no
database migration and does not reinterpret old examinations. The findings
input is capped at 4,500 characters to leave room for observation labels within
the existing 5,000-character examination limit. The UI does not calculate a
severity score or infer clinical priority from these values.

`tests/referral-vitals.test.ts` checks missing-field defaults, legacy compatibility,
unit/value preservation, absent readings, literal zero preservation and the
storage length boundary. The browser journey enters all eight observations,
goes back and forward, reviews, submits, reads the saved API record and sees
the readings in both referrer and receiving-team case details. Production
checks inspect the form under a temporary admin session without submitting a
clinical record.
