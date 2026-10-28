import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";
import webpush from "web-push";

process.env.APP_DB_SECRET = "chat-push-secret-longer-than-thirty-two-characters";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "chat-push-key";
const vapid = webpush.generateVAPIDKeys();
const VAPID = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:ops@example.invalid" };
const FCM = "https://fcm.googleapis.com/fcm/send/";
const sub = (endpoint: string) => ({ endpoint: FCM + endpoint, p256dh: "p".repeat(20), auth: "a".repeat(20) });
const waitFor = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 10)); };

const staff = [
  { id: 2, role: "clinician", team: "MEU", name: "Dr On Duty" }, { id: 3, role: "unit_admin", team: "MEU", name: "Consultant Off Duty" },
  { id: 4, role: "clinician", team: "TEU", name: "Other Unit" }, { id: 5, role: "clinician", team: "MEU", name: "Gone", active: false },
  { id: 6, role: "referrer", team: null, name: "Dr Referrer", verifyStatus: "verified" }, { id: 7, role: "referrer", team: null, name: "Dr Stranger", verifyStatus: "verified" },
  { id: 1, role: "admin", team: null, name: "Admin" },
].map(u => ({ active: true, username: `qa${u.id}`, ...u }));
const subsByUser: Record<number, any[]> = { 2: [sub("duty")], 3: [sub("consultant")], 4: [sub("teu")], 5: [sub("gone")], 6: [sub("referrer")], 7: [sub("stranger")] };

