// Run as root on renderer-b. Arguments contain only the public Supabase URL/key.
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
const [url, key] = process.argv.slice(2);
if (url !== "https://vfvwisaqdvigjdngmlyo.supabase.co" || !key?.startsWith("sb_publishable_")) throw new Error("Unexpected Supabase configuration");
const token = crypto.randomBytes(32).toString("hex");
const origin = "https://transferdesk.84-12-115-40.sslip.io";
const values = { SETUP_ORIGIN: origin, SETUP_TOKEN: token, SETUP_EXPIRES: String(Date.now() + 24 * 60 * 60 * 1000), SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key };
writeFileSync("/var/lib/transferdesk/setup.env", Object.entries(values).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
console.log(`${origin}/setup#${token}`);
