import webpush from "web-push";
import { db, type PushSub } from "./db";

export type PushPayload = { title: string; body: string; tag: string; url: string; urgent?: boolean };

// The server posts to whatever endpoint a signed-in user registers, so only the
// push services browsers actually use are accepted.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function allowedPushEndpoint(endpoint: string) {
  try { const u = new URL(endpoint); return u.protocol === "https:" && !u.port && PUSH_HOSTS.some(h => h.test(u.hostname)); }
  catch { return false; }
}

let ready = false, publicKey: string | null = null;
export function configurePush(env: NodeJS.ProcessEnv = process.env) {
  ready = false; publicKey = null;
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = env;
  if (!pub || !priv || !subject) return false;
  try { webpush.setVapidDetails(subject, pub, priv); ready = true; publicKey = pub; }
  catch (e: any) { console.error("push disabled: invalid VAPID configuration:", e?.message); }
  return ready;
}
export const pushEnabled = () => ready;
export const pushPublicKey = () => (ready ? publicKey : null);

export async function deliver(subs: PushSub[], payload: PushPayload): Promise<number> {
  if (!ready || !subs.length) return 0;
  const body = JSON.stringify(payload);
  const results = await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body,
        { TTL: 3600, urgency: payload.urgent ? "high" : "normal", timeout: 10_000 });
      return 1;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.removePushSub(s.endpoint).catch(() => {});
      else console.error("push delivery failed", e?.statusCode || e?.message);
      return 0;
    }
  }));
  return results.reduce<number>((a, b) => a + b, 0);
}
