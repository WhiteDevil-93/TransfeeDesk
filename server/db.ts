import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import ws from "ws";
import type { Referral, ReferralInput, Doctor, User, AuditRow, AppSettings, Followup } from "@shared/schema";
import { type Team } from "@shared/teams";

if(!process.env.APP_DB_SECRET || process.env.APP_DB_SECRET.length<32) throw new Error("Server database secret is not configured");
export const sb = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)!, { auth: { persistSession: false }, realtime: { transport: ws as any }, global: { headers: { "x-app-secret": process.env.APP_DB_SECRET || "" } } });
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const toCamel = (o: any) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [camel(k), v]));
const toSnake = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]));
function chk<T>(r: { data: T; error: any }): T { if (r.error) throw new Error(r.error.message); return r.data; }

export const defaults: AppSettings = { p1: 5, p2: 30, p3: 120, repeat: 5, sound: true, retentionDays: 90,
  responsibleParty: "Chris Hani Baragwanath Academic Hospital", infoOfficer: "", infoOfficerEmail: "", infoOfficerPhone: "" };

/* ---------- passwords & sessions ---------- */
export function hashPw(pw: string) { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 64, { N: 16384 }); return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`; }
export function verifyPw(pw: string, stored: string) { const [, s, h] = stored.split("$"); if (!s || !h) return false; const c = crypto.scryptSync(pw, Buffer.from(s, "hex"), 64, { N: 16384 }); return crypto.timingSafeEqual(c, Buffer.from(h, "hex")); }
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const IDLE_MIN = 30, ABS_HOURS = 12;
const userOut = (u: any): User => ({ id: u.id, username: u.username, name: u.name, role: u.role, team:u.team, phone:u.phone || "", active: u.active, mustChange: u.must_change, lastLogin: u.last_login,
  email: u.email || "", specialty: u.specialty || "", profession: u.profession || null, hpcsaNumber: u.hpcsa_number || "", verifyStatus: u.verify_status || "none", hasCard: !!u.card_cipher });
function publicReferral(row:any) { const r = toCamel(row); if(r) delete r.portalHash; return r; }
const imgKey = Buffer.from(crypto.hkdfSync("sha256", process.env.APP_DB_SECRET || "", "transferdesk-images-v1", "private-clinical-images", 32));
const cardKey = Buffer.from(crypto.hkdfSync("sha256", process.env.APP_DB_SECRET || "", "transferdesk-images-v1", "referrer-staff-cards", 32));
export function encryptCard(img: { mime: string; data: string }) {
  const bytes = Buffer.from(img.data, "base64");
  if (bytes.length > 2 * 1024 * 1024 || !bytes.length) throw new Error("Staff card image must be under 2 MB");
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", cardKey, iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { cipher: data.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function encryptImages(images:any[]) {
  return images.map(im => {
    const bytes = Buffer.from(im.data,"base64");
    if(bytes.length > 2*1024*1024 || !bytes.length) throw new Error("Each image must be under 2 MB");
    const ok = im.mime==="image/jpeg" ? bytes.subarray(0,3).equals(Buffer.from([255,216,255])) :
      im.mime==="image/png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      im.mime==="image/webp" && bytes.subarray(0,4).toString()==="RIFF" && bytes.subarray(8,12).toString()==="WEBP";
    if(!ok) throw new Error("Only JPEG, PNG and WebP images are accepted");
    const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",imgKey,iv);
    const data=Buffer.concat([cipher.update(bytes),cipher.final()]);
    return {name:im.name.replace(/[^\w .-]/g,"_").slice(0,100),mime:im.mime,cipher:data.toString("base64"),iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
  });
}

export const REFERRAL_QUEUE_COLUMNS = "id,ref,team,consult_type,opened_at,opened_by,latest_followup_at,followup_seen_at,created_at,doctor_name,hospital,department,phone,specialty,current_location,bed_needed,patient_initials,age,sex,diagnosis,reason,suggested_priority,priority,status,decided_by,decided_at,bed_status,bed_ward,remind_at,ack_by,ack_at,purged_at,lat,lon,loc_source";

export const db = {
  /* users */
  async userByName(username: string) { return chk(await sb.from("users").select("*").eq("username", username.toLowerCase().trim()).maybeSingle()) as any; },
  async users(): Promise<User[]> { return (chk(await sb.from("users").select("*").order("name")) as any[]).map(userOut); },
  async addUser(username: string, name: string, role: string, pw: string, team:Team|null=null, phone="") { return userOut(chk(await sb.from("users").insert({ username: username.toLowerCase().trim(), name, role, team, phone, pass_hash: hashPw(pw), must_change: true }).select().single())); },
  async addReferrer(b: { username: string; name: string; password: string; email: string; phone: string; hospital: string; department: string; specialty: string; profession: string; hpcsa: string }) {
    return userOut(chk(await sb.from("users").insert({
      username: b.username.toLowerCase().trim(), name: b.name, role: "referrer", team: null,
      email: b.email.trim().toLowerCase(), phone: b.phone, specialty: b.specialty,
      profession: b.profession, hpcsa_number: b.hpcsa.replace(/\s+/g, ""),
      pass_hash: hashPw(b.password), must_change: false,
    }).select().single()));
  },
  async updateReferrer(id: number, b: { name?: string; email?: string; phone?: string; hospital?: string; department?: string; specialty?: string; profession?: string; hpcsa?: string }) {
    const n: any = {};
    if (b.name !== undefined) n.name = b.name;
    if (b.email !== undefined) n.email = b.email.trim().toLowerCase();
    if (b.phone !== undefined) n.phone = b.phone;
    if (b.specialty !== undefined) n.specialty = b.specialty;
    if (b.profession !== undefined) n.profession = b.profession;
    if (b.hpcsa !== undefined) n.hpcsa_number = b.hpcsa.replace(/\s+/g, "");
    if (Object.keys(n).length) chk(await sb.from("users").update(n).eq("id", id));
    return this.userById(id);
  },
  async attachCard(id: number, img: { name: string; mime: string; data: string }) {
    const e = encryptCard(img);
    chk(await sb.from("users").update({ card_cipher: e.cipher, card_iv: e.iv, card_tag: e.tag, verify_status: "card_pending" }).eq("id", id));
  },
  async pendingReferrers() {
    const rows = (chk(await sb.from("users").select("*").eq("verify_status", "card_pending").order("name")) as any[]);
    return rows.map((u) => ({ id: u.id, username: u.username, name: u.name, email: u.email || "", phone: u.phone || "", hpcsa: u.hpcsa_number || "", profession: u.profession || "", hasCard: !!u.card_cipher, createdAt: u.created_at }));
  },
  async approveReferrer(id: number, by: string) {
    chk(await sb.from("users").update({ verify_status: "verified", verified_at: new Date().toISOString() }).eq("id", id));
  },
  async rejectReferrer(id: number) {
    chk(await sb.from("users").update({ verify_status: "none", verified_at: null, card_cipher: null, card_iv: null, card_tag: null }).eq("id", id));
  },
  async referrerCard(id: number) {
    const r: any = chk(await sb.from("users").select("card_cipher,card_iv,card_tag").eq("id", id).maybeSingle());
    if (!r?.card_cipher) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", cardKey, Buffer.from(r.card_iv, "base64"));
    d.setAuthTag(Buffer.from(r.card_tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(r.card_cipher, "base64")), d.final()]).toString("base64");
  },
  async hpcsaLookup(name: string, number: string) {
    const n = number.replace(/\s+/g, "");
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
  async userByIdentity(username: string, email: string) {
    const byUser = await sb.from("users").select("*").eq("username", username.toLowerCase().trim()).maybeSingle();
    if (byUser.data) return byUser.data as any;
    const byEmail = email.trim()
      ? await sb.from("users").select("*").eq("email", email.trim().toLowerCase()).maybeSingle()
      : { data: null as any };
    return (byUser.error ? null : byEmail.data) as any;
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
  async endUserSessions(userId: number) { await sb.from("sessions").delete().eq("user_id", userId); },

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
  async byRef(ref: string) { return toCamel(chk(await sb.from("referrals").select("ref,phone,status,priority,decided_at,created_at,bed_status").eq("ref", ref).maybeSingle())); },
  async create(d: ReferralInput, referrerId: number | null = null): Promise<Referral> {
    const ref = "TX-" + crypto.randomBytes(8).toString("hex").toUpperCase();
    const code=crypto.randomBytes(16).toString("hex"); const {images,...input}=d;
    const ims=encryptImages(images);
    const r:any=publicReferral(chk(await sb.from("referrals").insert(toSnake({ ...input, ref, portalHash:sha(code), priority: d.suggestedPriority, referrerId, locSource: "Submitted facility location" })).select().single()));
    try { if(ims.length) chk(await sb.from("referral_images").insert(ims.map(im=>({...im,referral_id:r.id})))); }
    catch(e) { await sb.from("referrals").delete().eq("id",r.id); throw e; }
    return {...r, followupCode:code};
  },
  async portal(ref:string,code:string):Promise<Referral|null> {
    if(!/^[a-f0-9]{32}$/.test(code)) return null;
    const r:any=chk(await sb.from("referrals").select("*").eq("ref",ref.trim().toUpperCase()).eq("portal_hash",sha(code)).maybeSingle());
    return r && !r.purged_at ? publicReferral(r) : null;
  },
  async resetPortal(id:number) { const code=crypto.randomBytes(16).toString("hex"); chk(await sb.from("referrals").update({portal_hash:sha(code)}).eq("id",id)); return code; },
  async markOpened(id:number,name:string) {
    const at=new Date().toISOString();
    chk(await sb.from("referrals").update({opened_at:at,opened_by:name}).eq("id",id).is("opened_at",null));
    chk(await sb.from("referrals").update({followup_seen_at:at}).eq("id",id));
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
    const d=crypto.createDecipheriv("aes-256-gcm",imgKey,Buffer.from(r.iv,"base64")); d.setAuthTag(Buffer.from(r.tag,"base64"));
    return {id:r.id,name:r.name,mime:r.mime,data:Buffer.concat([d.update(Buffer.from(r.cipher,"base64")),d.final()]).toString("base64")};
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

  /* audit */
  async audit(e: { userId?: number | null; userName?: string; action: string; referralId?: number | null; detail?: string; ip?: string }) {
    const r = await sb.from("audit_log").insert({ user_id: e.userId ?? null, user_name: e.userName || "", action: e.action, referral_id: e.referralId ?? null, detail: (e.detail || "").slice(0, 500), ip: e.ip || "" });
    if (r.error) console.error("audit failed", r.error.message);
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
