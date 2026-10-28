import { db } from "./db";
import { deliver, pushEnabled, type PushPayload } from "./push";
import type { Team } from "@shared/teams";

export const saToday = (now = Date.now()) => new Date(now + 2 * 3600e3).toISOString().slice(0, 10);

// Unattended work is re-announced at most this many times, so a case nobody can
// reach never produces an endless stream of notifications.
export const MAX_REPEATS = 3;
const MIN = 60_000;

export type NotifyCase = { id: number; ref: string; team: Team | null; priority?: string; referrerId?: number | null };

const log = (what: string) => (e: any) => { console.error(`push ${what} failed:`, e?.message || e); return 0; };

// Normally the unit accounts rostered for today. With nobody rostered, or once
// an alert has gone unattended, the whole unit.
export async function staffAudience(team: Team | null, wholeUnit: boolean, now = Date.now()): Promise<number[]> {
  if (!team) return [];
  const staff = (await db.users()).filter(u => u.active && u.team === team && (u.role === "clinician" || u.role === "unit_admin"));
  if (wholeUnit) return staff.map(u => u.id);
  const duty = new Set(await db.rosterUserIds(team, saToday(now)));
  const onDuty = staff.filter(u => duty.has(u.id));
  return (onDuty.length ? onDuty : staff).map(u => u.id);
}

const toStaff = async (c: NotifyCase, wholeUnit: boolean, payload: PushPayload) =>
  deliver(await db.pushSubsForUsers(await staffAudience(c.team, wholeUnit)), payload);

// A referrer is reached on their account's devices and on any device that
// subscribed through this referral's follow-up page.
async function toReferrer(c: NotifyCase, payload: PushPayload) {
  const [account, portal] = await Promise.all([c.referrerId ? db.pushSubsForUsers([c.referrerId]) : [], db.pushSubsForReferral(c.id)]);
  return (await deliver(account, { ...payload, url: "/#/portal" })) + (await deliver(portal, { ...payload, url: "/#/followup" }));
}

// Payloads carry the reference and unit only, never patient details: a lock screen is not a clinical record.
const staffUrl = "/#/queue";

export const notifyNewReferral = (c: NotifyCase) => !pushEnabled() ? Promise.resolve(0) :
  toStaff(c, false, { title: `${c.priority || "New"} referral · ${c.team}`, body: `New referral ${c.ref} needs review`, tag: `new-${c.id}`, url: staffUrl, urgent: c.priority === "P1" }).catch(log("new referral"));

export const notifyFollowup = (c: NotifyCase) => !pushEnabled() ? Promise.resolve(0) :
  toStaff(c, false, { title: `Follow-up · ${c.team}`, body: `The referrer sent new information on ${c.ref}`, tag: `followup-${c.id}`, url: staffUrl }).catch(log("follow-up"));

export const notifyQuestion = (c: NotifyCase) => !pushEnabled() ? Promise.resolve(0) :
  toReferrer(c, { title: `Question about ${c.ref}`, body: `The ${c.team} team needs more information. Open the referral to reply.`, tag: `question-${c.id}`, url: "/#/portal", urgent: true }).catch(log("question"));

export const notifyResponse = (c: NotifyCase) => !pushEnabled() ? Promise.resolve(0) :
  toReferrer(c, { title: `Response for ${c.ref}`, body: `The ${c.team} team has responded. Open the referral to read it.`, tag: `response-${c.id}`, url: "/#/portal" }).catch(log("response"));

const stage = (since: number, step: number, now: number) => Math.min(MAX_REPEATS, Math.floor((now - since) / step));

// Runs every minute. Each alert is claimed in push_sent before it is sent, so
// ticks that overlap or a second server cannot send it twice.
export async function pushTick(nowMs = Date.now()) {
  if (!pushEnabled()) return 0;
  const settings = await db.settings();
  const escalate = Math.max(1, Number(settings.escalate) || 10) * MIN, repeat = Math.max(1, Number(settings.repeat) || 5) * MIN;
  const iso = (ms: number) => new Date(ms).toISOString();
  const due = await db.pushDue(iso(nowMs - escalate * (MAX_REPEATS + 1) - 5 * MIN), iso(nowMs - repeat * (MAX_REPEATS + 1) - 5 * MIN), iso(nowMs));
  let sent = 0;
  const once = async (key: string, send: () => Promise<number>) => {
    try { if (await db.claimPush(key)) sent += await send(); } catch (e: any) { log(key)(e); }
  };
  for (const r of due.unattended) {
    const since = new Date(r.createdAt).getTime(), n = stage(since, escalate, nowMs);
    if (n >= 1) await once(`unattended:${r.id}:${n}`, () => toStaff(r, true, { title: `Unattended ${r.priority} referral · ${r.team}`,
      body: `${r.ref} has waited ${Math.round((nowMs - since) / MIN)} minutes with nobody opening it`, tag: `unattended-${r.id}`, url: staffUrl, urgent: r.priority === "P1" }));
  }
  for (const r of due.followups) {
    const since = new Date(r.latestFollowupAt).getTime(), n = stage(since, escalate, nowMs);
    if (n >= 1) await once(`followup:${r.id}:${r.latestFollowupAt}:${n}`, () => toStaff(r, true, { title: `Unread follow-up · ${r.team}`,
      body: `New information on ${r.ref} has not been read for ${Math.round((nowMs - since) / MIN)} minutes`, tag: `followup-${r.id}`, url: staffUrl }));
  }
  for (const r of due.questions) {
    const since = new Date(r.awaitingInfoAt).getTime(), n = stage(since, escalate, nowMs);
    if (n >= 1) await once(`question:${r.id}:${r.awaitingInfoAt}:${n}`, () => toReferrer(r, { title: `Reminder: question about ${r.ref}`,
      body: `The ${r.team} team is still waiting for your reply`, tag: `question-${r.id}`, url: "/#/portal", urgent: true }));
  }
  for (const r of due.waiting) {
    const n = stage(new Date(r.remindAt).getTime(), repeat, nowMs);
    await once(`waiting:${r.id}:${r.remindAt}:${n}`, () => toStaff(r, n >= 1, { title: `Waiting referral · ${r.team}`,
      body: `${r.ref} is on hold and due for review`, tag: `waiting-${r.id}`, url: staffUrl }));
  }
  await db.prunePushSent(7).catch(() => {});
  return sent;
}

let timer: ReturnType<typeof setInterval> | undefined, busy = false;
export function startPushScheduler(everyMs = 60_000) {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy) return; busy = true;
    try { await pushTick(); } catch (e: any) { console.error("push scheduler failed:", e?.message || e); } finally { busy = false; }
  }, everyMs);
  timer.unref();
}
