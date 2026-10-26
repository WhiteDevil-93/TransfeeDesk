import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import fs from "node:fs"; import path from "node:path";
import { db, verifyPw } from "./db";
import { geocode } from "./geocode";
import { referralInput, decisionInput, followupInput, imageInput } from "@shared/schema";
import { TEAMS, canAccess, canManage, type Team } from "@shared/teams";
import { z } from "zod";
import { appendChecklistSurnames, searchIRegister } from "../script/hpcsa-scrape";
import { hpcsaIdentityMatches } from "./hpcsa-verification";

// Surname that a new unverified referrer needs in the register. Added to the
// checklist so the scheduled refresh covers it, AND fetched immediately (when
// the DB is reachable) so verification works on the next signup attempt.
let surnameQueueBusy = false;
async function queueSurnameForRefresh(fullName: string) {
  const surname = (fullName.trim().split(/\s+/).pop() || fullName).toUpperCase();
  if (!surname) return;
  try {
    appendChecklistSurnames(surname);
    if (surnameQueueBusy) return;
    surnameQueueBusy = true;
    const rows = await searchIRegister(surname, true);
    if (rows.length) {
      // Upsert inline so the very next signup for this surname can verify.
      const { sb } = await import("./db");
      for (const r of rows) {
        await sb.from("hpcsa_register").upsert(
          { surname: r.surname, full_name: r.full_name, registration_number: r.registration_number, hpcsa_number: r.registration_number.startsWith("NOREG_") ? "" : r.registration_number.replace(/\s+/g, ""), categories: r.categories, city: r.city, postal_code: r.postal_code, status: r.status, scraped_at: new Date().toISOString() },
          { onConflict: "registration_number" }
        );
      }
      console.log(`queued surname ${surname}: fetched ${rows.length} rows immediately`);
    }
  } catch (e: any) {
    console.error(`queued surname ${surname}: immediate fetch failed, waiting for scheduled refresh`, e?.message || e);
  } finally {
    surnameQueueBusy = false;
  }
}

const referrerProfile = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(100),
  phone: z.string().min(9).max(30),
  hospital: z.string().max(100).optional().default(""),
  department: z.string().max(100).optional().default(""),
  specialty: z.string().min(1).max(100),
  profession: z.enum(["doctor", "nurse", "other"]),
  hpcsa: z.string().max(30).optional().default(""),
});

// The roster is a hand/AI-regenerated file (an agent rewrites it from the monthly
// CHBAH PDFs). It's read fresh on each request (cached only by mtime) so dropping in
// a new `roster.json` or `data.js` takes effect immediately — no server restart.
// If a write is mid-flight and the file momentarily fails to parse, we fall back to
// the last good roster instead of 500ing the consult flow.
// data.js is the AI agent's output format (same as the CHBAH On-Call app), so it's
// primary; roster.json is a fallback. The agent drops in a fresh data.js each cycle.
const ROSTER_FILES = ["data.js", "roster.json"];
let rosterCache: { file: string; mtimeMs: number; data: any } | null = null;
function loadRoster(): any {
  for (const file of ROSTER_FILES) {
    const p = path.resolve(process.cwd(), file);
    try {
      const st = fs.statSync(p);
      if (rosterCache && rosterCache.file === file && rosterCache.mtimeMs === st.mtimeMs) return rosterCache.data;
      const raw = fs.readFileSync(p, "utf8").trim();
      const json = raw.startsWith("{") ? raw : raw.replace(/^window\.ROSTER\s*=\s*/i, "").replace(/;\s*$/, "");
      const data = JSON.parse(json);
      if (Array.isArray(data.specialties)) { rosterCache = { file, mtimeMs: st.mtimeMs, data }; return data; }
    } catch { /* try next file */ }
  }
  return rosterCache?.data; // last good parse, or undefined
}
function rosterSpecs(): any[] { return loadRoster()?.specialties || []; }
const saToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
function rosterFor(date: string, spec?: string) {
  return rosterSpecs().filter(s => !spec || s.id === spec).map(s => {
    const cmap: Record<string, any> = {}; (s.contacts || []).forEach((c: any) => cmap[c.id] = c);
    return { id: s.id, name: s.name, group: s.group, period: s.period, notes: s.notes || [],
      entries: (s.days?.[date] || []).map(([role, text, ids]: any) => ({ role, text, contacts: (ids || []).map((i: string) => cmap[i]).filter(Boolean).map((c: any) => ({ name: c.name, role: c.role, phone: c.phone, hash: c.hash, email: c.email })) })) };
  });
}

