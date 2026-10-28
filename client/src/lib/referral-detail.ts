// The queue row is a reduced projection (no history, exam, investigations,
// timeline or images) and may be older than the detail response. Decisions are
// only allowed once the full record for the same referral has loaded, and the
// full record always wins over the queue row.
export function resolveDetail<Q extends { id: number }, F extends Q>(lite: Q | null, full: F | undefined, failed: boolean): { r: Q | F | null; ready: boolean } {
  if (!lite) return { r: null, ready: false };
  const current = full && full.id === lite.id ? full : undefined;
  return { r: current ?? lite, ready: !!current && !failed };
}
