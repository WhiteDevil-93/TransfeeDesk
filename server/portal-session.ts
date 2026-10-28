import crypto from "node:crypto";

/**
 * Short-lived, stateless access token for the follow-up portal. The private
 * follow-up code is exchanged for one once; polling, updates and image reads
 * then use the token, so the code is not re-sent every few seconds.
 *
 * The token is bound to the referral's current portal hash, so resetting the
 * follow-up code (or purging the record) ends every token issued before it.
 */
export const PORTAL_IDLE_MS = 30 * 60e3;
export const PORTAL_MAX_MS = 12 * 3600e3;

type Claims = { rid: number; fp: string; iat: number; exp: number };

const key = () => crypto.createHash("sha256").update("portal-session:" + (process.env.APP_DB_SECRET || "")).digest();
const mac = (text: string) => crypto.createHmac("sha256", key()).update(text).digest("base64url");

export const portalFingerprint = (portalHash: string) => mac("fp:" + portalHash).slice(0, 22);

export function issuePortalToken(rid: number, portalHash: string, opts: { now?: number; iat?: number } = {}) {
  const now = opts.now ?? Date.now(); const iat = opts.iat ?? now;
  const exp = Math.min(now + PORTAL_IDLE_MS, iat + PORTAL_MAX_MS);
  const body = Buffer.from(JSON.stringify({ rid, fp: portalFingerprint(portalHash), iat, exp } satisfies Claims)).toString("base64url");
  return { token: `${body}.${mac(body)}`, expiresAt: new Date(exp).toISOString() };
}

export function readPortalToken(token: string, now = Date.now()): Claims | null {
  const [body, sig, extra] = String(token || "").split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(body)), given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    if (!Number.isInteger(c.rid) || typeof c.fp !== "string" || !Number.isFinite(c.iat) || !Number.isFinite(c.exp)) return null;
    if (c.exp <= now || c.iat + PORTAL_MAX_MS <= now) return null;
    return c;
  } catch { return null; }
}
