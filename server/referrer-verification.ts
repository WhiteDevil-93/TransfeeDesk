import type { User } from "../shared/schema";
import { db } from "./db";
import { hpcsaIdentityMatches, normalizeHpcsaNumber } from "./hpcsa-verification";

// Recheck accounts created before automatic verification or before their
// register record was imported. Explicitly rejected/disabled accounts stay so.
export async function verifyPendingReferrer(user: User): Promise<User> {
  if (user.role !== "referrer" || !user.active || !["hpcsa", "card_pending"].includes(user.verifyStatus || "")) return user;
  const number = normalizeHpcsaNumber(user.hpcsaNumber || "");
  if (!number) return user;
  try {
    const hits = await db.hpcsaLookup(user.name, number);
    if (!hits.rows.some(record => hpcsaIdentityMatches(user.name, number, record))) return user;
    const verified = await db.verifyMatchedReferrer(user.id, user);
    if (!verified) return await db.userById(user.id) || user;
    await db.audit({ userId: user.id, userName: user.name, action: "referrer_auto_verified", detail: "Name and registration number matched the imported register" });
    return verified;
  } catch {
    // Register unavailability must not prevent login or grant verification.
    console.error("Automatic referrer verification unavailable");
    return user;
  }
}
