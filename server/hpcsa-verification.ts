const ELIGIBLE_STATUSES = new Set([
  "ACTIVE",
  "INDEPENDENT PRACTICE",
  "SUPERVISED PRACTICE",
  "EMPLOYED",
]);

function nameTokens(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(/\s+/).filter(Boolean).sort();
}

export function hpcsaIdentityMatches(
  submittedName: string,
  submittedNumber: string,
  record: { full_name: string; hpcsa_number: string; status: string },
): boolean {
  const number = (value: string) => value.replace(/\s+/g, "").toUpperCase();
  if (!number(submittedNumber) || number(submittedNumber) !== number(record.hpcsa_number)) return false;
  if (!ELIGIBLE_STATUSES.has(String(record.status || "").trim().toUpperCase())) return false;
  const submitted = nameTokens(submittedName);
  const registered = nameTokens(record.full_name || "");
  return submitted.length >= 2 && submitted.length === registered.length &&
    submitted.every((token, index) => token === registered[index]);
}
