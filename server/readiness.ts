import { REFERRAL_QUEUE_COLUMNS, sb } from "./db";

// A correct server secret alone does not prove the referral queue can load.
// Validate its actual projection without fetching any clinical rows.
export async function databaseReady(): Promise<boolean> {
  const signal = AbortSignal.timeout(5000);
  const [access, queue] = await Promise.all([
    sb.rpc("is_app_server").abortSignal(signal),
    sb.from("referrals").select(REFERRAL_QUEUE_COLUMNS).limit(0).abortSignal(signal),
  ]);
  return !access.error && access.data === true && !queue.error;
}
