// Run as root on the host. Arguments: the Supabase project URL, its publishable key
// (both public values) and the public HTTPS origin the setup page is served from.
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
const [url, key, origin] = process.argv.slice(2);
const usage = "Usage: node configure-setup.mjs <https://PROJECT.supabase.co> <sb_publishable_...> <https://public-origin>";
if (!url || !key || !origin) throw new Error(usage);
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key.startsWith("sb_publishable_")) throw new Error(`Unexpected Supabase configuration. ${usage}`);
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) throw new Error(`The public origin must be an https origin without a path. ${usage}`);
const token = crypto.randomBytes(32).toString("hex");
const values = { SETUP_ORIGIN: origin, SETUP_TOKEN: token, SETUP_EXPIRES: String(Date.now() + 24 * 60 * 60 * 1000), SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key };
writeFileSync("/var/lib/transferdesk/setup.env", Object.entries(values).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
console.log(`${origin}/setup#${token}`);
