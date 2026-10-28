import assert from "node:assert/strict";
import { test } from "node:test";
import { createTokenStore, REFERRER_KEY, STAFF_KEY } from "../client/src/lib/token-store";
import { openedNotice, updateNotice } from "../client/src/lib/referrer-notice";

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
};

test("referrer tokens are kept for the browser session only, never in localStorage", () => {
  const session = memory(), local = memory();
  const store = createTokenStore(session, local);
  store.save("referrer", "ref-token");
  assert.equal(session.data.get(REFERRER_KEY), "ref-token");
  assert.equal(local.data.size, 0);
  assert.equal(store.read(), "ref-token");
  store.save("clinician", "staff-token");
  assert.equal(session.data.get(STAFF_KEY), "staff-token");
  assert.equal(local.data.size, 0);
});

test("a token left in localStorage by an older version is removed and not honoured", () => {
  const session = memory(), local = memory({ [REFERRER_KEY]: "old-token", td_referrer: "{}" });
  const store = createTokenStore(session, local);
  assert.equal(store.read(), "");
  store.dropLegacy();
  assert.equal(local.data.size, 0);
  store.save("referrer", "new");
  store.clear();
  assert.equal(store.read(), "");
  assert.equal(session.data.size, 0);
});

test("storage that throws never breaks sign-in or sign-out", () => {
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  const store = createTokenStore(broken, broken);
  assert.equal(store.read(), "");
  assert.doesNotThrow(() => { store.save("referrer", "t"); store.clear(); store.dropLegacy(); });
});

test("WhatsApp drafts carry the reference only, with no patient or decision details", () => {
  const text = updateNotice({ doctor: "Smith", ref: "TX-ABC123", sender: "Dr Jones" });
  assert.match(text, /TX-ABC123/);
  assert.match(text, /sign in/i);
  assert.doesNotMatch(text, /patient|accept|declin|waiting|note|advice|\bbed\b/i);
  const opened = openedNotice({ ref: "TX-ABC123", team: "MEU" });
  assert.match(opened, /not acceptance for transfer/);
  assert.doesNotMatch(opened, /patient/i);
});
