# Emergency-unit referral form

New referrals select MEU, TEU or SEU as the receiving destination. The hospital
specialty selector and requested bed-type field have been removed. Transfer
versus advice and the patient's current location remain. The API defaults absent
legacy specialty/bed-needed values to empty strings; existing referrals retain
their original values. Empty legacy fields are omitted from case details.

Facility location is mandatory. Referrers find the named facility, select its
point on the map, enter coordinates, or explicitly share GPS while at the
facility. They inspect the drainage map and confirm the pin before proceeding.
Changing the facility name clears its coordinates and confirmation. GPS denial
does not leave a dead end: search, map selection and manual coordinates remain
available. The server requires valid bounded latitude and longitude before
creating the referral; it no longer geocodes a best guess after submission.
Coordinates and their submitted-location source are stored together. Old cases
remain readable and staff can set their location explicitly.

The catchment window contains an interactive Leaflet map and only the centres
assigned to the containing drainage polygon in Medric's published
`https://catchments.medricsoftware.co.za/intersections.json` dataset. The first
containing polygon matches the provider's selection order; boundary points are
included. The complete external pre-notification site is no longer embedded.
Outside coverage returns no invented nearest-centre matches. A provider outage
or invalid response gives a retry state. The server validates and caches the
dataset for six hours; coordinates are matched locally and are not sent to the
drainage-data provider. OpenStreetMap supplies map tiles with attribution.
These associations do not indicate current bed availability or acceptance.
The authenticated catchment API adds no database migration or provider keys.

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

`tests/catchment.test.ts` covers mandatory coordinates, bounds, polygon axis
order and boundaries, assigned-centre isolation, outside coverage, anonymous
API rejection, provider outage and invalid data, and successful caching. Browser
coverage checks search, map contents, confirmation, facility-name invalidation,
Back/Next preservation and the complete synthetic referral journey.
