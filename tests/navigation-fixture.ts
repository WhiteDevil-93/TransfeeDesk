// Local browser acceptance fixture: no Supabase, patient data or external writes.
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
process.env.APP_DB_SECRET = "navigation-fixture-secret-with-at-least-thirty-two-characters";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "navigation-fixture-key";
const { db, defaults, hashPw } = await import("../server/db");
const { registerRoutes } = await import("../server/routes");
const users: any[] = [
  { id: 1, username: "staff", name: "QA Receiving Staff", role: "clinician", team: "MEU" },
  { id: 2, username: "admin", name: "QA Administrator", role: "admin", team: null },
  { id: 3, username: "referrer", name: "QA Referrer", role: "referrer", team: null, verify_status: "verified" },
  { id: 4, username: "pending", name: "QA Pending Referrer", role: "referrer", team: null, verify_status: "card_pending" },
  { id: 5, username: "temporary", name: "QA First Login", role: "clinician", team: "TEU", must_change: true },
  { id: 6, username: "unit_meu", name: "QA MEU Unit Admin", role: "unit_admin", team: "MEU" },
  { id: 7, username: "unit_teu", name: "QA TEU Unit Admin", role: "unit_admin", team: "TEU" },
].map(u => ({ active: true, must_change: false, phone: "0700000000", specialty: "Emergency Medicine", profession: "doctor", pass_hash: hashPw("navigation-test-password"), ...u }));
const safe = (u: any) => ({ id: u.id, username: u.username, name: u.name, role: u.role, team: u.team, phone: u.phone, active: u.active, mustChange: u.must_change, specialty: u.specialty, profession: u.profession, verifyStatus: u.verify_status || "none", hasCard: !!u.card_cipher });
const baseUserCount = users.length;
const tokens = new Map<string, number>();
const records: any[] = [];
const updates: any[] = [];
const state = db as any;
state.userByName = async (name: string) => users.find(u => u.username === name);
state.createSession = async (id: number) => { const token = `fixture-${id}`; tokens.set(token, id); return token; };
state.sessionUser = async (token: string) => { const u = users.find(u => u.id === tokens.get(token)); return u ? safe(u) : null; };
state.endSession = async (token: string) => { tokens.delete(token); };
state.updateUser = async (id: number, patch: any) => { Object.assign(users.find(u => u.id === id), patch); };
state.settings = async () => ({ ...defaults, sound: false });
state.audit = async () => {};
state.auditList = async () => [];
state.purgeOlderThan = async () => 0;
state.users = async () => users.map(safe);
state.pendingReferrers = async () => [];
state.attachCard = async (id: number) => { const u = users.find(u => u.id === id); u.card_cipher = "fixture-card"; u.verify_status = "card_pending"; };
state.list = async (team?: string, referrerId?: number) => records.filter(r => (team === undefined || r.team === team) && (referrerId === undefined || r.referrerId === referrerId));
state.get = async (id: number) => records.find(r => r.id === id) || null;
state.create = async (body: any, referrerId: number) => {
  const r = { ...body, id: records.length + 11, ref: `QA-${records.length + 11}`, referrerId, createdAt: new Date().toISOString(), priority: body.suggestedPriority, status: "pending", decisionNote: "", decidedAt: null, ackAt: null, bedStatus: "Not assigned", followupCode: "qa-private-code" };
  records.push(r); return r;
};
state.update = async (id: number, patch: any) => { const r = records.find(r => r.id === id); if (patch.ack && !r.ackAt) Object.assign(r, { ackAt: new Date().toISOString(), ackBy: patch.ack }); const { ack, ...rest } = patch; Object.assign(r, rest); return r; };
state.timeline = async (id: number) => updates.filter(u => u.referralId === id);
state.images = async () => [];
state.append = async (id: number, author: string, _userId: number, kind: string, body: string) => { updates.push({ id: updates.length + 1, referralId: id, author, kind, body, createdAt: new Date().toISOString(), images: [] }); };
state.markOpened = async (id: number, name: string) => { const r = records.find(r => r.id === id); r.openedAt ||= new Date().toISOString(); r.openedBy ||= name; };
state.respond = async (id: number, status: string, decisionNote: string, name: string) => {
  const r = records.find(r => r.id === id); Object.assign(r, { status, decisionNote, decidedBy: name, decidedAt: new Date().toISOString() });
  updates.push({ id: updates.length + 1, referralId: id, author: name, kind: status === "advised" ? "advice" : "decision", body: decisionNote, createdAt: new Date().toISOString(), images: [] }); return r;
};
const app = express(); app.use(express.json());
app.use((req, _res, next) => { if (req.method === "POST" && req.path === "/api/referrals") { req.body.lat = "-26.1"; req.body.lon = "27.9"; } next(); });
app.get("/api/health", (_req, res) => res.json({ status: "ready", fixture: true }));
app.get(["/api/roster", "/api/referrer/roster"], (_req, res) => res.json({ specs: [], hospital: "QA Hospital", generated: "fixture" }));
app.get("/api/unit-members", (_req, res) => res.json([]));
app.get("/api/unit-roster", (_req, res) => res.json({ entries: [] }));
app.post("/api/fixture/expire", (_req, res) => { tokens.clear(); res.json({ ok: true }); });
app.post("/api/fixture/reset", (_req, res) => { tokens.clear(); records.length = 0; updates.length = 0; users.splice(baseUserCount); for (const u of users) { u.pass_hash = hashPw("navigation-test-password"); u.must_change = u.username === "temporary"; u.card_cipher = null; } res.json({ ok: true }); });
app.post("/api/referrer/signup", (req, res) => { users.push({ ...users[3], ...req.body, role: "referrer", id: users.length + 1, card_cipher: null, pass_hash: hashPw(req.body.password) }); res.json({ autoApproved: false, message: "Upload your staff card before sending." }); });
const server = createServer(app); await registerRoutes(server, app);
app.use("/api", (_req, res) => res.status(404).json({ message: "Unhandled fixture endpoint" }));
app.use(express.static(path.resolve("dist/public")));
app.use((_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
server.listen(5188, "127.0.0.1", () => console.log("navigation fixture ready on 5188"));