/* simple in-memory rate limiter */
const hits = new Map<string, number[]>();
function limit(key: string, max: number, windowMs: number) {
  const now = Date.now(); const a = (hits.get(key) || []).filter(t => now - t < windowMs); a.push(now); hits.set(key, a); return a.length > max;
}
// With trust proxy = 1, req.ip is the address seen by our immediate proxy and cannot be spoofed by the client.
const ipOf = (req: Request) => req.ip || "";
const strOk = (o: any) => Object.entries(o).every(([k, v]) => typeof v !== "string" || v.length <= (["history", "exam", "investigations", "reason", "decisionNote"].includes(k) ? 5000 : 300));

let lastPurge = 0;
async function maybePurge() {
  if (Date.now() - lastPurge < 3600e3) return; lastPurge = Date.now();
  try { const s = await db.settings(); const n = await db.purgeOlderThan(s.retentionDays); if (n) await db.audit({ action: "retention_purge", detail: `${n} referral(s) older than ${s.retentionDays} days purged` }); } catch (e) { console.error("purge failed"); }
}

type AuthReq = Request & { user?: any; token?: string };
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const wrap = (fn: (req: AuthReq, res: Response) => Promise<any>) => (req: Request, res: Response) => fn(req as AuthReq, res).catch((e) => { console.error(req.method, req.path, e?.message); res.status(500).json({ message: "Server error" }); });
  const auth = (adminOnly = false) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const t = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const u = t && await db.sessionUser(t);
      if (!u) return res.status(401).json({ message: "Session expired. Please sign in again." });
      if (u.mustChange && u.role !== "referrer" && !req.path.startsWith("/api/me")) return res.status(403).json({ message: "Password change required" });
      if (adminOnly && u.role !== "admin") return res.status(403).json({ message: "Admins only" });
      (req as AuthReq).user = u; (req as AuthReq).token = t; next();
    } catch (e) { res.status(500).json({ message: "Server error" }); }
  };
  const A = auth(), ADMIN = auth(true);
  const REF = auth();
  // The PWA's old service worker can keep serving a previous client bundle.
  // /api/* is outside its navigation cache. Refresh only the worker and its
  // caches; leave browser profile data such as localStorage untouched.
  app.get("/api/refresh-app", (_req, res) => {
    res.set("Cache-Control", "no-store").type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Updating BaraBridge</title><p>Updating BaraBridge…</p><script>
      (async () => {
        try {
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(registration => registration.unregister()));
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
          }
        } catch { /* still try a fresh page when browser cache APIs fail */ } finally {
          window.location.replace('/index.html?updated=' + Date.now() + '#/');
        }
      })();
    </script><p>If this page does not continue, <a href="/index.html#/">open BaraBridge</a>.</p></html>`);
  });
  const isReferrer = (req: AuthReq, res: Response, next: NextFunction) => {
    if (req.user?.role !== "referrer") return res.status(403).json({ message: "Referrer account required" });
    next();
  };
  const referrerWorkspace = (req: AuthReq, res: Response, next: NextFunction) => {
    if (req.user?.role !== "referrer" && req.user?.role !== "admin") return res.status(403).json({ message: "Referrer or global administrator account required" });
    next();
  };
  const MANAGER = [A, (req:AuthReq,res:Response,next:NextFunction) => {
    if(req.user.role==="admin" || (req.user.role==="unit_admin" && req.user.team)) return next();
    res.status(403).json({message:"Unit administrators only"});
  }];
  const audit = (req: AuthReq, action: string, referralId?: number | null, detail = "") => db.audit({ userId: req.user?.id, userName: req.user?.name, action, referralId, detail, ip: ipOf(req) });
  const scope = (req:AuthReq) => req.user.role==="admin" ? undefined : req.user.team;
  const findCase = async (req:AuthReq,res:Response) => {
    const r=await db.get(Number(req.params.id));
    if(!r || !canAccess(req.user,r.team)) { res.status(404).json({message:"Referral not found"}); return null; }
    return r;
  };
  const portal = async(req:AuthReq,res:Response) => {
    if(limit("portal:"+ipOf(req),300,3600e3)) { res.status(429).json({message:"Too many requests"}); return null; }
    const r=await db.portal(String(req.body?.ref||""),String(req.body?.code||"").trim());
    if(!r) { res.status(404).json({message:"Incorrect reference or follow-up code, or this referral has expired"}); return null; }
    return r;
  };

  /* ----- public ----- */
  app.get("/api/specialties", (_q, res) => res.json(rosterSpecs().map(s => ({ id: s.id, name: s.name, group: s.group }))));
  app.get("/api/privacy", wrap(async (_q, res) => { const s = await db.settings(); res.json({ responsibleParty: s.responsibleParty, infoOfficer: s.infoOfficer, infoOfficerEmail: s.infoOfficerEmail, infoOfficerPhone: s.infoOfficerPhone, retentionDays: s.retentionDays }); }));
  app.post("/api/referrals", A, wrap(async (req, res) => {
    if (req.user.role !== "referrer" && req.user.role !== "admin") return res.status(403).json({ message: "A referring clinician or global administrator account is required." });
    if (req.user.role === "referrer" && req.user.verifyStatus !== "verified") return res.status(403).json({ message: "Your account must be verified before you can send a referral. Upload your staff card in the referrer portal or contact the BaraBridge admin." });
    if (limit("ref:" + ipOf(req), 20, 3600e3)) return res.status(429).json({ message: "Too many submissions. Please phone the unit." });
    const p = referralInput.safeParse(req.body);
    if (!p.success || !strOk(p.data)) return res.status(400).json({ message: "Please complete all required fields and confirm the information notice." });
    if(p.data.lat && Math.abs(Number(p.data.lat))>90 || p.data.lon && Math.abs(Number(p.data.lon))>180) return res.status(400).json({message:"Invalid coordinates"});
    let r;
    try { r = await db.create(p.data, req.user.id); } catch(e:any) {
      if(e.message.includes("image")||e.message.includes("JPEG")) return res.status(400).json({message:e.message});
      throw e;
    }
    await audit(req, "referral_submitted", r.id, `${r.ref} from ${p.data.hospital} (${req.user.role})`);
    res.json({ ref: r.ref, followupCode:(r as any).followupCode });
    if (!p.data.lat) geocode(p.data.hospital).then(h => { const f = h.find(x => x.health); if (f) return db.update(r.id, { lat: f.lat, lon: f.lon, locSource: "Auto: " + f.name.slice(0, 150) }); }).catch(() => {});
    else db.update(r.id, { locSource: "Shared by referring doctor" }).catch(() => {});
  }));
  // Status lookup needs the reference AND the referring cellphone number; returns only coarse status.
  app.post("/api/status", wrap(async (req, res) => {
    if (limit("st:" + ipOf(req), 30, 3600e3)) return res.status(429).json({ message: "Too many requests" });
    const ref = String(req.body?.ref || "").toUpperCase().trim().slice(0, 30); const ph = String(req.body?.phone || "").replace(/\D/g, "").slice(-9);
    if (limit("stref:" + ref, 10, 3600e3)) return res.status(429).json({ message: "Too many requests" });
    const r: any = ref && ph.length === 9 ? await db.byRef(ref) : null;
    if (!r || String(r.phone || "").replace(/\D/g, "").slice(-9) !== ph) return res.status(404).json({ message: "No referral matches that reference and number" });
    res.json({ ref: r.ref, status: r.status, priority: r.priority, bedStatus: r.bedStatus, updatedAt: r.decidedAt || r.createdAt });
  }));
  app.post("/api/portal",wrap(async(req,res)=>{
    const r=await portal(req,res); if(!r) return;
    res.json({ref:r.ref,team:r.team,consultType:r.consultType,status:r.status,priority:r.priority,
      openedAt:r.openedAt,openedBy:r.openedBy,decidedBy:r.decidedBy,decidedAt:r.decidedAt,
      bedStatus:r.bedStatus,bedWard:r.bedWard,decisionNote:r.decisionNote,
      timeline:await db.timeline(r.id),images:(await db.images(r.id)).filter(im=>!im.followupId)});
  }));
  app.post("/api/portal/followup",wrap(async(req,res)=>{
    if(limit("followup:"+ipOf(req),20,3600e3)) return res.status(429).json({message:"Too many updates"});
    const p=followupInput.safeParse(req.body); if(!p.success) return res.status(400).json({message:"Enter an update and up to 3 images"});
    const r=await portal(req,res); if(!r) return;
    try { await db.append(r.id,r.doctorName,null,"update",p.data.body,p.data.images); }
    catch(e:any) { if(e.message.includes("image") || e.message.includes("JPEG")) return res.status(400).json({message:e.message}); throw e; }
    await db.audit({action:"referral_followup",referralId:r.id,detail:"Referrer submitted clinical update",ip:ipOf(req)});
    res.json({ok:true});
  }));
  app.post("/api/portal/image/:imageId",wrap(async(req,res)=>{
    const r=await portal(req,res); if(!r) return;
    const im=await db.image(Number(req.params.imageId),r.id); im ? res.json(im) : res.status(404).end();
  }));

  /* ----- auth ----- */
  app.post("/api/login", wrap(async (req, res) => {
    const ip = ipOf(req); const { username = "", password = "" } = req.body || {};
    if (limit("login:" + ip, 20, 15 * 60e3)) return res.status(429).json({ message: "Too many attempts. Try again in 15 minutes." });
    const u = await db.userByName(String(username));
    if (u && u.locked_until && new Date(u.locked_until).getTime() > Date.now()) return res.status(423).json({ message: "Account locked after failed attempts. Try again later or ask an admin." });
    if (!u || !u.active || !verifyPw(String(password), u.pass_hash)) {
      if (u) { const f = (u.failed || 0) + 1; await db.updateUser(u.id, { failed: f, locked_until: f >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null }); }
      if (String(username).trim()) await db.audit({ action: "login_failed", detail: String(username).slice(0, 60), ip });
      return res.status(401).json({ message: "Incorrect username or password" });
    }
    await db.updateUser(u.id, { failed: 0, locked_until: null, last_login: new Date().toISOString() });
    const token = await db.createSession(u.id);
    await db.audit({ userId: u.id, userName: u.name, action: "login", ip });
    res.json({ token, user: await db.sessionUser(token) });
  }));

  app.get("/api/me", A, wrap(async (req, res) => {
    res.json({ user: req.user });
  }));

  /* ----- referrer self-service (the referral PWA) ----- */
  app.post("/api/referrer/signup", wrap(async (req, res) => {
    if (limit("rsignup:" + ipOf(req), 10, 60 * 60e3)) return res.status(429).json({ message: "Too many signups. Try again later." });
    const { username = "", password = "" } = req.body || {};
    const p = referrerProfile.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Please complete your name, email, phone, hospital and profession" });
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(String(username)) || String(password).length < 10) return res.status(400).json({ message: "Choose a username (3-30 letters/numbers) and a password of 10+ characters" });
    const existing = await db.userByIdentity(String(username), p.data.email);
    if (existing) return res.status(409).json({ message: "An account already exists for that username or email" });
    const d = p.data;
    const hpcsa = d.hpcsa.replace(/\s+/g, "");
    let verifyStatus = "none";
    let autoApproved = false;
    try {
      if (hpcsa) {
        const hits = await db.hpcsaLookup(d.name, hpcsa);
        const byNum = hits.rows.find(r => r.hpcsa_number.replace(/\s+/g, "").toLowerCase() === hpcsa.toLowerCase());
        if (byNum) {
          const status = String(byNum.status).toUpperCase();
          const identityMatches = hpcsaIdentityMatches(d.name, hpcsa, byNum);
          if (identityMatches) { verifyStatus = "verified"; autoApproved = true; }
          else { verifyStatus = "card_pending"; queueSurnameForRefresh(d.name); }
          audit(req, "hpcsa_check", null, `num=${hpcsa} status=${status || "n/a"} identityMatch=${identityMatches}`);
        } else {
          verifyStatus = "card_pending";
          queueSurnameForRefresh(d.name);
          audit(req, "hpcsa_check", null, `num=${hpcsa} not found`);
        }
      } else {
        queueSurnameForRefresh(d.name);
      }
    } catch (e: any) {
      // A register query failure (timeout, etc.) must not block account creation.
      // Fall back to the staff-card path and record why.
      verifyStatus = "card_pending";
      try { await audit(req, "hpcsa_check", null, `lookup error: ${e?.message}`); } catch { /* ignore */ }
    }
    const u = await db.addReferrer({ ...d, username: String(username), password: String(password), hpcsa });
    await db.updateUser(u.id, { verify_status: verifyStatus, verified_at: verifyStatus === "verified" ? new Date().toISOString() : null });
    await db.audit({ action: "referrer_signup", detail: `${u.username}${autoApproved ? " (HPCSA auto-verified)" : ""}`, ip: ipOf(req) });
    res.json({
      ok: true,
      autoApproved,
      message: autoApproved
        ? "Verified against the HPCSA register — your account is active."
        : "Account created. Please upload a photo of your staff card. You can send referrals after verification.",
    });
  }));
  app.post("/api/referrer/profile", REF, isReferrer, wrap(async (req, res) => {
    const p = referrerProfile.partial().safeParse(req.body || {});
    if (!p.success) return res.status(400).json({ message: "Invalid profile fields" });
    const u = await db.updateReferrer(req.user.id, p.data);
    if (p.data.hpcsa !== undefined && p.data.hpcsa.replace(/\s+/g, "") && u?.verifyStatus !== "verified") {
      const hits = await db.hpcsaLookup(req.user.name, p.data.hpcsa!);
      const h = p.data.hpcsa.replace(/\s+/g, "").toLowerCase();
      const match = hits.rows.find(r => hpcsaIdentityMatches(req.user.name, h, r));
      if (match) await db.approveReferrer(req.user.id, req.user.name);
      else queueSurnameForRefresh(req.user.name);
    }
    await db.audit({ userId: req.user.id, userName: req.user.name, action: "referrer_profile_updated", ip: ipOf(req) });
    res.json({ ok: true });
  }));
  app.post("/api/referrer/card", REF, isReferrer, wrap(async (req, res) => {
    const img = imageInput.safeParse(req.body?.image);
    if (!img.success) return res.status(400).json({ message: "Please upload a JPEG, PNG or WebP photo under 2 MB" });
    await db.attachCard(req.user.id, img.data);
    await db.audit({ userId: req.user.id, userName: req.user.name, action: "referrer_card_uploaded", ip: ipOf(req) });
    res.json({ ok: true, message: "Staff card received — the owner will verify it shortly." });
  }));
  app.get("/api/referrer/profile", REF, isReferrer, wrap(async (req, res) => {
    res.json({ profile: req.user });
  }));
  app.get("/api/referrer/my-referrals", REF, referrerWorkspace, wrap(async (req, res) => {
    res.json(await db.list(undefined, req.user.role === "admin" ? undefined : req.user.id));
  }));
  const ownReferral = async (req: AuthReq, res: Response) => {
    const r = await db.get(Number(req.params.id));
    if (!r || (req.user.role !== "admin" && r.referrerId !== req.user.id)) { res.status(404).json({ message: "Referral not found" }); return null; }
    return r;
  };
  app.get("/api/referrer/referrals/:id", REF, referrerWorkspace, wrap(async (req, res) => {
    const r = await ownReferral(req, res); if (!r) return;
    await audit(req, "referrer_view_referral", r.id);
    res.json({ ...r, timeline: await db.timeline(r.id), images: (await db.images(r.id)).filter(im => !im.followupId) });
  }));
  app.get("/api/referrer/referrals/:id/images/:imageId", REF, referrerWorkspace, wrap(async (req, res) => {
    const r = await ownReferral(req, res); if (!r) return;
    const image = await db.image(Number(req.params.imageId), r.id);
    if (!image) return res.status(404).end();
    await audit(req, "referrer_view_image", r.id); res.json(image);
  }));
  app.post("/api/referrer/referrals/:id/followup", REF, referrerWorkspace, wrap(async (req, res) => {
    const r = await ownReferral(req, res); if (!r) return;
    if (r.purgedAt) return res.status(410).json({ message: "Clinical record has expired" });
    if (limit("referrer-followup:" + req.user.id, 20, 3600e3)) return res.status(429).json({ message: "Too many updates" });
    const p = followupInput.omit({ ref: true, code: true }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Enter an update and up to 3 images" });
    try { await db.append(r.id, req.user.name, req.user.id, "update", p.data.body, p.data.images); }
    catch (e: any) { if (e.message.includes("image") || e.message.includes("JPEG")) return res.status(400).json({ message: e.message }); throw e; }
    await audit(req, "referral_followup", r.id, "Referrer submitted clinical update"); res.json({ ok: true });
  }));
  app.get("/api/referrer/roster", REF, referrerWorkspace, (req: AuthReq, res) => {
    const date = String(req.query.date || saToday());
    res.json({ hospital: loadRoster()?.hospital, generated: loadRoster()?.generated, date, specs: rosterFor(date, req.query.spec ? String(req.query.spec) : undefined) });
  });

  /* ----- owner: referrer verification queue ----- */
  app.get("/api/pending-referrers", ADMIN, wrap(async (req, res) => res.json(await db.pendingReferrers())));
  app.post("/api/pending-referrers/:id/approve", ADMIN, wrap(async (req, res) => {
    const id = Number(req.params.id);
    await db.approveReferrer(id, req.user.name);
    await db.audit({ userId: req.user.id, userName: req.user.name, action: "referrer_approved", detail: `id ${id}`, ip: ipOf(req) });
    res.json({ ok: true });
  }));
  app.post("/api/pending-referrers/:id/reject", ADMIN, wrap(async (req, res) => {
    const id = Number(req.params.id);
    await db.rejectReferrer(id);
    await db.audit({ userId: req.user.id, userName: req.user.name, action: "referrer_rejected", detail: `id ${id}`, ip: ipOf(req) });
    res.json({ ok: true });
  }));
  app.get("/api/pending-referrers/:id/card", ADMIN, wrap(async (req, res) => {
    const data = await db.referrerCard(Number(req.params.id));
    if (!data) return res.status(404).json({ message: "No staff card on file" });
    res.json({ data });
  }));
  app.post("/api/me/logout", A, wrap(async (req, res) => { await db.endSession(req.token!); await audit(req, "logout"); res.json({ ok: true }); }));
  app.post("/api/me/password", A, wrap(async (req, res) => {
    const { current = "", next = "" } = req.body || {}; const u = await db.userByName(req.user.username);
    if (!verifyPw(String(current), u.pass_hash)) return res.status(400).json({ message: "Current password is incorrect" });
    if (String(next).length < 10) return res.status(400).json({ message: "New password must be at least 10 characters" });
    const { hashPw } = await import("./db"); await db.updateUser(u.id, { pass_hash: hashPw(String(next)), must_change: false });
    await audit(req, "password_changed"); res.json({ ok: true });
  }));

  /* ----- clinical (signed-in) ----- */
  app.get("/api/referrals", A, wrap(async (req, res) => { if (req.user.role === "referrer") return res.status(403).json({ message: "Use My consults in the referrer portal" }); maybePurge(); res.json(await db.list(scope(req))); }));
  app.get("/api/referrals/:id", A, wrap(async (req, res) => {
    const r=await findCase(req,res); if(!r) return;
    await db.markOpened(r.id,req.user.name);
    await audit(req, "view_referral", r.id, r.ref);
    res.json({...await db.get(r.id),timeline:await db.timeline(r.id),images:(await db.images(r.id)).filter(im=>!im.followupId)});
  }));
  app.patch("/api/referrals/:id", A, wrap(async (req, res) => {
    const p = decisionInput.safeParse(req.body); if (!p.success || !strOk(p.data)) return res.status(400).json({ message: "Bad request" });
    const cur=await findCase(req,res); if(!cur) return;
    if(cur.purgedAt) return res.status(410).json({message:"Clinical record has expired"});
    if(p.data.team && req.user.role!=="admin") return res.status(403).json({message:"Only the global admin can reroute referrals"});
    if(p.data.status==="advised" && !p.data.decisionNote?.trim()) return res.status(400).json({message:"Type the clinical advice before sending"});
    const d: any = { ...p.data }; if (d.decidedBy !== undefined) d.decidedBy = req.user.name; if (d.ack !== undefined) d.ack = req.user.name;
    if(d.status) d.decidedBy=req.user.name;
    if(d.lat!==undefined && Math.abs(Number(d.lat))>90 || d.lon!==undefined && Math.abs(Number(d.lon))>180) return res.status(400).json({message:"Invalid coordinates"});
    let r;
    if(d.status) {
      const {status,decisionNote,decidedBy,remindAt,...rest}=d;
      if(Object.keys(rest).length) await db.update(cur.id,rest);
      r=await db.respond(cur.id,status,decisionNote ?? cur.decisionNote ?? "",req.user.name,req.user.id,remindAt ?? cur.remindAt ?? null);
    } else r=await db.update(cur.id,d);
    if(!r) return res.status(404).end();
    await audit(req, "update_referral", r.id, Object.keys(d).map(k => `${k}=${k === "decisionNote" ? "(note)" : d[k]}`).join(", "));
    res.json(r);
  }));
  app.post("/api/referrals/:id/shared", A, wrap(async (req, res) => { if(!await findCase(req,res)) return; await audit(req, "shared_whatsapp", Number(req.params.id), "WhatsApp draft opened"); res.json({ ok: true }); }));
  app.get("/api/referrals/:id/images/:imageId",A,wrap(async(req,res)=>{
    const r=await findCase(req,res); if(!r) return;
    const im=await db.image(Number(req.params.imageId),r.id); if(!im) return res.status(404).end();
    await audit(req,"view_image",r.id,`Image ${im.id}`); res.json(im);
  }));
  app.post("/api/referrals/:id/portal-reset",A,wrap(async(req,res)=>{
    const r=await findCase(req,res); if(!r) return;
    if(req.user.role==="clinician") return res.status(403).json({message:"Ask your consultant to reset portal access"});
    if(r.purgedAt) return res.status(410).json({message:"Referral expired"});
    const code=await db.resetPortal(r.id); await audit(req,"portal_reset",r.id,"Follow-up code regenerated");
    res.json({code});
  }));
  app.get("/api/geocode", A, wrap(async (req, res) => { if (limit("geo:" + req.user.id, 30, 60e3)) return res.status(429).json({ message: "Too many lookups" }); res.json(await geocode(String(req.query.q || ""))); }));
  app.get("/api/doctors", A, wrap(async (req, res) => res.json(await db.doctors(scope(req)))));
  app.get("/api/roster", A, (req:AuthReq, res) => {
    if(req.user.role!=="admin") return res.status(403).json({message:"Full hospital roster available to the global administrator only"});
    const date = String(req.query.date || saToday()); res.json({ hospital: loadRoster()?.hospital, generated: loadRoster()?.generated, date, specs: rosterFor(date, req.query.spec ? String(req.query.spec) : undefined) });
  });
  app.get("/api/settings", A, wrap(async (_q, res) => res.json(await db.settings())));
  app.get("/api/team", A, wrap(async (req, res) => res.json((await db.users()).filter(u => u.active && (req.user.role==="admin" || u.team===req.user.team)).map(u => ({ id: u.id, name: u.name, role: u.role,team:u.team,phone:u.phone })))));
  app.get("/api/unit-roster",A,wrap(async(req,res)=>{
    const team=String(req.query.team || req.user.team);
    const day=String(req.query.day || saToday());
    if(!TEAMS.includes(team as Team)||!canAccess(req.user,team)||!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(403).json({message:"Unit not accessible"});
    res.json(await db.roster(team as Team,day) || {team,day,entries:[],updated_by:"",updated_at:null});
  }));
  app.get("/api/unit-members",A,wrap(async(req,res)=>{
    const team=String(req.query.team||req.user.team);
    if(!TEAMS.includes(team as Team)||!canAccess(req.user,team)) return res.status(403).json({message:"Unit not accessible"});
    res.json((await db.users()).filter(u=>u.active&&u.team===team).map(u=>({id:u.id,name:u.name,team:u.team,role:u.role,phone:u.phone})));
  }));
  app.put("/api/unit-roster",...MANAGER,wrap(async(req,res)=>{
    const p=z.object({team:z.enum(TEAMS),day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),entries:z.array(z.object({userId:z.number().int().positive(),duty:z.string().min(1).max(100)})).max(30)}).safeParse(req.body);
    if(!p.success) return res.status(400).json({message:"Enter a valid date and roster entries"});
    if(!canAccess(req.user,p.data.team)) return res.status(403).json({message:"Unit not accessible"});
    const users=await db.users();
    if(p.data.entries.some(e=>!users.some(u=>u.id===e.userId && u.active && u.team===p.data.team))) return res.status(400).json({message:"Roster members must be active members of this unit"});
    await db.saveRoster(p.data.team,p.data.day,p.data.entries,req.user.name);
    await audit(req,"roster_changed",null,`${p.data.team} ${p.data.day}`);
    res.json({ok:true});
  }));

  /* ----- admin ----- */
  app.put("/api/settings", ADMIN, wrap(async (req, res) => {
    const b = req.body || {}; const v: any = {};
    for (const k of ["p1", "p2", "p3", "repeat", "retentionDays"]) if (b[k] !== undefined) v[k] = Math.max(1, Math.min(3650, Number(b[k]) || 1));
    if (b.sound !== undefined) v.sound = !!b.sound;
    for (const k of ["responsibleParty", "infoOfficer", "infoOfficerEmail", "infoOfficerPhone"]) if (b[k] !== undefined) v[k] = String(b[k]).slice(0, 200);
    const n = await db.saveSettings(v); await audit(req, "settings_changed", null, Object.keys(v).join(", ")); res.json(n);
  }));
  app.get("/api/users", ...MANAGER, wrap(async (req, res) => res.json((await db.users()).filter(u=>canManage(req.user,u)))));
  app.post("/api/users", ...MANAGER, wrap(async (req, res) => {
    const { username, name, role = "clinician", password, team, phone="" } = req.body || {};
    if (!username || !name || String(password || "").length < 10) return res.status(400).json({ message: "Username, name and a temporary password of 10+ characters are required" });
    if(!["unit_admin","clinician"].includes(role) || !TEAMS.includes(team)) return res.status(400).json({message:"Select a unit and clinician or unit admin role"});
    if(req.user.role!=="admin" && (role!=="clinician" || team!==req.user.team)) return res.status(403).json({message:"You may add clinicians only to your own unit"});
    if (await db.userByName(username)) return res.status(400).json({ message: "Username already exists" });
    const u = await db.addUser(String(username), String(name), role, String(password), team, String(phone).slice(0,30));
    await audit(req, "user_created", null, `${u.username} (${u.role})`); res.json(u);
  }));
  app.patch("/api/users/:id", ...MANAGER, wrap(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {}; const u: any = {};
    const target=await db.userById(id); if(!target || !canManage(req.user,target)) return res.status(403).json({message:"You cannot manage this account"});
    if(target.role==="admin") return res.status(403).json({message:"Global admin account is protected"});
    if (b.active !== undefined) u.active = !!b.active;
    if (b.role !== undefined || b.team !== undefined) {
      if(req.user.role!=="admin") return res.status(403).json({message:"Only the global admin can change units or admin roles"});
      if(b.role && !["unit_admin","clinician"].includes(b.role)) return res.status(400).json({message:"Invalid role"});
      if(b.team && !TEAMS.includes(b.team)) return res.status(400).json({message:"Invalid unit"});
      if(b.role) u.role=b.role; if(b.team) u.team=b.team;
    }
    if(b.phone!==undefined) u.phone=String(b.phone).slice(0,30);
    if (b.password) { if (String(b.password).length < 10) return res.status(400).json({ message: "Temporary password must be 10+ characters" }); const { hashPw } = await import("./db"); u.pass_hash = hashPw(String(b.password)); u.must_change = true; u.failed = 0; u.locked_until = null; }
    if (id === req.user.id && (u.active === false || u.role === "clinician")) return res.status(400).json({ message: "You cannot deactivate or demote yourself" });
    await db.updateUser(id, u); if (u.active === false || u.pass_hash || u.team || u.role) await db.endUserSessions(id);
    await audit(req, "user_updated", null, `id ${id}: ${Object.keys(u).filter(k => k !== "pass_hash").concat(u.pass_hash ? ["password reset"] : []).join(", ")}`); res.json({ ok: true });
  }));
  app.get("/api/audit", ADMIN, wrap(async (req, res) => res.json(await db.auditList({ referralId: req.query.referral ? Number(req.query.referral) : undefined, limit: 500 }))));
  app.get("/api/referrals/:id/export", ADMIN, wrap(async (req, res) => { const r = await db.get(Number(req.params.id)); if (!r) return res.status(404).end(); const log = await db.auditList({ referralId: r.id }); const timeline=await db.timeline(r.id); const images=await db.images(r.id); await audit(req, "export_referral", r.id, r.ref); res.json({ referral: r, timeline, images, accessLog: log }); }));
  app.delete("/api/referrals/:id", ADMIN, wrap(async (req, res) => { const id = Number(req.params.id); const r = await db.get(id); if (!r) return res.status(404).end(); await db.remove(id); await audit(req, "delete_referral", id, `${r.ref} deleted`); res.json({ ok: true }); }));
  app.post("/api/purge", ADMIN, wrap(async (req, res) => { const s = await db.settings(); const n = await db.purgeOlderThan(s.retentionDays); await audit(req, "retention_purge_manual", null, `${n} purged`); res.json({ purged: n }); }));
  return httpServer;
}
