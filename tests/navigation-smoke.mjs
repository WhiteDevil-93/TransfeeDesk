// Run against tests/navigation-fixture.ts after building. Playwright may be
// supplied through PLAYWRIGHT_MODULE without changing project dependencies.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const base = process.env.TEST_BASE || "http://127.0.0.1:5188";
const publicOnly = process.argv.includes("--public-only");
const output = path.resolve("artifacts/navigation-audit"); await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const page = await context.newPage(); const errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
const go = async route => { await page.goto(`${base}/#${route}`); };
const visible = async locator => { await locator.waitFor({ state: "visible" }); };
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const capture = async name => {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: horizontal overflow`);
  await page.screenshot({ path: path.join(output, `${publicOnly ? "live-" : ""}${name}.png`), fullPage: true });
};
const login = async (route, account) => {
  await go(route);
  const portal = route.startsWith("/portal") || route.startsWith("/refer");
  await page.getByTestId(portal ? "input-portal-username" : "input-username").fill(account);
  await page.getByTestId(portal ? "input-portal-password" : "input-password").fill("navigation-test-password");
  await page.getByTestId(portal ? "button-portal-login" : "button-login").click();
};
try {
  if (!process.argv.includes("--public-only")) assert((await page.request.post(`${base}/api/fixture/reset`)).ok());
  await go("/portal"); await visible(page.getByRole("heading", { name: "Referring clinician portal" }));
  await capture("02-referrer-entry");
  await page.getByRole("link", { name: "Go to staff sign-in", exact: true }).click();
  await visible(page.getByRole("heading", { name: "Receiving staff sign-in" })); await capture("03-staff-entry");
  await page.getByRole("link", { name: "BaraBridge home" }).click();
  await visible(page.getByRole("heading", { name: "Welcome to BaraBridge" })); await capture("04-home");
  for (const [route, heading] of [["/followup", "Follow up a referral"], ["/status", "Referral status"], ["/privacy", "Privacy notice"], ["/missing", "Page not found"]]) {
    await go(route); await visible(page.getByRole("heading", { name: heading, exact: true }));
    await visible(page.getByRole("link", { name: "Staff sign-in", exact: true }));
    await visible(page.getByRole("link", { name: "Referrer portal", exact: true }));
    await page.getByRole("link", { name: "BaraBridge home" }).click(); await visible(page.getByRole("heading", { name: "Welcome to BaraBridge" }));
  }
  check("Public entry, follow-up, status, privacy and unknown pages have recovery navigation");
  if (!process.argv.includes("--public-only")) {
    await login("/portal", "staff"); await visible(page.getByRole("heading", { name: "MEU referral desk" }));
    assert(page.url().endsWith("#/queue")); await capture("05-staff-from-referrer-login");
    await page.reload(); await visible(page.getByRole("heading", { name: "MEU referral desk" }));
    await page.getByTestId("link-On call").click(); await visible(page.getByRole("heading", { name: "On call", exact: true }));
    await page.getByTestId("link-Queue").click(); await visible(page.getByRole("heading", { name: "MEU referral desk" }));
    await go("/admin"); await visible(page.getByText("This page is for administrators.", { exact: true }));
    await page.getByRole("link", { name: "Back to referral queue" }).click();
    await go("/portal"); await visible(page.getByRole("heading", { name: "You're signed in as receiving staff" }));
    await page.getByRole("link", { name: "Continue to referral desk" }).click(); await visible(page.getByRole("heading", { name: "MEU referral desk" }));
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    check("Staff can sign in from referrer entry, reload, use labelled tabs and recover from wrong-role pages");

    await login("/login", "referrer"); await visible(page.getByText("Verified", { exact: true })); assert(page.url().endsWith("#/portal"));
    await capture("06-referrer-workspace");
    await go("/login"); await visible(page.getByRole("heading", { name: "You're signed in as a referrer" }));
    await page.getByRole("link", { name: "Continue to my consults" }).click();
    await page.getByRole("button", { name: "New consult", exact: true }).click();
    await page.getByRole("button", { name: "Back to my consults", exact: true }).click();
    await page.getByRole("button", { name: "New consult", exact: true }).click();
    await page.getByLabel("Hospital / facility *", { exact: true }).fill("QA test facility");
    await page.getByTestId("select-team").click(); await page.getByRole("option", { name: /MEU/ }).click();
    const combos = page.getByRole("combobox");
    await combos.nth(1).click(); await page.getByRole("option", { name: "Advice only / no transfer", exact: true }).click();
    await combos.nth(2).click(); await page.getByRole("option", { name: "Other / not listed", exact: true }).click();
    for (const [label, value] of [["Initials *", "Q.T."], ["Age *", "30"], ["Working diagnosis *", "QA synthetic consult"], ["History *", "Synthetic history"], ["Examination (incl. vitals) *", "Synthetic examination"], ["Investigations *", "Synthetic investigations"], ["Reason for referral / request *", "Synthetic advice request"]]) await page.getByLabel(label, { exact: true }).fill(value);
    await combos.nth(5).click(); await page.getByRole("option", { name: "Male", exact: true }).click();
    await page.getByRole("button", { name: /P3 Routine/ }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Submit consult", exact: true }).click();
    await visible(page.getByRole("heading", { name: "Consult sent to MEU" })); await visible(page.getByText("qa-private-code", { exact: true })); await capture("07-referral-receipt");
    await page.getByRole("button", { name: "Back to dashboard" }).click();
    await page.getByText("QA synthetic consult", { exact: true }).click();
    await visible(page.getByRole("dialog", { name: "Referral details" }));
    await page.getByLabel("Send an update or follow-up question").fill("QA synthetic clinical update");
    await Promise.all([page.waitForResponse(response => response.url().endsWith("/followup") && response.request().method() === "POST" && response.status() === 200), page.getByRole("button", { name: "Send update to the team" }).click()]);
    await visible(page.getByRole("region", { name: "Updates and response history" }).getByText("QA synthetic clinical update", { exact: true }));
    assert.equal(await page.getByLabel("Send an update or follow-up question").inputValue(), ""); await capture("08-own-case-followup");
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.reload(); await visible(page.getByText("QA synthetic consult", { exact: true }));
    check("Verified referrer can enter from staff login, submit, receive a private code, read own case, send follow-up and reload");

    await page.request.post(`${base}/api/fixture/expire`); await page.reload();
    await visible(page.getByRole("heading", { name: "Referring clinician portal" }));
    await visible(page.getByText("Your session ended. Sign in again to continue.", { exact: true }));
    check("Referrer session expiry returns to usable sign-in with public navigation");
    await login("/portal", "pending"); await visible(page.getByText("Verification pending", { exact: true }));
    await page.getByRole("button", { name: "New consult", exact: true }).click();
    await visible(page.getByText(/Your account must be verified before you can send a referral\. Upload/));
    assert.equal(await page.getByRole("button", { name: "Submit consult", exact: true }).count(), 0);
    await capture("09-pending-verification"); await page.getByRole("button", { name: "Sign out", exact: true }).click();
    check("Pending account can navigate and sign out but cannot submit");

    await login("/login", "admin"); await visible(page.getByRole("heading", { name: "All-unit referral desk" }));
    await page.getByText("QA synthetic consult", { exact: true }).click(); await visible(page.getByTestId("input-advice"));
    await page.getByTestId("input-advice").fill("QA synthetic receiving-team advice");
    await Promise.all([page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/api/referrals/") && response.status() === 200), page.getByTestId("button-send-advice").click()]);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByTestId("link-Admin").click(); await visible(page.getByRole("heading", { name: "Admin", exact: true }));
    await page.getByTestId("link-Queue").click(); await visible(page.getByRole("heading", { name: "All-unit referral desk" }));
    await page.setViewportSize({ width: 1280, height: 900 }); await capture("10-desktop-staff-navigation");
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await login("/login", "temporary"); await visible(page.getByRole("heading", { name: "Set your own password" }));
    await visible(page.getByRole("link", { name: "Home", exact: true }).first());
    await page.getByTestId("input-current").fill("navigation-test-password"); await page.getByTestId("input-new").fill("navigation-test-password-updated"); await page.getByTestId("input-new2").fill("navigation-test-password-updated"); await page.getByTestId("button-setpw").click(); await visible(page.getByRole("heading", { name: "TEU referral desk" })); await page.getByRole("button", { name: "Log out", exact: true }).click();
    check("Admin can return to queue and first-login password change reaches the staff desk");

    await login("/refer/SEU", "referrer"); await visible(page.getByRole("button", { name: "Back to my consults" }));
    assert((await page.getByTestId("select-team").innerText()).includes("SEU"));
    await page.getByRole("button", { name: "My consults", exact: true }).click(); await page.getByText("QA synthetic consult", { exact: true }).click();
    await visible(page.getByRole("region", { name: "Updates and response history" }).getByText("QA synthetic receiving-team advice", { exact: true })); await capture("11-receiving-team-response");
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    check("Receiving-team advice reaches the original referrer's case and response history");
    await page.route("**/api/me", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fixture offline" }) }));
    await page.reload(); await visible(page.getByRole("heading", { name: "Couldn't restore your session" }));
    await visible(page.getByRole("link", { name: "Home", exact: true }).first()); await page.unroute("**/api/me"); await page.getByRole("button", { name: "Try again", exact: true }).click(); await visible(page.getByText("Verified", { exact: true }));
    check("Legacy team links retain unit preset and failed session restoration has a working retry");
    let releaseRestore;
    await page.route("**/api/me", route => new Promise(resolve => { releaseRestore = async () => { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: 3, role: "referrer", name: "QA Referrer", verifyStatus: "verified" } }) }); resolve(); }; }));
    await page.reload(); await visible(page.getByText("Restoring your session...", { exact: true }));
    await page.getByRole("button", { name: "Sign in instead", exact: true }).click(); await visible(page.getByRole("heading", { name: "Receiving staff sign-in" })); await releaseRestore(); await page.unroute("**/api/me"); await visible(page.getByTestId("input-username"));
    check("Session loading can be cancelled without a late response restoring the old account");
  }
  assert.deepEqual(errors, []); check("No browser runtime errors");
  await fs.writeFile(path.join(output, publicOnly ? "live-checks.json" : "checks.json"), JSON.stringify({ base, checks, errors }, null, 2));
} finally { await browser.close(); }
