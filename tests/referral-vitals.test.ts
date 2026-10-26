import assert from "node:assert/strict";
import { test } from "node:test";
import { examinationWithVitals, VITAL_FIELDS } from "../client/src/lib/referral-vitals";
import { referralInput } from "../shared/schema";

const base = { team: "MEU", consultType: "transfer", doctorName: "QA clinician", hospital: "QA facility", phone: "0700000000", patientInitials: "Q.T.", age: "30", sex: "M", diagnosis: "QA diagnosis", history: "Synthetic history", exam: "Synthetic examination", investigations: "Synthetic results", reason: "QA referral", suggestedPriority: "P3", consent: true, lat: "-26.1", lon: "27.9" };

test("emergency referrals need no specialty selection or requested bed type", () => {
  for (const team of ["MEU", "TEU", "SEU"]) {
    const result = referralInput.parse({ ...base, team });
    assert.equal(result.team, team); assert.equal(result.specialty, ""); assert.equal(result.bedNeeded, "");
  }
  assert.equal(referralInput.safeParse({ ...base, team: "Cardiology" }).success, false);
  const legacy = referralInput.parse({ ...base, specialty: "cardiology", bedNeeded: "ICU" });
  assert.equal(legacy.specialty, "cardiology"); assert.equal(legacy.bedNeeded, "ICU");
});

test("vital values and units are retained with findings without inventing missing observations", () => {
  assert.equal(examinationWithVitals("Unchanged existing examination", {}), "Unchanged existing examination");
  const exam = examinationWithVitals("Synthetic findings", { systolic: "120", diastolic: "80", pulse: " 90 ", respiratory: "20", spo2: "98", temperature: "37.2", gcs: "15", glucose: "0" });
  for (const observation of ["Systolic BP: 120 mmHg", "Diastolic BP: 80 mmHg", "Heart rate: 90 bpm", "Respiratory rate: 20 /min", "SpO₂: 98 %", "Temperature: 37.2 °C", "GCS total: 15", "Glucose: 0 mmol/L", "Examination findings\nSynthetic findings"]) assert(exam.includes(observation), observation);
  const missing = examinationWithVitals("Synthetic findings", { systolic: "120", glucose: " " });
  assert(!missing.includes("Diastolic")); assert(!missing.includes("Glucose"));
  const largest = examinationWithVitals("x".repeat(4500), Object.fromEntries(VITAL_FIELDS.map(({ key }) => [key, "1".repeat(12)])));
  assert(largest.length <= 5000); assert(referralInput.safeParse({ ...base, exam: largest }).success);
});
