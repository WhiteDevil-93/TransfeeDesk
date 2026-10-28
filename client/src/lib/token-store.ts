type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const STAFF_KEY = "bb_staff_token";
export const REFERRER_KEY = "td_token";
const LEGACY_LOCAL_KEYS = [REFERRER_KEY, "td_referrer"];

export type TokenStore = {
  read: () => string;
  save: (role: string, token: string) => void;
  clear: () => void;
  dropLegacy: () => void;
};

/**
 * Session tokens live in sessionStorage for every role, so closing the tab or
 * app ends the sign-in on a shared hospital device. Referrer tokens used to be
 * kept in localStorage; those are removed rather than honoured.
 */
export function createTokenStore(session: Store, local: Store): TokenStore {
  const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
  const dropLegacy = () => safe(() => { for (const key of LEGACY_LOCAL_KEYS) local.removeItem(key); }, undefined);
  return {
    read: () => safe(() => session.getItem(STAFF_KEY) || session.getItem(REFERRER_KEY) || "", ""),
    save: (role, token) => safe(() => session.setItem(role === "referrer" ? REFERRER_KEY : STAFF_KEY, token), undefined),
    clear: () => { safe(() => { session.removeItem(STAFF_KEY); session.removeItem(REFERRER_KEY); }, undefined); dropLegacy(); },
    dropLegacy,
  };
}

const unavailable: Store = { getItem: () => null, setItem: () => { throw new Error("storage unavailable"); }, removeItem: () => {} };
const pick = (get: () => Storage): Store => { try { return get(); } catch { return unavailable; } };
export const browserTokenStore = () => createTokenStore(pick(() => window.sessionStorage), pick(() => window.localStorage));
