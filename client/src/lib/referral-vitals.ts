export const VITAL_FIELDS = [
  { key: "systolic", label: "Systolic BP", unit: "mmHg" },
  { key: "diastolic", label: "Diastolic BP", unit: "mmHg" },
  { key: "pulse", label: "Heart rate", unit: "bpm" },
  { key: "respiratory", label: "Respiratory rate", unit: "/min" },
  { key: "spo2", label: "SpO₂", unit: "%" },
  { key: "temperature", label: "Temperature", unit: "°C" },
  { key: "gcs", label: "GCS total", unit: "" },
  { key: "glucose", label: "Glucose", unit: "mmol/L" },
] as const;
export type VitalSigns = Partial<Record<typeof VITAL_FIELDS[number]["key"], string>>;

// Keep observations in the existing examination record so all receiving-team,
// portal, export and retention paths preserve them without a schema migration.
export function examinationWithVitals(findings: string, values: VitalSigns): string {
  const lines = VITAL_FIELDS.flatMap(({ key, label, unit }) => {
    const value = values[key]?.trim();
    return value ? [`${label}: ${value}${unit ? ` ${unit}` : ""}`] : [];
  });
  return lines.length ? `Vital signs\n${lines.join("\n")}\n\nExamination findings\n${findings}` : findings;
}
