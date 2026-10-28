import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import ws from "ws";
import type { Referral, ReferralInput, Doctor, User, AuditRow, AppSettings, Followup } from "@shared/schema";
import { type Team } from "@shared/teams";
import { normalizeHpcsaNumber } from "./hpcsa-verification";

export type PushSub = { endpoint: string; p256dh: string; auth: string };

if(!process.env.APP_DB_SECRET || process.env.APP_DB_SECRET.length<32) throw new Error("Server database secret is not configured");
export const sb = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)!, { auth: { persistSession: false }, realtime: { transport: ws as any }, global: { headers: { "x-app-secret": process.env.APP_DB_SECRET || "" } } });
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const toCamel = (o: any) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [camel(k), v]));
const toSnake = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]));
function chk<T>(r: { data: T; error: any }): T { if (r.error) throw new Error(r.error.message); return r.data; }

export const defaults: AppSettings = { p1: 5, p2: 30, p3: 120, repeat: 5, escalate: 10, sound: true, retentionDays: 90,
  responsibleParty: "Chris Hani Baragwanath Academic Hospital", infoOfficer: "", infoOfficerEmail: "", infoOfficerPhone: "" };

/* ---------- passwords & sessions ---------- */
const scrypt = (pw: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => crypto.scrypt(pw, salt, 64, { N: 16384 }, (e, key) => e ? reject(e) : resolve(key)));
export async function hashPw(pw: string) { const salt = crypto.randomBytes(16); const h = await scrypt(pw, salt); return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`; }
export async function verifyPw(pw: string, stored: string) {
  const [kind, s, h] = String(stored || "").split("$");
  if (kind !== "scrypt" || !/^[0-9a-f]{32}$/.test(s || "") || !/^[0-9a-f]{128}$/.test(h || "")) return false;
  const c = await scrypt(pw, Buffer.from(s, "hex"));
  return crypto.timingSafeEqual(c, Buffer.from(h, "hex"));
}
// Verified against when the username does not exist, so unknown and known accounts take the same time.
const DUMMY_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;
export const verifyPwOrDummy = (pw: string, stored?: string | null) => verifyPw(pw, stored || DUMMY_HASH);
export const isUniqueViolation = (e: unknown) => /duplicate key value violates unique constraint/i.test(String((e as any)?.message || ""));
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const IDLE_MIN = 30, ABS_HOURS = 12;
const userOut = (u: any): User => ({ id: u.id, username: u.username, name: u.name, role: u.role, team:u.team, phone:u.phone || "", active: u.active, mustChange: u.must_change, lastLogin: u.last_login,
  email: u.email || "", hospital: u.hospital || "", department: u.department || "", specialty: u.specialty || "", profession: u.profession || null, hpcsaNumber: u.hpcsa_number || "", verifyStatus: u.verify_status || "none", hasCard: !!u.card_cipher });
function publicReferral(row:any) { const r = toCamel(row); if(r) delete r.portalHash; return r; }

/* ---------- at-rest encryption ----------
 * APP_DB_SECRET is sent to Supabase on every request, so it must not be the only
 * root for data keys. New writes use APP_DATA_KEY (never leaves this server) and
 * are marked with a "v2:" IV prefix; unprefixed rows are legacy and still decrypt
 * with the APP_DB_SECRET-derived key until script/reencrypt-data.ts migrates them. */
const dataKeyRoot = process.env.APP_DATA_KEY || "";
if (dataKeyRoot && (dataKeyRoot.length < 32 || dataKeyRoot === process.env.APP_DB_SECRET)) throw new Error("APP_DATA_KEY must be at least 32 characters and differ from APP_DB_SECRET");
if (!dataKeyRoot) console.warn("APP_DATA_KEY is not set: new images and staff cards are encrypted with the legacy APP_DB_SECRET-derived key");
const V2 = "v2:";
const deriveKey = (root: string, info: string) => Buffer.from(crypto.hkdfSync("sha256", root, "transferdesk-images-v1", info, 32));
export const dataKeys = {
  image: { legacy: deriveKey(process.env.APP_DB_SECRET || "", "private-clinical-images"), current: dataKeyRoot ? deriveKey(dataKeyRoot, "private-clinical-images") : null },
  card: { legacy: deriveKey(process.env.APP_DB_SECRET || "", "referrer-staff-cards"), current: dataKeyRoot ? deriveKey(dataKeyRoot, "referrer-staff-cards") : null },
};
type KeyPair = { legacy: Buffer; current: Buffer | null };
export function sealBytes(bytes: Buffer, keys: KeyPair) {
  const key = keys.current || keys.legacy, iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { cipher: data.toString("base64"), iv: (keys.current ? V2 : "") + iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function openBytes(row: { cipher: string; iv: string; tag: string }, keys: KeyPair) {
  const v2 = row.iv.startsWith(V2);
  if (v2 && !keys.current) throw new Error("APP_DATA_KEY is required to decrypt this record");
  const d = crypto.createDecipheriv("aes-256-gcm", v2 ? keys.current! : keys.legacy, Buffer.from(v2 ? row.iv.slice(V2.length) : row.iv, "base64"));
  d.setAuthTag(Buffer.from(row.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(row.cipher, "base64")), d.final()]);
}
function checkedImageBytes(img: { mime: string; data: string }, label: string) {
  const bytes = Buffer.from(img.data, "base64");
  if (bytes.length > 2 * 1024 * 1024 || !bytes.length) throw new Error(`${label} must be under 2 MB`);
  const ok = img.mime === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) :
    img.mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
    img.mime === "image/webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!ok) throw new Error("Only JPEG, PNG and WebP images are accepted");
  return bytes;
}
export function encryptCard(img: { mime: string; data: string }) {
  return sealBytes(checkedImageBytes(img, "Staff card image"), dataKeys.card);
}
export function encryptImages(images:any[]) {
  return images.map(im => ({ name: im.name.replace(/[^\w .-]/g, "_").slice(0, 100), mime: im.mime, ...sealBytes(checkedImageBytes(im, "Each image"), dataKeys.image) }));
}

export const REFERRAL_QUEUE_COLUMNS = "id,ref,team,consult_type,opened_at,opened_by,latest_followup_at,followup_seen_at,created_at,doctor_name,hospital,department,phone,specialty,current_location,bed_needed,patient_initials,age,sex,diagnosis,reason,suggested_priority,priority,status,decided_by,decided_at,bed_status,bed_ward,remind_at,ack_by,ack_at,purged_at,awaiting_info_at,lat,lon,loc_source";

const AUDIT_QUEUE_MAX = 500;
const auditQueue: Record<string, unknown>[] = [];
let auditDropped = 0, auditFlusher: ReturnType<typeof setInterval> | undefined;
export const auditStatus = () => ({ queued: auditQueue.length, dropped: auditDropped });
async function insertAudit(row: Record<string, unknown>) {
  try { const r = await sb.from("audit_log").insert(row); if (r.error) { console.error("audit failed", r.error.message); return false; } return true; }
  catch (e: any) { console.error("audit failed", e?.message); return false; }
}
export async function flushAuditQueue() {
  while (auditQueue.length) { if (!(await insertAudit(auditQueue[0]))) return; auditQueue.shift(); }
}
function ensureAuditFlusher() {
  if (auditFlusher) return;
  auditFlusher = setInterval(async () => {
    await flushAuditQueue();
    if (!auditQueue.length && auditFlusher) { clearInterval(auditFlusher); auditFlusher = undefined; }
  }, 30_000);
  auditFlusher.unref?.();
}

export const db = {
  /* users */
  async userByName(username: string) { return chk(await sb.from("users").select("*").eq("username", username.toLowerCase().trim()).maybeSingle()) as any; },
  async users(): Promise<User[]> { return (chk(await sb.from("users").select("*").order("name")) as any[]).map(userOut); },
  async addUser(username: string, name: string, role: string, pw: string, team:Team|null=null, phone="") { return userOut(chk(await sb.from("users").insert({ username: username.toLowerCase().trim(), name, role, team, phone, pass_hash: await hashPw(pw), must_change: true }).select().single())); },
  async addReferrer(b: { username: string; name: string; password: string; email: string; phone: string; hospital: string; department: string; specialty: string; profession: string; hpcsa: string; verifyStatus: string }) {
    return userOut(chk(await sb.from("users").insert({
      username: b.username.toLowerCase().trim(), name: b.name, role: "referrer", team: null,
      email: b.email.trim().toLowerCase(), phone: b.phone, hospital: b.hospital, department: b.department, specialty: b.specialty,
      profession: b.profession, hpcsa_number: normalizeHpcsaNumber(b.hpcsa), verify_status: b.verifyStatus,
      pass_hash: await hashPw(b.password), must_change: false,
    }).select().single()));
  },
  async updateReferrer(id: number, b: { name?: string; email?: string; phone?: string; hospital?: string; department?: string; specialty?: string; profession?: string; hpcsa?: string }, before: Pick<User, "name" | "hpcsaNumber" | "verifyStatus">, identityChanged = false) {
    const n: any = {};
    if (b.name !== undefined) n.name = b.name;
    if (b.email !== undefined) n.email = b.email.trim().toLowerCase();
    if (b.phone !== undefined) n.phone = b.phone;
    if (b.hospital !== undefined) n.hospital = b.hospital;
    if (b.department !== undefined) n.department = b.department;
    if (b.specialty !== undefined) n.specialty = b.specialty;
    if (b.profession !== undefined) n.profession = b.profession;
    if (b.hpcsa !== undefined) n.hpcsa_number = normalizeHpcsaNumber(b.hpcsa);
    if (!Object.keys(n).length) return this.userById(id);
    // Revoke approval in the SAME write as the identity edit. Compare the
    // authenticated snapshot so a concurrent approval/edit cannot be overwritten.
    if (identityChanged) Object.assign(n, { verify_status: "card_pending", verified_at: null });
    const row = chk(await sb.from("users").update(n).eq("id", id).eq("role", "referrer")
      .eq("name", before.name).eq("hpcsa_number", before.hpcsaNumber || "").eq("verify_status", before.verifyStatus)
      .select("*").maybeSingle());
    if (!row) throw new Error("REFERRER_PROFILE_CONFLICT");
    return userOut(row);
  },
  async attachCard(id: number, img: { name: string; mime: string; data: string }) {
    const e = encryptCard(img);
    // A register match ("hpcsa") stays flagged as such; everything else waits on the card.
    chk(await sb.from("users").update({ card_cipher: e.cipher, card_iv: e.iv, card_tag: e.tag }).eq("id", id).eq("role", "referrer").neq("verify_status", "verified"));
    chk(await sb.from("users").update({ verify_status: "card_pending" }).eq("id", id).eq("verify_status", "none"));
  },
  async pendingReferrers() {
    const rows = (chk(await sb.from("users").select("*").eq("role", "referrer").in("verify_status", ["card_pending", "hpcsa"]).order("name")) as any[]);
    return rows.map((u) => ({ id: u.id, username: u.username, name: u.name, email: u.email || "", phone: u.phone || "", hospital: u.hospital || "", hpcsa: u.hpcsa_number || "", hpcsaMatched: u.verify_status === "hpcsa", profession: u.profession || "", hasCard: !!u.card_cipher, createdAt: u.created_at }));
  },
  async markHpcsaMatched(id: number, identity: { name: string; hpcsaNumber: string }) {
    chk(await sb.from("users").update({ verify_status: "hpcsa" }).eq("id", id).eq("role", "referrer")
      .eq("name", identity.name).eq("hpcsa_number", identity.hpcsaNumber).neq("verify_status", "verified"));
  },
  async approveReferrer(id: number) {
    return (chk(await sb.from("users").update({ verify_status: "verified", verified_at: new Date().toISOString() }).eq("id", id).eq("role", "referrer").select("id")) as any[]).length > 0;
  },
  async demoteReferrer(id: number) {
    chk(await sb.from("users").update({ verify_status: "card_pending", verified_at: null }).eq("id", id));
  },
  async rejectReferrer(id: number) {
    return (chk(await sb.from("users").update({ verify_status: "none", verified_at: null, card_cipher: null, card_iv: null, card_tag: null }).eq("id", id).eq("role", "referrer").select("id")) as any[]).length > 0;
  },
  async referrerCard(id: number) {
    const r: any = chk(await sb.from("users").select("card_cipher,card_iv,card_tag").eq("id", id).eq("role", "referrer").maybeSingle());
    if (!r?.card_cipher) return null;
    return openBytes({ cipher: r.card_cipher, iv: r.card_iv, tag: r.card_tag }, dataKeys.card).toString("base64");
  },
  async hpcsaLookup(name: string, number: string) {
    const n = normalizeHpcsaNumber(number);
    // Primary: exact match on the normalized number — uses the btree hpcsa_number_idx
    // (fast, index seek). `ilike` cannot use that index and times out once the
    // register is large, so the number path must stay an exact `eq`.
    if (n) {
      const byNum = chk(await sb.from("hpcsa_register").select("*").eq("hpcsa_number", n).limit(5)) as any[];
      if (byNum.length) return { number: n, rows: byNum, name: name };
      // Number not found — the number IS the verification, so no need to run a slow
      // name scan just to second-guess it. Return the (empty) number result; the caller
      // treats "number not in register" as card_pending.
      return { number: n, rows: [], name: name };
    }
    // No number supplied: fall back to a prefix search on the first name token, which
    // can use the btree full_name_idx. Bounded to 20; a timeout here still must not
    // 500 the signup, so the caller wraps this in a guard.
    const first = (name.trim().split(/\s+/)[0] || "").toUpperCase();
    const byName = chk(await sb.from("hpcsa_register").select("*").like("full_name", `${first}%`).limit(20)) as any[];
    return { number: n, rows: byName, name: name };
  },
  async userById(id:number) { const r=chk(await sb.from("users").select("*").eq("id",id).maybeSingle()); return r ? userOut(r) : null; },
  async updateUser(id: number, u: Record<string, any>) { return chk(await sb.from("users").update(u).eq("id", id)); },
  async userCount() { const r = await sb.from("users").select("id", { count: "exact", head: true }); if (r.error) throw new Error(r.error.message); return r.count || 0; },
  // Throws when either lookup fails: a failed check must not read as "no account".
  async userByIdentity(username: string, email: string) {
    const byUser = chk(await sb.from("users").select("id").eq("username", username.toLowerCase().trim()).limit(1)) as any[];
    if (byUser.length) return byUser[0];
    if (!email.trim()) return null;
    const byEmail = chk(await sb.from("users").select("id").eq("email", email.trim().toLowerCase()).limit(1)) as any[];
    return byEmail[0] || null;
  },
  async emailTaken(email: string, exceptId: number) {
    const rows = chk(await sb.from("users").select("id").eq("email", email.trim().toLowerCase()).neq("id", exceptId).limit(1)) as any[];
    return rows.length > 0;
  },
  async createSession(userId: number) { const token = crypto.randomBytes(32).toString("base64url");
    chk(await sb.from("sessions").insert({ id: sha(token), user_id: userId, expires_at: new Date(Date.now() + ABS_HOURS * 3600e3).toISOString() })); return token; },
  async sessionUser(token: string) {
    const s: any = chk(await sb.from("sessions").select("*, users(*)").eq("id", sha(token)).maybeSingle());
    if (!s || !s.users?.active) return null;
    const now = Date.now();
    if (new Date(s.expires_at).getTime() < now || now - new Date(s.last_seen).getTime() > IDLE_MIN * 60000) { await sb.from("sessions").delete().eq("id", s.id); return null; }
    if (now - new Date(s.last_seen).getTime() > 60000) await sb.from("sessions").update({ last_seen: new Date().toISOString() }).eq("id", s.id);
    return { ...userOut(s.users) };
  },
  async endSession(token: string) { await sb.from("sessions").delete().eq("id", sha(token)); },
  async endUserSessions(userId: number) { chk(await sb.from("sessions").delete().eq("user_id", userId)); },
  async endOtherSessions(userId: number, keepToken: string) { chk(await sb.from("sessions").delete().eq("user_id", userId).neq("id", sha(keepToken))); },
  async purgeStaleSessions() {
    const now = Date.now();
    chk(await sb.from("sessions").delete().or(`expires_at.lt.${new Date(now).toISOString()},last_seen.lt.${new Date(now - IDLE_MIN * 60000).toISOString()}`));
  },

  /* referrals */
  async list(team?:Team|null, referrerId?:number|null): Promise<Referral[]> {
    // Staff queues do not use the referrer ownership field. Keep their existing
    // projection compatible while the additive referrer migration is pending.
    // Referrer queries still require that column and always fail closed.
    let q=sb.from("referrals").select(referrerId !== undefined ? `${REFERRAL_QUEUE_COLUMNS},referrer_id` : REFERRAL_QUEUE_COLUMNS).order("created_at",{ascending:false}).limit(500);
    if(referrerId !== undefined) { q=q.eq("referrer_id",referrerId); }
    else if(team !== undefined) { if(!team) return []; q=q.eq("team",team); }
    return (chk(await q) as any[]).map(toCamel);
  },
  async get(id: number): Promise<Referral | undefined> { return publicReferral(chk(await sb.from("referrals").select("*").eq("id", id).maybeSingle())); },
  async byRef(ref: string) { return toCamel(chk(await sb.from("referrals").select("ref,phone,status,priority,decided_at,created_at,bed_status,purged_at").eq("ref", ref).maybeSingle())); },
  async create(d: ReferralInput, referrerId: number | null = null): Promise<Referral> {
    const ref = "TX-" + crypto.randomBytes(8).toString("hex").toUpperCase();
    const code=crypto.randomBytes(16).toString("hex"); const {images,...input}=d;
    const ims=encryptImages(images);
    const r:any=publicReferral(chk(await sb.from("referrals").insert(toSnake({ ...input, ref, portalHash:sha(code), priority: d.suggestedPriority, referrerId, locSource: "Submitted facility location" })).select().single()));
    try { if(ims.length) chk(await sb.from("referral_images").insert(ims.map(im=>({...im,referral_id:r.id})))); }
    catch(e) { await sb.from("referrals").delete().eq("id",r.id); throw e; }
    return {...r, followupCode:code};
  },
  async portalLogin(ref:string,code:string):Promise<{referral:Referral;portalHash:string}|null> {
    if(!/^[a-f0-9]{32}$/.test(code)) return null;
    const r:any=chk(await sb.from("referrals").select("*").eq("ref",ref.trim().toUpperCase()).eq("portal_hash",sha(code)).maybeSingle());
    return r && !r.purged_at ? { referral: publicReferral(r), portalHash: r.portal_hash } : null;
  },
  async portal(ref:string,code:string):Promise<Referral|null> { return (await this.portalLogin(ref,code))?.referral ?? null; },
  async portalById(id:number):Promise<{referral:Referral;portalHash:string}|null> {
    const r:any=chk(await sb.from("referrals").select("*").eq("id",id).maybeSingle());
    return r && !r.purged_at ? { referral: publicReferral(r), portalHash: r.portal_hash } : null;
  },
  async resetPortal(id:number) { const code=crypto.randomBytes(16).toString("hex"); chk(await sb.from("referrals").update({portal_hash:sha(code)}).eq("id",id)); return code; },
  // seenUpTo is the latest_followup_at the viewer is being shown, so a follow-up
  // that arrives after the read stays flagged for the unit. It never moves back.
  async markOpened(id:number,name:string,seenUpTo?:string|null) {
    chk(await sb.from("referrals").update({opened_at:new Date().toISOString(),opened_by:name}).eq("id",id).is("opened_at",null));
    if(seenUpTo) chk(await sb.from("referrals").update({followup_seen_at:seenUpTo}).eq("id",id).or(`followup_seen_at.is.null,followup_seen_at.lt.${JSON.stringify(seenUpTo)}`));
  },
  async timeline(id:number):Promise<Followup[]> {
    const rows:any[]=chk(await sb.from("referral_followups").select("id,created_at,author,kind,body").eq("referral_id",id).order("created_at",{ascending:true})) || [];
    const images=await this.images(id);
    return rows.map(r=>({...toCamel(r),images:images.filter(im=>im.followupId===r.id)}));
  },
  async images(id:number) { return (chk(await sb.from("referral_images").select("id,name,mime,created_at,followup_id").eq("referral_id",id)) as any[]).map(toCamel); },
  async image(id:number,referralId:number) {
    const r:any=chk(await sb.from("referral_images").select("*").eq("id",id).eq("referral_id",referralId).maybeSingle());
    if(!r) return null;
    return {id:r.id,name:r.name,mime:r.mime,data:openBytes(r,dataKeys.image).toString("base64")};
  },
  async append(id:number,author:string,userId:number|null,kind:string,body:string,images:any[]=[]) {
    return chk(await sb.rpc("append_followup",{p_referral:id,p_author:author,p_user:userId,p_kind:kind,p_body:body,p_images:encryptImages(images)}));
  },
  async respond(id:number,status:string,body:string,author:string,userId:number,remindAt:string|null) {
    chk(await sb.rpc("record_response",{p_referral:id,p_status:status,p_body:body,p_author:author,p_user:userId,p_remind:remindAt}));
    return this.get(id);
  },
  async roster(team:Team,day:string) {
    const r:any=chk(await sb.from("unit_rosters").select("*").eq("team",team).eq("day",day).maybeSingle());
    if(!r) return null;
    const users=await this.users();
    return {...r,entries:r.entries.map((e:any)=>({...e,name:users.find(u=>u.id===e.userId)?.name||"Former team member",phone:users.find(u=>u.id===e.userId)?.phone||""}))};
  },
  async rosterUserIds(team:Team,day:string):Promise<number[]> {
    const r:any=chk(await sb.from("unit_rosters").select("entries").eq("team",team).eq("day",day).maybeSingle());
    return (r?.entries||[]).map((e:any)=>Number(e.userId)).filter((id:number)=>Number.isInteger(id)&&id>0);
  },
  async saveRoster(team:Team,day:string,entries:any[],name:string) { return chk(await sb.from("unit_rosters").upsert({team,day,entries,updated_by:name,updated_at:new Date().toISOString()})); },
  async update(id: number, u: Record<string, any>) {
    const cur: any = await this.get(id); if (!cur) return undefined;
    const { ack, ...rest } = u; const n: any = { ...rest };
    if (u.status) { n.decidedAt = new Date().toISOString(); if (u.status !== "waiting") n.remindAt = null; }
    if ((ack || (u.status && u.status !== "pending")) && !cur.ackAt) { n.ackAt = new Date().toISOString(); n.ackBy = ack || u.decidedBy || ""; }
    return toCamel(chk(await sb.from("referrals").update(toSnake(n)).eq("id", id).select().single()));
  },
  async remove(id: number) { chk(await sb.from("referrals").delete().eq("id", id)); },
  async purgeOlderThan(days: number) {
    return Number(chk(await sb.rpc("purge_clinical_data",{p_days:days})));
  },
  async doctors(team?:Team|null): Promise<Doctor[]> {
    let q=sb.from("referrals").select("doctor_name,hospital,department,phone,email,created_at").order("created_at",{ascending:false}).limit(2000);
    if(team!==undefined) { if(!team) return []; q=q.eq("team",team); }
    const rows = chk(await q) as any[];
    const m = new Map<string, Doctor>();
    for (const r of rows) { const k = r.phone; const d = m.get(k); if (d) { d.count++; if (!d.email && r.email) d.email = r.email; } else m.set(k, { doctorName: r.doctor_name, hospital: r.hospital, department: r.department, phone: r.phone, email: r.email || "", count: 1, last: r.created_at }); }
    return Array.from(m.values());
  },

  /* push notifications */
  async savePushSub(sub:{endpoint:string;p256dh:string;auth:string},owner:{userId:number}|{referralId:number}) {
    const row={endpoint:sub.endpoint,p256dh:sub.p256dh,auth:sub.auth,user_id:"userId" in owner?owner.userId:null,referral_id:"referralId" in owner?owner.referralId:null};
    chk(await sb.from("push_subscriptions").upsert(row,{onConflict:"endpoint"}));
  },
  async removePushSub(endpoint:string,owner?:{userId:number}|{referralId:number}) {
    let q=sb.from("push_subscriptions").delete().eq("endpoint",endpoint);
    if(owner) q="userId" in owner?q.eq("user_id",owner.userId):q.eq("referral_id",owner.referralId);
    chk(await q);
  },
  async pushSubsForUsers(ids:number[]):Promise<PushSub[]> {
    if(!ids.length) return [];
    return chk(await sb.from("push_subscriptions").select("endpoint,p256dh,auth").in("user_id",ids)) as PushSub[];
  },
  async pushSubsForReferral(id:number):Promise<PushSub[]> {
    return chk(await sb.from("push_subscriptions").select("endpoint,p256dh,auth").eq("referral_id",id)) as PushSub[];
  },
  async pushDeviceCounts(ids:number[]):Promise<Record<number,number>> {
    if(!ids.length) return {};
    const rows=chk(await sb.from("push_subscriptions").select("user_id").in("user_id",ids)) as any[];
    return rows.reduce((m:Record<number,number>,r)=>{m[r.user_id]=(m[r.user_id]||0)+1;return m;},{});
  },
  // True only for the caller that recorded the key; a repeat or a second server gets false.
  async claimPush(key:string):Promise<boolean> {
    const r=await sb.from("push_sent").insert({key});
    if(!r.error) return true;
    if(isUniqueViolation(r.error)) return false;
    throw new Error(r.error.message);
  },
  async prunePushSent(days:number) { chk(await sb.from("push_sent").delete().lt("sent_at",new Date(Date.now()-days*86400e3).toISOString())); },
  async pushDue(since:string,waitingSince:string,now:string) {
    const cols="id,ref,team,priority,status,created_at,opened_at,ack_at,latest_followup_at,followup_seen_at,remind_at,awaiting_info_at,referrer_id";
    const base=()=>sb.from("referrals").select(cols).is("purged_at",null);
    const [unattended,followups,questions,waiting]=await Promise.all([
      base().eq("status","pending").is("opened_at",null).is("ack_at",null).gte("created_at",since).lte("created_at",now),
      base().gte("latest_followup_at",since).lte("latest_followup_at",now),
      base().gte("awaiting_info_at",since).lte("awaiting_info_at",now),
      base().eq("status","waiting").gte("remind_at",waitingSince).lte("remind_at",now),
    ]);
    const rows=(r:any)=>(chk(r) as any[]).map(toCamel);
    return {unattended:rows(unattended),followups:rows(followups).filter((r:any)=>!r.followupSeenAt||r.latestFollowupAt>r.followupSeenAt),questions:rows(questions),waiting:rows(waiting)};
  },

  /* audit */
  // A failed audit write is retried once straight away, then held in memory and
  // retried (in order) until it lands. The queue is bounded and lost on restart,
  // so /api/health reports it and operators can alert on a non-empty backlog.
  async audit(e: { userId?: number | null; userName?: string; action: string; referralId?: number | null; detail?: string; ip?: string }) {
    const row = { user_id: e.userId ?? null, user_name: e.userName || "", action: e.action, referral_id: e.referralId ?? null, detail: (e.detail || "").slice(0, 500), ip: e.ip || "" };
    if (auditQueue.length) await flushAuditQueue();
    if (!auditQueue.length && (await insertAudit(row) || await insertAudit(row))) return;
    console.error("audit write failed; queued for retry");
    if (auditQueue.length >= AUDIT_QUEUE_MAX) { auditQueue.shift(); auditDropped++; }
    auditQueue.push(row); ensureAuditFlusher();
  },
  async auditList(opts: { referralId?: number; limit?: number }): Promise<AuditRow[]> {
    let q = sb.from("audit_log").select("*").order("at", { ascending: false }).limit(opts.limit || 300);
    if (opts.referralId) q = q.eq("referral_id", opts.referralId);
    return (chk(await q) as any[]).map(toCamel);
  },

  /* settings */
  async settings(): Promise<AppSettings> { const r: any = chk(await sb.from("settings").select("v").eq("k", "app").maybeSingle()); return { ...defaults, ...(r?.v || {}) }; },
  async saveSettings(v: Partial<AppSettings>) { const cur = await this.settings(); const n = { ...cur, ...v }; chk(await sb.from("settings").upsert({ k: "app", v: n })); return n; },
};
