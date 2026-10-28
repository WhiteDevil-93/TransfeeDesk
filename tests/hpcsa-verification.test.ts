import assert from "node:assert/strict";
import { test } from "node:test";
import { hpcsaIdentityMatches } from "../server/hpcsa-verification";

const record = { full_name: "Jane-Marie Smith", hpcsa_number: "MP0123456", status: "ACTIVE" };

test("matching HPCSA number, full name and eligible status can auto-verify", () => {
  assert.equal(hpcsaIdentityMatches("Smith, Jane Marie", "MP 0123456", record), true);
});

test("real iRegister records store given names and surname separately", () => {
  const imported = { surname: "VAN DER MERWE", full_name: "JANE MARIE", hpcsa_number: "MP0123456", status: "ACTIVE" };
  for (const name of ["Jane van der Merwe", "Dr. Jane Marie van der Merwe", "VAN DER MERWE, JANE"]) {
    assert.equal(hpcsaIdentityMatches(name, "mp 0123456", imported), true, name);
  }
  for (const name of ["Jane Smith", "John van der Merwe", "Jane Merwe", "van der Merwe", "J van der Merwe", "Jane Unknown van der Merwe"]) {
    assert.equal(hpcsaIdentityMatches(name, "MP0123456", imported), false, name);
  }
  assert.equal(hpcsaIdentityMatches("Jane Smith", "MP0123456", { ...record, surname: "SMITH" }), true, "a matching first name and surname need not include additional given names");
});

test("another person's HPCSA number cannot auto-verify", () => {
  assert.equal(hpcsaIdentityMatches("John Smith", "MP0123456", record), false);
  assert.equal(hpcsaIdentityMatches("Jane Smith", "MP0123456", record), false);
  assert.equal(hpcsaIdentityMatches("Jane-Marie Smith", "MP9999999", record), false);
});

test("inactive or ambiguous status cannot auto-verify", () => {
  for (const status of ["TERMINATED", "EXPIRED", "SUSPENDED", "NOT ACTIVE", ""]) {
    assert.equal(hpcsaIdentityMatches("Jane Marie Smith", "MP0123456", { ...record, status }), false);
  }
});