async function setup(t: any) {
  const { db } = await import("../server/db");
  const push = await import("../server/push");
  const { registerRoutes } = await import("../server/routes");
  assert.equal(push.configurePush(VAPID), true);
  const sent: { endpoint: string; payload: any; urgency?: string }[] = [];
  t.mock.method(webpush, "sendNotification", async (s: any, body: string, opts: any) => { sent.push({ endpoint: s.endpoint, payload: JSON.parse(body), urgency: opts?.urgency }); return {} as any; });
  const state: any = { referral: { id: 11, ref: "TX-CHAT", team: "MEU", priority: "P2", status: "pending", referrerId: 6, awaitingInfoAt: null, ackAt: null, purgedAt: null, diagnosis: "SECRET DIAGNOSIS", patientInitials: "Z.Z." }, roster: [2] as number[], claimed: new Set<string>() };
  const appended: any[] = [], updates: any[] = [], audits: any[] = [], saved: any[] = [];
  t.mock.method(db, "sessionUser", async (token: string) => staff.find(u => String(u.id) === token) || null);
  t.mock.method(db, "users", async () => staff as any);
  t.mock.method(db, "get", async (id: number) => id === 11 ? state.referral : undefined);
  t.mock.method(db, "append", async (...args: any[]) => { appended.push(args); });
  t.mock.method(db, "update", async (_id: number, patch: any) => { updates.push(patch); return state.referral; });
  t.mock.method(db, "audit", async (row: any) => { audits.push(row); });
  t.mock.method(db, "markOpened", async () => {});
  t.mock.method(db, "timeline", async () => []);
  t.mock.method(db, "images", async () => []);
  t.mock.method(db, "rosterUserIds", async () => state.roster);
  t.mock.method(db, "pushSubsForUsers", async (ids: number[]) => ids.flatMap(id => subsByUser[id] || []));
  t.mock.method(db, "pushSubsForReferral", async (id: number) => id === 11 ? [sub("portal")] : []);
  t.mock.method(db, "pushDeviceCounts", async () => ({ 2: 1 }));
  t.mock.method(db, "savePushSub", async (s: any, owner: any) => { saved.push({ s, owner }); });
  t.mock.method(db, "removePushSub", async () => {});
  t.mock.method(db, "claimPush", async (key: string) => { if (state.claimed.has(key)) return false; state.claimed.add(key); return true; });
  t.mock.method(db, "prunePushSent", async () => {});
  t.mock.method(db, "settings", async () => ({ escalate: 10, repeat: 5, retentionDays: 90 }) as any);
  const app = express(); app.use(express.json());
  const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (id: number | null, path: string, method = "GET", body?: any) => fetch(base + path, { method, headers: { ...(id ? { authorization: `Bearer ${id}` } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { db, push, state, sent, appended, updates, audits, saved, call, close: () => new Promise(resolve => server.close(resolve)) };
}

test("a clinician's question is stored on the referral, acknowledges it and notifies only the referrer", async t => {
  const k = await setup(t);
  try {
    assert.equal((await k.call(null, "/api/referrals/11/question", "POST", { body: "Latest vitals?" })).status, 401);
    assert.equal((await k.call(4, "/api/referrals/11/question", "POST", { body: "Latest vitals?" })).status, 404, "another unit cannot ask");
    assert.equal((await k.call(6, "/api/referrals/11/question", "POST", { body: "Latest vitals?" })).status, 404, "a referrer cannot post as the team");
    assert.equal((await k.call(2, "/api/referrals/11/question", "POST", { body: " " })).status, 400);
    assert.equal((await k.call(2, "/api/referrals/11/question", "POST", { body: "x".repeat(2001) })).status, 400);
    k.state.referral.purgedAt = "2026-01-01"; assert.equal((await k.call(2, "/api/referrals/11/question", "POST", { body: "Latest vitals?" })).status, 410); k.state.referral.purgedAt = null;
    assert.deepEqual(k.appended, []);
    assert.equal((await k.call(2, "/api/referrals/11/question", "POST", { body: "  Latest vitals and ECG?  " })).status, 200);
    assert.deepEqual(k.appended, [[11, "Dr On Duty", 2, "question", "Latest vitals and ECG?"]]);
    assert.deepEqual(k.updates, [{ ack: "Dr On Duty" }]);
    assert.ok(k.audits.some(a => a.action === "referral_question" && a.referralId === 11));
    await waitFor(() => k.sent.length >= 2);
    assert.deepEqual(k.sent.map(s => s.endpoint).sort(), [FCM + "portal", FCM + "referrer"], "the referrer's account and their follow-up page, nobody else");
    const account = k.sent.find(s => s.endpoint.endsWith("referrer"))!, portal = k.sent.find(s => s.endpoint.endsWith("portal"))!;
    assert.equal(account.payload.url, "/#/portal"); assert.equal(portal.payload.url, "/#/followup");
    assert.equal(account.urgency, "high");
    const text = JSON.stringify(k.sent.map(s => s.payload));
    assert.match(text, /TX-CHAT/); assert.doesNotMatch(text, /SECRET DIAGNOSIS|Z\.Z\./, "a lock screen never shows patient details");
  } finally { await k.close(); }
});

test("a referrer's message answers an open question as a reply and alerts the rostered accounts", async t => {
  const k = await setup(t);
  try {
    assert.equal((await k.call(7, "/api/referrer/referrals/11/followup", "POST", { body: "Not mine" })).status, 404);
    assert.equal((await k.call(6, "/api/referrer/referrals/11/followup", "POST", { body: "BP 90/60, ECG attached" })).status, 200);
    assert.equal(k.appended[0][3], "update", "no question was open");
    k.state.referral.awaitingInfoAt = "2026-10-28T08:00:00Z";
    assert.equal((await k.call(6, "/api/referrer/referrals/11/followup", "POST", { body: "Troponin 12" })).status, 200);
    assert.equal(k.appended[1][3], "reply");
    assert.ok(k.audits.some(a => a.action === "referral_followup" && /replied/.test(a.detail)));
    await waitFor(() => k.sent.length >= 2);
    assert.deepEqual([...new Set(k.sent.map(s => s.endpoint))], [FCM + "duty"], "only today's rostered account, not the rest of the unit");
    assert.match(k.sent[0].payload.title, /Follow-up · MEU/);
  } finally { await k.close(); }
});

test("with nobody rostered the whole active unit is alerted; other units, inactive and referrer accounts never are", async t => {
  const k = await setup(t);
  const { staffAudience } = await import("../server/notify");
  try {
    k.state.roster = [];
    assert.deepEqual((await staffAudience("MEU", false)).sort(), [2, 3]);
    k.state.roster = [3, 4, 5];
    assert.deepEqual(await staffAudience("MEU", false), [3], "roster entries outside the unit or inactive are ignored");
    assert.deepEqual((await staffAudience("MEU", true)).sort(), [2, 3], "escalation reaches the whole unit");
    assert.deepEqual(await staffAudience(null, true), []);
  } finally { await k.close(); }
});

test("an unattended referral is escalated to the whole unit after the delay, once per step, and stops after the cap", async t => {
  const k = await setup(t);
  const { pushTick, MAX_REPEATS } = await import("../server/notify");
  const T0 = Date.parse("2026-10-28T08:00:00Z"), min = (n: number) => T0 + n * 60_000;
  const referral = { id: 11, ref: "TX-CHAT", team: "MEU", priority: "P1", createdAt: new Date(T0).toISOString(), referrerId: 6 };
  let due: any = { unattended: [referral], followups: [], questions: [], waiting: [] };
  t.mock.method(k.db, "pushDue", async () => due);
  try {
    assert.equal(await pushTick(min(9)), 0, "nothing before the 10 minute delay");
    assert.equal(await pushTick(min(11)), 2, "the whole unit, not only the rostered account");
    assert.deepEqual(k.sent.map(s => s.endpoint).sort(), [FCM + "consultant", FCM + "duty"]);
    assert.match(k.sent[0].payload.title, /Unattended P1/); assert.equal(k.sent[0].urgency, "high");
    assert.equal(await pushTick(min(12)), 0, "the same alert is not sent twice");
    assert.equal(await pushTick(min(21)), 2, "a second reminder after another 10 minutes");
    for (const m of [31, 45, 90, 300]) await pushTick(min(m));
    assert.equal(k.sent.length, 2 * MAX_REPEATS, "reminders stop after the cap");
  } finally { await k.close(); }
});

test("unread follow-ups, waiting referrals and unanswered questions each push to the right people", async t => {
  const k = await setup(t);
  const { pushTick } = await import("../server/notify");
  const T0 = Date.parse("2026-10-28T08:00:00Z"), min = (n: number) => T0 + n * 60_000, iso = (n: number) => new Date(min(n)).toISOString();
  const base = { id: 11, ref: "TX-CHAT", team: "MEU", priority: "P2", referrerId: 6 };
  t.mock.method(k.db, "pushDue", async () => ({ unattended: [], followups: [{ ...base, latestFollowupAt: iso(0) }], questions: [{ ...base, awaitingInfoAt: iso(0) }], waiting: [{ ...base, remindAt: iso(0) }] }));
  try {
    assert.equal(await pushTick(min(1)), 1, "only the waiting-list alert is due straight away");
    assert.deepEqual(k.sent.map(s => s.endpoint), [FCM + "duty"], "a waiting referral first reaches the rostered account");
    assert.match(k.sent[0].payload.title, /Waiting referral/);
    k.sent.length = 0;
    await pushTick(min(11));
    const to = (suffix: string) => k.sent.filter(s => s.endpoint.endsWith(suffix)).map(s => s.payload.title);
    assert.deepEqual(to("duty").sort(), ["Unread follow-up · MEU", "Waiting referral · MEU"].sort());
    assert.deepEqual(to("referrer"), ["Reminder: question about TX-CHAT"], "the referrer is reminded about an unanswered question");
    assert.deepEqual(to("portal"), ["Reminder: question about TX-CHAT"]);
    assert.deepEqual(to("stranger"), [], "nobody else hears about it");
    assert.deepEqual(to("teu"), []);
  } finally { await k.close(); }
});

test("push subscriptions only accept real push services, need configuration, and belong to the signed-in account", async t => {
  const k = await setup(t);
  const body = (endpoint: string) => ({ subscription: { endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } } });
  try {
    for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.example/x", "https://fcm.googleapis.com:8443/x", "javascript:alert(1)"])
      assert.equal((await k.call(2, "/api/push/subscribe", "POST", body(bad))).status, 400, bad);
    assert.equal((await k.call(null, "/api/push/subscribe", "POST", body(FCM + "x"))).status, 401);
    assert.equal((await k.call(2, "/api/push/subscribe", "POST", { subscription: { endpoint: FCM + "x", keys: { p256dh: "!", auth: "!" } } })).status, 400);
    assert.deepEqual(k.saved, []);
    assert.equal((await k.call(2, "/api/push/subscribe", "POST", body("https://updates.push.services.mozilla.com/wpush/v2/abc"))).status, 200);
    assert.deepEqual(k.saved.map(s => s.owner), [{ userId: 2 }]);
    assert.equal((await k.call(2, "/api/push/key")).status, 200);
    assert.deepEqual(await (await k.call(null, "/api/push/key")).json(), { enabled: true, publicKey: vapid.publicKey });
    k.push.configurePush({});
    assert.equal((await k.call(2, "/api/push/subscribe", "POST", body(FCM + "x"))).status, 503);
    assert.deepEqual(await (await k.call(null, "/api/push/key")).json(), { enabled: false, publicKey: null });
    assert.equal(k.saved.length, 1);
  } finally { await k.close(); }
});

test("the roster screen data tells managers which unit members can receive push", async t => {
  const k = await setup(t);
  try {
    const members = await (await k.call(2, "/api/unit-members?team=MEU")).json();
    assert.deepEqual(members.map((m: any) => [m.id, m.pushDevices]).sort(), [[2, 1], [3, 0]]);
    assert.equal((await k.call(2, "/api/unit-members?team=TEU")).status, 403);
  } finally { await k.close(); }
});
