const ELIGIBLE_STATUSES = new Set([
  "ACTIVE",
  "INDEPENDENT PRACTICE",
  "SUPERVISED PRACTICE",
  "EMPLOYED",
]);

// Register numbers are published with spaces ("MP 0123456") and typed in any
// case; every stored and looked-up number uses this form.
export const normalizeHpcsaNumber = (value: string) => value.replace(/\s+/g, "").toUpperCase();

function nameTokens(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(/\s+/).filter(Boolean).sort();
}

export function hpcsaIdentityMatches(
  submittedName: string,
  submittedNumber: string,
  record: { full_name: string; hpcsa_number: string; status: string },
): boolean {
  const number = normalizeHpcsaNumber(submittedNumber);
  if (!number || number !== normalizeHpcsaNumber(record.hpcsa_number)) return false;
  if (!ELIGIBLE_STATUSES.has(String(record.status || "").trim().toUpperCase())) return false;
  const submitted = nameTokens(submittedName);
  const registered = nameTokens(record.full_name || "");
  return submitted.length >= 2 && submitted.length === registered.length &&
    submitted.every((token, index) => token === registered[index]);
}
