import { cloneElement, isValidElement, useId, useState, useMemo, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, ChevronRight, Eye, EyeOff, Check, X, Clock, Copy, MessageCircle, Phone, Users, Inbox, Stethoscope, LogOut, Trash2, Search, Bell, BellRing, MapPin, CalendarDays, Siren, BedDouble, AlarmClock, Settings, ExternalLink, Send, ShieldCheck, KeyRound } from "lucide-react";
import { unlockAudio, sounds, notify, askNotify, canNotify, defaultSettings, type AlertSettings } from "./alerts";
import type { Referral, Doctor, Status, RosterSpec, RosterContact, User, AuditRow, AppSettings, Followup } from "@shared/schema";
import { Admin } from "./admin";
import { Portal } from "./portal";
import { AuthProvider, useAuth, workspaceFor } from "./auth";
import { TEAMS, TEAM_NAMES } from "@shared/teams";
import { AccountNotice, AudienceSwitch, BackHome, PriorityPill } from "./components/clinical-ui";
import "./clinical.css";
import { TeamSelect, ReferrerPortal, Timeline, Images, UnitRoster, messageOf } from "./workflows";
type Me = User;

const Logo = () => (
  <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-label="BaraBridge logo">
    <rect x="2" y="2" width="28" height="28" rx="8" stroke="currentColor" strokeWidth="2.5" />
    <path d="M9 13h11m0 0-3.5-3.5M20 13l-3.5 3.5M23 19H12m0 0 3.5-3.5M12 19l3.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const pColor: Record<string,string> = { P1: "bg-red-600 text-white", P2: "bg-amber-500 text-black", P3: "bg-emerald-600 text-white" };
const sLabel: Record<Status,string> = { pending: "New", accepted: "Accepted for transfer", declined: "Declined", waiting: "Waiting", advised:"Advice sent" };
const sColor: Record<Status,string> = { pending: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100", accepted: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100", declined: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200", waiting: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100", advised:"bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100" };
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m/60)} h ago` : new Date(iso).toLocaleDateString(); };
const waNum = (p: string) => { const d = p.replace(/\D/g, ""); return d.startsWith("0") ? "27" + d.slice(1) : d; };
const catchUrl = (lat: string, lon: string) => `https://catchments.medricsoftware.co.za/?lat=${lat}&lon=${lon}`;
const BEDSTAT = ["Not assigned", "Bed requested", "Bed allocated", "Patient en route", "Arrived"];
const mins = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60000;
function isOverdue(r: Referral, st: AlertSettings) {
  if (r.status === "pending") return mins(r.createdAt) > (r.priority === "P1" ? st.p1 : r.priority === "P2" ? st.p2 : st.p3);
  if (r.status === "waiting" && r.remindAt) return new Date(r.remindAt).getTime() <= Date.now();
  return false;
}
const useSpecs = () => useQuery<{ id: string; name: string; group: string }[]>({ queryKey: ["/api/specialties"] });
const specName = (specs: any[] | undefined, id: string) => specs?.find(s => s.id === id)?.name || id || "Unspecified";
const referLink = (team?:string) => window.location.href.split("#")[0] + "#/refer" + (team?`/${team}`:"");

function Field({ label, children, hint }: any) { const id = useId(); return <div className="space-y-1.5"><Label htmlFor={id} className="text-sm font-medium">{label}</Label>{isValidElement(children) ? cloneElement(children as any, { id }) : children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>; }

function StatusPage({ params }: any) {
  const [ref, setRef] = useState(params?.ref || ""); const [phone, setPhone] = useState(""); const [data, setData] = useState<any>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async (e: any) => { e.preventDefault(); setErr(""); setData(null); setBusy(true);
    try { setData(await (await apiRequest("POST", "/api/status", { ref: ref.trim(), phone })).json()); } catch (x: any) { setErr(String(x.message).startsWith("429") ? "Too many attempts. Please try later or phone the unit." : "No referral matches that reference and cellphone number."); } finally { setBusy(false); } };
  return <Shell public><div className="max-w-md mx-auto space-y-4"><h1 className="text-xl font-semibold">Referral status</h1>
    <p className="text-sm text-muted-foreground">Enter your reference number and the cellphone number you used on the referral.</p>
    <form className="space-y-2" onSubmit={go}><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="TX-XXXXXXX" required data-testid="input-status-ref" /><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your cellphone number" required data-testid="input-status-phone" /><Button className="w-full" disabled={busy}>Check status</Button></form>
    {err && <p className="text-sm text-destructive">{err}</p>}
    {data && <Card className="p-5 space-y-2"><div className="flex gap-2 items-center"><span className="font-mono font-bold">{data.ref}</span><Badge className={sColor[data.status as Status]}>{sLabel[data.status as Status]}</Badge><span className={`rounded px-2 py-0.5 text-xs font-bold ${pColor[data.priority]}`}>{data.priority}</span></div>
      {data.bedStatus && data.bedStatus !== "Not assigned" && <p className="text-sm"><BedDouble className="inline h-4 w-4 mr-1" />{data.bedStatus}</p>}<p className="text-xs text-muted-foreground">Updated {ago(data.updatedAt)}. Details of the decision are sent to you on WhatsApp.</p></Card>}
  </div></Shell>;
}

/* ---------- SHELL / AUTH ---------- */
function Shell({ children, public: pub, me, onLogout, alertCount, onSettings, admin }: any) {
  const [loc] = useLocation();
  const { user } = useAuth();
  const nav = [["/queue", "Queue", Inbox], ["/oncall", "On call", CalendarDays], ["/catchments", "Catchments", MapPin], ["/doctors", "Doctors", Stethoscope], ...(admin ? [["/admin", user?.role === "admin" ? "Admin" : "Unit admin", ShieldCheck]] : []), ...(user?.role === "admin" ? [["/refer", "Refer", Send]] : [])] as const;
  return <div className={`min-h-screen bg-background ${pub ? (user?.role === "referrer" || user?.role === "admin") && (loc === "/portal" || loc.startsWith("/refer")) ? "bb-referrer-shell" : "" : "bb-staff-shell"}`}><header className={`border-b sticky top-0 z-30 ${pub ? "bb-public-header" : "bb-staff-header"}`}><div className="max-w-6xl mx-auto px-4 py-3 min-h-14 flex flex-wrap items-center gap-2">
    <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="BaraBridge home"><span className="text-primary"><Logo /></span><span>BaraBridge</span></Link>
    {!pub && <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold">{user?.role === "admin" ? "Admin" : user?.team || "No unit"}</span>}
    {pub && <nav aria-label="Account navigation" className="bb-public-nav ml-auto flex flex-wrap gap-x-4 text-sm"><Link href="/">Home</Link><Link href={user && user.role !== "referrer" ? "/queue" : "/login"}>{user && user.role !== "referrer" ? "Referral desk" : "Staff sign-in"}</Link><Link href="/portal">{user?.role === "referrer" ? "My consults" : "Referrer portal"}</Link></nav>}
    {!pub && <nav aria-label="Staff navigation" className="bb-staff-nav">{(nav as unknown as any[]).map(([h,l,I]: any) => <Link key={h} href={h} aria-current={loc===h?"page":undefined} data-testid={`link-${l}`}><I className="h-4 w-4" />{l}</Link>)}</nav>}
    {!pub && <div className="bb-staff-actions ml-auto flex items-center gap-1 text-sm">
      <Button size="icon" variant="ghost" onClick={onSettings} aria-label="Alert settings" className="relative" data-testid="button-alerts">{alertCount ? <BellRing className="h-4 w-4 text-red-600" /> : <Bell className="h-4 w-4" />}{alertCount ? <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] rounded-full h-4 min-w-4 px-1 grid place-items-center">{alertCount}</span> : null}</Button>
      <span className="font-medium hidden sm:inline">{me}</span><Button size="icon" variant="ghost" onClick={onLogout} aria-label="Log out"><LogOut className="h-4 w-4" /></Button></div>}
  </div></header><main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
  <footer className="bb-public-footer max-w-6xl mx-auto px-4 pb-6 text-sm text-muted-foreground"><nav aria-label="Help and referral navigation" className="flex flex-wrap gap-x-4"><Link href="/" className="underline">Home</Link><Link href="/followup" className="underline">Follow up a referral</Link><Link href="/status" className="underline">Check referral status</Link><Link href="/privacy" className="underline">Privacy notice (POPIA)</Link></nav></footer></div>;
}

function Login() {
  const { signIn, expired } = useAuth();
  const [username, setU] = useState(""); const [password, setP] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const go = async (e: any) => { e.preventDefault(); unlockAudio(); setBusy(true); setErr("");
    try { const r = await (await apiRequest("POST", "/api/login", { username, password }, { signal: AbortSignal.timeout(20000) })).json(); signIn(r); if (r.user.role !== "referrer") askNotify(); }
    catch (x: any) { setErr(String(x.message || "").replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1") || "Sign-in failed"); } finally { setBusy(false); } };
  return <Shell public><div className="max-w-md mx-auto space-y-4 pb-4"><BackHome/><Card className="p-6 sm:p-8 space-y-6"><div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wider text-primary">Clinical workspace</p><h1 className="text-2xl font-bold tracking-tight">Receiving staff sign-in</h1><p className="text-sm leading-relaxed text-muted-foreground">Review referrals and coordinate care for your unit.</p></div><AudienceSwitch audience="staff"/>
    {expired && <p role="status" className="text-sm text-muted-foreground">Your session ended. Sign in again to continue.</p>}
    <form className="space-y-5" onSubmit={go}><Field label="Username"><Input autoComplete="username" placeholder="Your staff username" value={username} onChange={(e) => setU(e.target.value)} required data-testid="input-username" /></Field>
    <Field label="Password"><div className="relative"><Input aria-label="Password" type={showPassword ? "text" : "password"} autoComplete="current-password" className="pr-12" value={password} onChange={(e) => setP(e.target.value)} required data-testid="input-password"/><button type="button" className="absolute right-0 top-0 grid h-12 w-12 place-items-center text-muted-foreground" onClick={() => setShowPassword(x => !x)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div></Field>
    {err && <p role="alert" className="text-sm text-destructive">{err}</p>}<Button className="w-full" disabled={busy} data-testid="button-login">{busy ? "Signing in..." : "Sign in"}</Button></form>
    <details className="rounded-lg border bg-muted/40 p-3 text-sm"><summary className="cursor-pointer font-medium">Need an account or password reset?</summary><p className="pt-3 leading-relaxed text-muted-foreground">MEU, TEU and SEU staff accounts are created by your unit administrator. Ask them for an account or a password reset.</p></details>
    <AccountNotice>Every case you open or change is recorded. Sessions end after 30 minutes of inactivity.</AccountNotice>
    <p className="text-sm">Sending a patient referral? <Link href="/portal" className="underline font-medium">Referrer sign-up / sign-in</Link></p></Card></div></Shell>;
}

/* ---------- LANDING (public entry) ---------- */
function Landing() {
  const { user } = useAuth();
  return <Shell public><div className="max-w-3xl mx-auto py-5 sm:py-12 w-full space-y-7">
      <div className="text-center space-y-3"><p className="text-xs font-semibold uppercase tracking-widest text-primary">Hospital referrals</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Welcome to BaraBridge</h1><p className="max-w-md mx-auto text-base leading-relaxed text-muted-foreground">One place to send referrals, review consults and coordinate transfers.</p></div>
      {user && <Card className="p-5 border-primary/25 bg-accent space-y-2"><p className="text-sm">Signed in as <strong>{user.name}</strong></p><Link href={workspaceFor(user)} className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary">{user.role === "referrer" ? "Continue to my consults" : "Continue to referral desk"}<ArrowRight className="h-4 w-4"/></Link></Card>}
      <div className="grid sm:grid-cols-2 gap-4">
        <Link href="/portal" className="bb-role-card"><span className="bb-role-icon"><Stethoscope className="h-6 w-6"/></span><div className="flex-1 space-y-2"><h2 className="text-xl font-bold">Send a referral</h2><p className="text-sm leading-relaxed text-muted-foreground">For doctors, nurses and clinicians referring to MEU, TEU or SEU.</p><p className="text-sm font-semibold text-primary">Sign in or create an account</p></div><ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground mt-1"/></Link>
        <Link href="/login" className="bb-role-card"><span className="bb-role-icon bg-secondary text-secondary-foreground"><Inbox className="h-6 w-6"/></span><div className="flex-1 space-y-2"><h2 className="text-xl font-bold">Receiving teams</h2><p className="text-sm leading-relaxed text-muted-foreground">Review incoming consults, send advice and manage transfers for your unit.</p><p className="text-sm font-semibold text-primary">Staff sign-in</p></div><ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground mt-1"/></Link>
      </div>
      <div className="border-t pt-6 space-y-5"><Link href="/followup" className="flex min-h-16 items-center gap-3 rounded-xl border bg-card p-4 font-medium"><Search className="h-5 w-5 text-muted-foreground"/><span className="flex-1">Follow up an existing case<span className="block text-xs font-normal text-muted-foreground mt-1">Use your reference and private follow-up code</span></span><ArrowRight className="h-4 w-4 text-primary"/></Link><AccountNotice>Share only the information needed for care. Use patient initials and keep referral codes private.</AccountNotice></div>
    </div></Shell>;
}

function ChangePassword({ me, onDone }: { me: Me; onDone: () => Promise<void> }) {
  const [cur, setCur] = useState(""); const [n1, setN1] = useState(""); const [n2, setN2] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async (e: any) => { e.preventDefault(); setErr(""); if (n1 !== n2) return setErr("New passwords do not match"); if (n1.length < 10) return setErr("Use at least 10 characters");
    let changed = false; setBusy(true);
    try { await apiRequest("POST", "/api/me/password", { current: cur, next: n1 }); changed = true; await onDone(); } catch (x: any) { setErr(changed ? "Your password was saved. Sign out and sign in with your new password to continue." : String(x.message).includes("incorrect") ? "Current password is incorrect" : "Could not change password. Try again."); } finally { setBusy(false); } };
  return <div className="max-w-sm mx-auto py-6"><Card className="p-6 space-y-4"><div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /><h1 className="font-semibold">Set your own password</h1></div>
    <p className="text-sm text-muted-foreground">Hi {me.name}. Your account has a temporary password. Choose a new one (10+ characters) that only you know.</p>
    <form className="space-y-3" onSubmit={go}><Field label="Temporary password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required data-testid="input-current" /></Field>
    <Field label="New password"><Input type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} required data-testid="input-new" /></Field>
    <Field label="Repeat new password"><Input type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} required data-testid="input-new2" /></Field>
    {err && <p role="alert" className="text-sm text-destructive">{err}</p>}<Button className="w-full" disabled={busy} data-testid="button-setpw">{busy ? "Saving..." : "Save password"}</Button></form></Card></div>;
}

function Privacy() {
  const { data: p } = useQuery<any>({ queryKey: ["/api/privacy"] });
  return <Shell public><article className="max-w-2xl mx-auto space-y-4 text-sm leading-relaxed">
    <h1 className="text-xl font-semibold">Privacy notice</h1>
    <p className="text-muted-foreground">Protection of Personal Information Act 4 of 2013 (POPIA), section 18 notification.</p>
    <h2 className="font-semibold text-base">Who is responsible</h2><p>{p?.responsibleParty || "The receiving hospital"} is the responsible party for referrals sent through BaraBridge.
      Information Officer: {p?.infoOfficer || "to be confirmed"}{p?.infoOfficerEmail && <>, <a className="underline" href={`mailto:${p.infoOfficerEmail}`}>{p.infoOfficerEmail}</a></>}{p?.infoOfficerPhone && <>, {p.infoOfficerPhone}</>}.</p>
    <h2 className="font-semibold text-base">What we collect and why</h2><p>The referring clinician's name, facility and contact details, and the minimum clinical information about the patient needed to decide on and arrange a transfer or consultation: initials, age, sex, folder number (optional), diagnosis, history, examination, investigations and the facility's location (optional). Patient names and ID numbers are not collected. Health information is processed by healthcare professionals for the patient's proper treatment and care (POPIA section 32(1)(a)).</p>
    <h2 className="font-semibold text-base">Who can see it</h2><p>The global administrator has access across MEU, TEU and SEU. Clinicians and consultants can access only referrals for their assigned unit. The referring doctor can access the response history and images using the reference and private follow-up code; anyone given that code has access to that referral, so keep it private. Case access, responses and WhatsApp draft openings are logged. A WhatsApp draft opening is not proof of delivery.</p>
    <h2 className="font-semibold text-base">Images, updates and notifications</h2><p>Clinical images and follow-up updates are stored with the referral. Images are additionally encrypted before storage. Remove patient names, IDs and faces before uploading. Image previews are resized and should not replace original diagnostic studies. First opening is recorded in the secure portal; browser notifications work while the portal is open, and an opened receipt does not indicate acceptance for transfer.</p>
    <h2 className="font-semibold text-base">How it is protected</h2><p>Encrypted connections (HTTPS), an encrypted database, individual passwords stored as one-way hashes, automatic sign-out after 30 minutes of inactivity, account lock-out after repeated failed sign-ins, and an audit log that can only be added to, never changed.</p>
    <h2 className="font-semibold text-base">How long it is kept</h2><p>BaraBridge is a communication tool, not the medical record; the clinical record stays in the patient's hospital folder. Clinical details are automatically deleted {p?.retentionDays || 90} days after a referral is submitted. A minimal non-clinical record (reference number, facilities, dates, outcome) is kept for audit.</p>
    <h2 className="font-semibold text-base">Where it is stored</h2><p>The database is hosted in Frankfurt, Germany. The hospital must approve the applicable cross-border transfer basis, operator agreements, retention policy and hosting before real patient data is used. Technical safeguards alone are not certification of POPIA compliance.</p>
    <h2 className="font-semibold text-base">Your rights</h2><p>Patients and referring clinicians may ask to see, correct or delete their information, object to processing, or complain to the Information Officer above, or to the Information Regulator (South Africa): <a className="underline" href="https://inforegulator.org.za" target="_blank" rel="noreferrer">inforegulator.org.za</a>, complaints.IR@inforegulator.org.za.</p>
  </article></Shell>;
}

/* ---------- ALERT ENGINE ---------- */
function useAlerts(me: string, st: AlertSettings) {
  const { data = [], isLoading, error, refetch } = useQuery<Referral[]>({ queryKey: ["/api/referrals"], refetchInterval: 10000 });
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 15000); return () => clearInterval(t); }, []);
  const seen = useRef<Set<number> | null>(null); const lastRem = useRef<Record<number, number>>({}); const lastAlarm = useRef(0);
  const followupNotified=useRef<Record<number,string>>({});
  const p1 = data.filter(r => r.priority === "P1" && r.status === "pending" && !r.ackAt);
  const due = data.filter(r => isOverdue(r, st));
  useEffect(() => {
    if (!data.length && seen.current === null) return;
    if (seen.current === null) { seen.current = new Set(data.map(r => r.id)); }
    else for (const r of data) if (!seen.current.has(r.id)) { seen.current.add(r.id);
      if (r.priority !== "P1") { if (st.sound) sounds.chime(); notify(`New ${r.priority} referral`, `${r.ref} · ${r.team}`, "new-" + r.id); }
      else notify("P1 REFERRAL – action now", `${r.ref} · ${r.team}`, "p1-" + r.id, true); }
    for(const r of data) if(r.latestFollowupAt && (!r.followupSeenAt || r.latestFollowupAt>r.followupSeenAt) && followupNotified.current[r.id]!==r.latestFollowupAt) {
      followupNotified.current[r.id]=r.latestFollowupAt; if(st.sound)sounds.chime();notify("New referral follow-up",`${r.ref} · ${r.team}`,"followup-"+r.id);
    }
    const now = Date.now();
    if (p1.length && now - lastAlarm.current > 20000) { lastAlarm.current = now; if (st.sound) sounds.alarm(); }
    let rem = false;
    for (const r of due) if (!(r.priority === "P1" && !r.ackAt) && now - (lastRem.current[r.id] || 0) > st.repeat * 60000) { lastRem.current[r.id] = now; rem = true;
      notify(r.status === "waiting" ? "Waiting-list reminder" : `Overdue ${r.priority} consult`, `${r.ref} · ${r.team} · ${ago(r.createdAt)}`, "rem-" + r.id); }
    if (rem && st.sound) sounds.reminder();
  }, [data, tick, st]);
  return { p1, due, data, isLoading, error, refetch };
}

function P1Alarm({ list, me, onOpen }: { list: Referral[]; me: string; onOpen: (r: Referral) => void }) {
  const ack = useMutation({ mutationFn: async (id: number) => apiRequest("PATCH", `/api/referrals/${id}`, { ack: me }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/referrals"] }) });
  if (!list.length) return null;
  return <div className="fixed inset-0 z-50 bg-red-950/70 grid place-items-center p-4" role="alertdialog" aria-label="P1 referral alert">
    <Card className="w-full max-w-lg p-6 space-y-4 border-red-600 border-2 animate-in zoom-in-95">
      <div className="flex items-center gap-3 text-red-600"><Siren className="h-8 w-8 animate-pulse" /><div><p className="text-lg font-bold">P1 referral{list.length > 1 ? `s (${list.length})` : ""}</p><p className="text-sm text-muted-foreground">Needs immediate review. Alarm repeats until someone acknowledges.</p></div></div>
      {list.map(r => <div key={r.id} className="rounded-md border p-3 space-y-2"><p className="font-semibold">{r.diagnosis} <span className="font-normal text-muted-foreground">{r.patientInitials}, {r.age}{r.sex}</span></p>
        <p className="text-sm text-muted-foreground">Dr {r.doctorName.replace(/^dr\.?\s*/i,"")} · {r.hospital} · {ago(r.createdAt)}</p>
        <div className="flex gap-2"><Button className="bg-red-600 hover:bg-red-700 text-white flex-1" onClick={() => { ack.mutate(r.id); onOpen(r); }} data-testid={`button-ack-${r.id}`}>Acknowledge and open</Button>
        <a href={`tel:${r.phone}`}><Button variant="outline"><Phone className="h-4 w-4 mr-1" />Call</Button></a></div></div>)}
    </Card></div>;
}

function SettingsSheet({ open, onClose, st, setSt, due, onOpen, admin }: any) {
  const set = (k: keyof AlertSettings) => (e: any) => { const v = { ...st, [k]: k === "sound" ? !st.sound : Math.max(1, Number(e.target.value) || 1) }; if (k !== "sound" && !admin) return; setSt(v); if (admin) apiRequest("PUT", "/api/settings", v).catch(() => {}); };
  const perm = canNotify() ? Notification.permission : "unsupported";
  return <Sheet open={open} onOpenChange={(o) => !o && onClose()}><SheetContent className="w-full sm:max-w-md overflow-y-auto"><SheetHeader><SheetTitle>Alerts and reminders</SheetTitle></SheetHeader>
    <div className="space-y-5 mt-4">
      <div className="space-y-2"><p className="text-sm font-semibold">Needs attention ({due.length})</p>
        {due.length === 0 ? <p className="text-sm text-muted-foreground">Nothing overdue.</p> : due.map((r: Referral) => <button key={r.id} onClick={() => { onClose(); onOpen(r); }} className="w-full text-left rounded-md border p-2 hover-elevate flex gap-2 items-center"><span className={`rounded px-1.5 py-0.5 text-xs font-bold ${pColor[r.priority]}`}>{r.priority}</span><span className="text-sm flex-1 truncate">{r.diagnosis} · {r.hospital}</span><span className="text-xs text-muted-foreground">{r.status === "waiting" ? "reminder" : ago(r.createdAt)}</span></button>)}</div>
      <div className="space-y-3 border-t pt-4"><p className="text-xs text-muted-foreground">These thresholds are shared by the whole team{admin ? "" : " and can be changed by an admin"}.</p><p className="text-sm font-semibold">Remind me if a new consult is not actioned within (minutes)</p>
        <div className="grid grid-cols-3 gap-2">{(["p1","p2","p3"] as const).map(k => <Field key={k} label={k.toUpperCase()}><Input type="number" min={1} value={st[k]} onChange={set(k)} disabled={!admin} /></Field>)}</div>
        <Field label="Repeat reminders every (minutes)"><Input type="number" min={1} value={st.repeat} onChange={set("repeat")} disabled={!admin} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={st.sound} onChange={set("sound")} /> Play sounds</label>
        <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { unlockAudio(); sounds.alarm(); }}>Test P1 alarm</Button><Button size="sm" variant="outline" onClick={() => { unlockAudio(); sounds.reminder(); }}>Test reminder</Button></div>
        <p className="text-xs text-muted-foreground">Browser notifications: {perm}. {perm !== "granted" && perm !== "unsupported" && <button className="underline" onClick={() => askNotify()}>Enable</button>} Alerts work while this dashboard is open on a phone or computer; keep one device signed in on the on-call desk.</p>
      </div></div></SheetContent></Sheet>;
}

/* ---------- QUEUE ---------- */
const order = { pending: 0, waiting: 1, accepted: 2, advised:2, declined: 3 }; const pr = { P1: 0, P2: 1, P3: 2 };
function Queue({ me, data, st, onOpen, user }: { me: string; data: Referral[]; st: AlertSettings; onOpen: (r: Referral) => void; user:Me }) {
  const isLoading = false; const { data: specs } = useSpecs();
  const [tab, setTab] = useState("open"); const [q, setQ] = useState(""); const [sp, setSp] = useState("all"); const [unit,setUnit]=useState(user.team||"all"); const { toast } = useToast();
  const hasUpdate=(r:Referral)=>!!r.latestFollowupAt && (!r.followupSeenAt || r.latestFollowupAt>r.followupSeenAt);
  const list = useMemo(() => data.filter(r=>unit==="all"||r.team===unit).filter(r => tab==="all" || (tab==="open" ? ["pending","waiting"].includes(r.status)||hasUpdate(r) : r.status===tab))
    .filter(r => sp === "all" || r.specialty === sp)
    .filter(r => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
    .sort((a,b) => pr[a.priority]-pr[b.priority] || Number(hasUpdate(b))-Number(hasUpdate(a)) || order[a.status]-order[b.status] || a.createdAt.localeCompare(b.createdAt)), [data, tab, q, sp,unit]);
  const scoped = data.filter(r => unit === "all" || r.team === unit);
  const count = (s: string) => scoped.filter(r => r.status===s).length;
  const overdue = scoped.filter(r => isOverdue(r, st));
  const link=referLink(unit==="all"?undefined:unit);
  const shareMsg = `Hi, please submit your ${unit==="all"?"":unit+" "}referral here: ${link}`;
  const usedSpecs = Array.from(new Set(data.map(r => r.specialty).filter(Boolean)));
  return <div className="space-y-5">
    <div className="flex gap-3 flex-wrap items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Receiving workspace</p><h1 className="text-2xl font-bold tracking-tight">{user.role==="admin"?"All-unit referral desk":`${user.team||"Unassigned"} referral desk`}</h1></div>{user.role==="admin" && <div className="w-64"><TeamSelect value={unit} onChange={setUnit} all/></div>}</div>
    {user.role!=="admin" && !user.team && <Card className="p-4 text-sm border-amber-500">No unit assigned. Ask the global administrator to assign your account to MEU, TEU or SEU.</Card>}
    {overdue.length > 0 && <Card className="p-3 border-amber-500 bg-amber-50 dark:bg-amber-950 flex items-center gap-3"><AlarmClock className="h-5 w-5 text-amber-600 shrink-0" /><p className="text-sm flex-1"><b>{overdue.length}</b> consult{overdue.length > 1 ? "s need" : " needs"} attention: {overdue.slice(0, 3).map(r => `${r.priority} ${r.diagnosis}`).join(", ")}{overdue.length > 3 ? "..." : ""}</p><Button size="sm" variant="outline" onClick={() => onOpen(overdue[0])}>Review</Button></Card>}
    <div className="bb-status-strip">{[["New","pending"],["Waiting","waiting"],["Accepted","accepted"],["Declined","declined"]].map(([label,status]) => <span key={status}><strong data-testid={`stat-${status}`}>{count(status)}</strong>{label}</span>)}<span className={overdue.length ? "text-amber-800" : "text-muted-foreground"}><strong data-testid="stat-overdue">{overdue.length}</strong>Overdue</span></div>
    <div className="space-y-3"><div role="group" aria-label="Filter referral status" className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1">{[["open","Open"],["waiting","Waiting"],["accepted","Accepted"],["advised","Advice"],["declined","Declined"],["all","All"]].map(([value,label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)} className={`min-h-11 shrink-0 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === value ? "bg-accent text-primary" : "text-muted-foreground"}`}>{label}</button>)}</div>
      <div className="flex gap-3"><Select value={sp} onValueChange={setSp}><SelectTrigger className="w-40 sm:w-48" aria-label="Filter by specialty"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All specialties</SelectItem>{usedSpecs.map(s => <SelectItem key={s} value={s}>{specName(specs, s)}</SelectItem>)}</SelectContent></Select>
      <div className="relative flex-1 min-w-0"><Search className="h-4 w-4 absolute left-3 top-4 text-muted-foreground" /><Input className="pl-10" aria-label="Search referral queue" placeholder="Search referrals" value={q} onChange={(e) => setQ(e.target.value)} /></div></div></div>
    <details className="rounded-xl border bg-card px-4 text-sm"><summary className="min-h-11 py-3 cursor-pointer font-medium">Share referral link with a caller</summary><div className="pb-4 space-y-3"><p className="text-xs text-muted-foreground break-all font-mono">{link}</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(link); toast({ title: "Link copied" }); } catch { toast({ title: "Couldn't copy. Select and copy the link above.", variant: "destructive" }); } }} data-testid="button-copy-link"><Copy/>Copy</Button><a href={`https://wa.me/?text=${encodeURIComponent(shareMsg)}`} target="_blank" rel="noreferrer"><Button size="sm" data-testid="button-wa-link"><MessageCircle/>Send via WhatsApp</Button></a></div></div></details>
    {isLoading ? <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div> : list.length===0 ? <Card className="p-10 text-center text-muted-foreground">No referrals here. Send the link to a caller to get started.</Card> :
    <div className="space-y-3">{list.map(r => { const od = isOverdue(r, st); return <button type="button" key={r.id} data-testid={`card-referral-${r.id}`} onClick={() => onOpen(r)} className={`block w-full rounded-xl border bg-card p-5 text-left shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${r.priority === "P1" && r.status === "pending" ? "border-l-4 border-l-red-500" : od ? "border-l-4 border-l-amber-500" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><PriorityPill priority={r.priority}/><span className="font-mono text-xs text-muted-foreground">{r.ref}</span></div>
      <div className="mt-4 flex flex-wrap justify-between items-center gap-3"><p className="bb-patient-initials">{r.patientInitials}<span className="ml-2 text-sm font-normal text-muted-foreground">{r.age} · {r.sex}</span></p><Badge className={sColor[r.status]}>{sLabel[r.status]}</Badge></div>
      <p className="mt-3 text-base font-semibold leading-relaxed">{r.diagnosis}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">From {r.hospital} · Dr {r.doctorName.replace(/^dr\.?\s*/i,"")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3"><Badge variant="outline">{r.team||"Unassigned"}</Badge>{hasUpdate(r)&&<Badge className="bg-sky-700 text-white">New follow-up</Badge>}{r.consultType==="advice"&&<Badge variant="outline">Advice only</Badge>}{r.bedStatus && r.bedStatus !== "Not assigned" && <Badge variant="outline">{r.bedStatus}{r.bedWard && ` · ${r.bedWard}`}</Badge>}{od && <Badge className="bg-amber-50 text-amber-900 border border-amber-200">Overdue</Badge>}<span className="ml-auto text-xs text-muted-foreground">{ago(r.createdAt)}</span></div>
    </button>; })}</div>}
  </div>;
}

function ContactBtns({ c, msg, named, onShare }: { c: RosterContact; msg?: string; named?: boolean; onShare?: (to: string) => void }) {
  return <span className="inline-flex gap-1 items-center flex-wrap">{named && <span className="text-xs text-muted-foreground mr-1">{c.name}</span>}{c.phone && <a href={`tel:${c.phone}`}><Button size="sm" variant="outline" className="h-7 px-2"><Phone className="h-3.5 w-3.5 mr-1" />{c.phone}</Button></a>}
    {c.phone && /^0[6-8]/.test(c.phone.replace(/\D/g, "")) && <a href={`https://wa.me/${waNum(c.phone)}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`} target="_blank" rel="noreferrer" onClick={() => msg && onShare?.(`${c.name} ${c.phone}`)}><Button size="sm" variant="outline" className="h-7 px-2" aria-label="WhatsApp">{msg ? <><Send className="h-3.5 w-3.5 mr-1" />Forward</> : <MessageCircle className="h-3.5 w-3.5" />}</Button></a>}
    {c.hash && <span className="text-xs font-mono text-muted-foreground">ext {c.hash}</span>}</span>;
}

function OnCallBox({ spec, msg, onShare, show }: { spec: string; msg: string; onShare?: (to: string) => void; show:boolean }) {
  const { data, isLoading } = useQuery<{ specs: RosterSpec[]; date: string }>({ queryKey: [`/api/roster?spec=${spec}`], enabled: show && !!spec && spec !== "other" });
  if(!show) return null;
  if (!spec || spec === "other") return null;
  if (isLoading) return <Skeleton className="h-20" />;
  const s = data?.specs[0]; if (!s) return null;
  return <Card className="p-3 space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On call today · {s.name}</p>
    {s.entries.length === 0 ? <p className="text-sm text-muted-foreground">No roster entry for today ({s.period}). Check with switchboard.</p> :
      s.entries.map((e, i) => <div key={i} className="text-sm"><span className="text-muted-foreground">{e.role}: </span><span className="font-medium">{e.text}</span>{e.contacts.map((c, j) => <div key={j} className="mt-1"><ContactBtns c={c} msg={msg} named={e.contacts.length > 1} onShare={onShare} /></div>)}</div>)}</Card>;
}

function CatchmentBox({ r, onSave }: { r: Referral; onSave: (lat: string, lon: string, src: string) => void }) {
  const [q, setQ] = useState(r.hospital || ""); const [hits, setHits] = useState<any[] | null>(null); const [busy, setBusy] = useState(false); const [map, setMap] = useState(false); const [edit, setEdit] = useState(false);
  useEffect(() => { setQ(r.hospital || ""); setHits(null); setMap(false); setEdit(false); }, [r.id]);
  const find = async () => { setBusy(true); try { setHits(await (await apiRequest("GET", `/api/geocode?q=${encodeURIComponent(q)}`)).json()); } catch { setHits([]); } finally { setBusy(false); } };
  const has = !!(r.lat && r.lon);
  return <div className="border-t pt-2 space-y-2">
    <div className="flex flex-wrap gap-2 items-center"><MapPin className="h-4 w-4 text-muted-foreground" /><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">EMS catchment</span>
      {has ? <><a href={catchUrl(r.lat, r.lon)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" data-testid="button-catchment">Check catchment<ExternalLink className="h-3 w-3 ml-1" /></Button></a>
        <Button size="sm" variant="ghost" onClick={() => setMap(!map)}>{map ? "Hide map" : "Show map"}</Button><Button size="sm" variant="ghost" onClick={() => { setEdit(!edit); setHits(null); }}>{edit ? "Cancel" : "Change location"}</Button></>
        : <span className="text-xs text-muted-foreground">No location shared. Look up the facility:</span>}</div>
    {has && <p className="text-xs text-muted-foreground">{r.locSource || "Location on file"} ({r.lat}, {r.lon})</p>}
    {(!has || edit) && <div className="space-y-2"><form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(); }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Facility name, e.g. Stretford CHC" data-testid="input-facility" /><Button size="sm" disabled={busy || q.trim().length < 3} data-testid="button-find-facility">{busy ? "Searching..." : "Find"}</Button></form>
      {hits && hits.length === 0 && <p className="text-xs text-muted-foreground">No match. Try a nearby suburb or town name, or <a className="underline" href="https://catchments.medricsoftware.co.za/" target="_blank" rel="noreferrer">search on the catchment map</a> directly.</p>}
      {hits && hits.map((h, i) => <div key={i} className="flex gap-2 items-start text-xs border rounded-md p-2"><div className="flex-1"><p>{h.name}</p><p className="text-muted-foreground">{h.health ? "Health facility" : h.kind}</p></div>
        <Button size="sm" variant="outline" className="h-7" onClick={() => { onSave(h.lat, h.lon, "Looked up: " + h.name.slice(0, 150)); setHits(null); setEdit(false); setMap(true); }} data-testid={`button-use-hit-${i}`}>Use</Button></div>)}</div>}
    {map && has && <iframe title="EMS catchment map" src={catchUrl(r.lat, r.lon)} className="w-full h-72 rounded-md border" />}
  </div>;
}

function Detail({ r: lite, me, onClose, user }: { r: Referral|null; me: string; onClose: () => void; user:Me }) {
  const { data: full, error:loadError } = useQuery<Referral & {timeline:Followup[]}>({ queryKey: [`/api/referrals/${lite?.id}`], enabled: !!lite, staleTime: 0, refetchInterval:15000 });
  const r = lite ? (full && full.id === lite.id ? { ...full, ...lite, history: full.history, exam: full.exam, investigations: full.investigations, decisionNote: full.decisionNote, folderNo: full.folderNo, email: full.email } as Referral : lite) : null;
  const [note, setNote] = useState(""); const [ward, setWard] = useState<string|null>(null); const [map, setMap] = useState(false); const { toast } = useToast(); const { data: specs } = useSpecs();
  const m = useMutation({ mutationFn: async (u: any) => (await apiRequest("PATCH", `/api/referrals/${r!.id}`, u)).json(), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/referrals"] }); queryClient.invalidateQueries({ queryKey: [`/api/referrals/${lite?.id}`] }); },onError:e=>toast({title:messageOf(e),variant:"destructive"}) });
  const [portalCode,setPortalCode]=useState("");
  const [caseTab, setCaseTab] = useState("clinical");
  useEffect(() => { setWard(null); setMap(false); }, [r?.id]);
  useEffect(() => { if (r && r.priority === "P1" && !r.ackAt) m.mutate({ ack: me }); }, [r?.id]);
  if (!r) return null;
  const dr = r.doctorName.replace(/^dr\.?\s*/i,"");
  const bedTxt = r.bedStatus === "Bed allocated" || r.bedStatus === "Patient en route" ? ` Bed: ${r.bedWard || "allocated"}.` : r.bedStatus === "Bed requested" ? " A bed has been requested; we will confirm when allocated." : "";
  const msg = (s: Status) => {
    const base = `Dear Dr ${dr}, re: your BaraBridge referral ${r.ref} (patient ${r.patientInitials}).`;
    const body = s==="accepted" ? ` The patient has been ACCEPTED by ${r.team}.${bedTxt} Please confirm transfer arrangements with the unit.` : s==="declined" ? " Unfortunately we are unable to accept this referral at this time." : s==="waiting" ? " This referral is on our WAITING list." : s==="advised" ? " Clinical advice is available in your secure follow-up portal. This is not an acceptance for transfer." : "";
    return `${base}${body}${s!=="advised" && (note || r.decisionNote) ? ` Note: ${note || r.decisionNote}` : ""} - ${me}`;
  };
  const fwd = `BaraBridge: ${r.priority} ${specName(specs, r.specialty)} consult ${r.ref} from ${r.hospital} needs your review. Please sign in to BaraBridge to see the details: ${window.location.href.split("#")[0]} - ${me}`;
  const logShare = (to: string) => apiRequest("POST", `/api/referrals/${r.id}/shared`, { to }).catch(() => {});
  const decide = (s: Status) => { m.mutate({ status: s, decisionNote: note || r.decisionNote, decidedBy: me, ...(s === "waiting" && !r.remindAt ? { remindAt: new Date(Date.now() + 30 * 60000).toISOString() } : {}) },{onSuccess:()=>{toast({title:sLabel[s],description:"Saved to the referral and secure portal. Tap WhatsApp to notify the referrer."});setNote("");}}); };
  const remind = (mn: number) => { m.mutate({ remindAt: new Date(Date.now() + mn * 60000).toISOString(), ...(r.status === "pending" ? { status: "waiting", decidedBy: me } : {}) }); toast({ title: `Reminder in ${mn >= 60 ? mn / 60 + " h" : mn + " min"}` }); };
  const Sec = ({ t, v }: any) => <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t}</p><p className="text-sm whitespace-pre-wrap">{v || "-"}</p></div>;
  return <Sheet open onOpenChange={(o) => { if (!o) { setNote(""); onClose(); } }}><SheetContent className="w-full sm:max-w-xl flex flex-col overflow-hidden p-0"><SheetHeader className="shrink-0 border-b p-6 pb-4"><SheetTitle className="flex items-center gap-2 pr-12"><span className={`rounded px-2 py-0.5 text-xs font-bold ${pColor[r.priority]}`}>{r.priority}</span>{r.diagnosis}</SheetTitle></SheetHeader>
    <div className="min-h-0 flex-1 overflow-y-auto space-y-5 px-6 pb-6 pt-4">
      {loadError&&<p role="alert" className="text-sm text-destructive">Could not load this referral. Your unit access may have changed.</p>}
      <div className="bb-case-banner space-y-3"><div className="flex flex-wrap justify-between gap-3"><p className="bb-patient-initials">{r.patientInitials}<span className="ml-2 text-sm font-normal text-teal-100">{r.age} · {r.sex}</span></p><span className="text-sm font-semibold">{r.team || "Unassigned"}</span></div><p className="text-sm text-teal-100">{r.ref} · {r.consultType === "advice" ? "Advice-only request" : "Transfer request"}</p><p className="border-t border-white/20 pt-3 font-semibold">{sLabel[r.status]}</p></div>
      {user.role==="admin"&&<Field label="Receiving unit (global admin routing)"><TeamSelect value={r.team||""} onChange={team=>m.mutate({team})}/></Field>}
      <div className="flex flex-wrap gap-2 items-center text-sm"><Badge className={sColor[r.status]}>{sLabel[r.status]}</Badge><span className="font-mono">{r.ref}</span><span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>{r.ackBy && <span className="text-xs text-muted-foreground">Seen by {r.ackBy}</span>}</div>
      <p className="text-xs text-muted-foreground">{r.team||"Unassigned"} · {r.consultType==="advice"?"Advice-only consult":"Transfer request"}{r.openedBy?` · First opened by ${r.openedBy}`:""}</p>
      <Tabs value={caseTab} onValueChange={setCaseTab}><TabsList className="w-full" aria-label="Referral information"><TabsTrigger value="clinical">Clinical details</TabsTrigger><TabsTrigger value="history">History</TabsTrigger><TabsTrigger value="images">Images{full?.images?.length ? ` (${full.images.length})` : ""}</TabsTrigger></TabsList>
      <TabsContent value="clinical" className="space-y-5"><Card className="p-4 text-sm space-y-3"><p className="font-medium">Dr {dr}, {r.hospital}{r.department && ` (${r.department})`}</p>
        <div className="flex flex-wrap gap-2"><a href={`tel:${r.phone}`}><Button size="sm" variant="outline"><Phone className="h-4 w-4 mr-1" />{r.phone}</Button></a>{r.email && <a href={`mailto:${r.email}`} className="text-sm underline self-center">{r.email}</a>}
        </div>
        <CatchmentBox r={r} onSave={(lat, lon, src) => m.mutate({ lat, lon, locSource: src })} /></Card>
      <div className="grid grid-cols-3 gap-3 text-sm"><Sec t="Specialty" v={specName(specs, r.specialty)} /><Sec t="Patient in" v={r.currentLocation} /><Sec t="Bed needed" v={r.bedNeeded} />
        <Sec t="Patient" v={`${r.patientInitials}, ${r.age} ${r.sex}`} /><Sec t="Folder" v={r.folderNo} /><Sec t="Suggested" v={r.suggestedPriority} /></div>
      <Sec t="History" v={r.history} /><Sec t="Examination" v={r.exam} /><Sec t="Investigations" v={r.investigations} /><Sec t="Request" v={r.reason} /></TabsContent>
      <TabsContent value="images" className="space-y-3"><h3 className="font-semibold">Clinical images</h3>{!full?.images?.length && <p className="text-sm text-muted-foreground">No initial referral images. Images attached to updates are in History.</p>}<Images images={full?.images} referralId={r.id}/></TabsContent>
      <TabsContent value="history" className="space-y-3"><h3 className="font-semibold text-sm">Updates and response history</h3><Timeline entries={full?.timeline} referralId={r.id}/>{!full?.timeline?.length && <p className="text-sm text-muted-foreground">No updates recorded yet.</p>}</TabsContent></Tabs>
      <OnCallBox spec={r.specialty} msg={fwd} onShare={logShare} show={user.role==="admin"} />
      <div className="border-t pt-4 space-y-3"><div className="flex items-center gap-3"><Label className="w-16">Priority</Label><div className="flex gap-1">{(["P1","P2","P3"] as const).map(p => <Button key={p} size="sm" variant={r.priority===p?"default":"outline"} onClick={() => m.mutate({ priority: p })} data-testid={`button-set-${p}`}>{p}</Button>)}</div></div>
        <div className="flex flex-wrap items-center gap-2"><Label className="w-16">Bed</Label><Select value={r.bedStatus || "Not assigned"} onValueChange={(v) => m.mutate({ bedStatus: v })}><SelectTrigger className="w-44" data-testid="select-bedstatus"><SelectValue /></SelectTrigger><SelectContent>{BEDSTAT.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
          <Input className="flex-1 min-w-[140px]" placeholder="Ward / bed no." value={ward ?? r.bedWard ?? ""} onChange={(e) => setWard(e.target.value)} onBlur={() => ward !== null && m.mutate({ bedWard: ward })} data-testid="input-bedward" /></div>
        <div className="rounded-xl border border-primary/25 bg-accent/50 p-4 space-y-3"><Field label="Clinical advice / note to referring doctor"><Textarea rows={4} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={r.decisionNote || "Type clinical advice, treatment plan or transfer instructions"} data-testid="input-advice" /></Field><p className="text-xs leading-relaxed text-muted-foreground">Choose a decision below. Advice alone does not accept a transfer.</p></div>
        <div className="grid grid-cols-2 gap-3"><Button disabled={m.isPending} onClick={() => decide("accepted")} className="bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="button-accept"><Check/>Accept transfer</Button><Button variant="outline" disabled={m.isPending||!note.trim()} onClick={()=>decide("advised")} className="border-primary text-primary" data-testid="button-send-advice"><MessageCircle/>Advice only</Button><Button variant="outline" disabled={m.isPending} onClick={() => decide("waiting")} className="text-amber-900 border-amber-300 bg-amber-50" data-testid="button-wait"><Clock/>Wait / hold</Button><Button variant="destructive" disabled={m.isPending} onClick={() => decide("declined")} data-testid="button-decline"><X/>Decline</Button></div>
        {(r.status === "pending" || r.status === "waiting") && <div className="flex flex-wrap items-center gap-1.5"><AlarmClock className="h-4 w-4 text-muted-foreground" /><span className="text-sm text-muted-foreground mr-1">Remind me in</span>{[15, 30, 60, 120].map(mn => <Button key={mn} size="sm" variant="outline" className="h-7 px-2" onClick={() => remind(mn)}>{mn >= 60 ? mn / 60 + "h" : mn + "m"}</Button>)}
          {r.remindAt && <span className="text-xs text-muted-foreground">Set for {new Date(r.remindAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</div>}
        {r.status!=="pending" && <a href={`https://wa.me/${waNum(r.phone)}?text=${encodeURIComponent(msg(r.status))}`} target="_blank" rel="noreferrer" onClick={() => logShare(`referring doctor ${r.phone}`)}><Button variant="secondary" className="w-full" data-testid="button-notify"><MessageCircle className="h-4 w-4 mr-1" />Notify Dr {dr} on WhatsApp</Button></a>}
        <a href={`https://wa.me/${waNum(r.phone)}?text=${encodeURIComponent(`Your referral ${r.ref} has been opened by the ${r.team||"receiving"} team. This is an opened receipt, not acceptance for transfer. Please use your secure portal for updates.`)}`} target="_blank" rel="noreferrer" onClick={()=>logShare("opened receipt")}><Button variant="outline" className="w-full">WhatsApp: referral opened</Button></a>
        {user.role!=="clinician"&&<div className="border rounded p-3 space-y-2"><p className="text-xs text-muted-foreground">Legacy referral or lost code? Verify the referring doctor's identity before resetting portal access.</p><Button size="sm" variant="outline" onClick={async()=>{try{const d=await(await apiRequest("POST",`/api/referrals/${r.id}/portal-reset`)).json();setPortalCode(d.code);}catch(e){toast({title:messageOf(e),variant:"destructive"});}}}>Generate new private follow-up code</Button>{portalCode&&<p className="font-mono text-xs break-all select-all">{portalCode}</p>}</div>}
        {r.decidedBy && <p className="text-xs text-muted-foreground">Last update by {r.decidedBy}{r.decidedAt && `, ${ago(r.decidedAt)}`}</p>}
      </div><Button variant="outline" className="w-full" onClick={onClose}>Back to referral queue</Button></div></SheetContent></Sheet>;
}

/* ---------- ON CALL ---------- */
function OnCall({me}:{me:Me}) {
  const sa = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const [date, setDate] = useState(sa); const [g, setG] = useState("All"); const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<{ specs: RosterSpec[]; hospital: string; generated: string }>({ queryKey: [`/api/roster?date=${date}`],enabled:me.role==="admin" });
  const specs = (data?.specs || []).filter(s => g === "All" || s.group === g).filter(s => !q || JSON.stringify(s).toLowerCase().includes(q.toLowerCase()));
  return <div className="space-y-4"><div className="flex flex-wrap gap-3 items-end justify-between"><div><h1 className="text-xl font-semibold">On call</h1><p className="text-sm text-muted-foreground">{me.role==="admin" ? `${data?.hospital||"CHBAH"} · roster built ${data?.generated||"previously"}. Rosters change at short notice; confirm with switchboard when in doubt.` : `Your ${me.team} duty roster. Check with the unit consultant when shifts change.`}</p></div>
    <div className="flex gap-2"><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" /><Button variant="outline" onClick={() => setDate(sa)}>Today</Button></div></div>
    {(me.team||me.role==="admin")&&<UnitRoster me={me}/>}
    {me.role==="admin"&&<><div className="flex flex-wrap gap-2 items-center">{["All", "Medicine", "Surgery", "Other", "Management"].map(x => <Button key={x} size="sm" variant={g === x ? "default" : "outline"} onClick={() => setG(x)}>{x}</Button>)}<Input className="sm:ml-auto sm:w-64" placeholder="Search specialty or name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    {isLoading ? <Skeleton className="h-60" /> : <div className="grid md:grid-cols-2 gap-3">{specs.map(s => <Card key={s.id} className="p-4 space-y-2"><div className="flex justify-between gap-2"><p className="font-semibold">{s.name}</p><span className="text-xs text-muted-foreground">{s.group}</span></div>
      {s.entries.length === 0 ? <p className="text-sm text-muted-foreground">No roster for this date.</p> : s.entries.map((e, i) => <div key={i} className="text-sm border-t pt-2 first:border-0 first:pt-0"><p><span className="text-muted-foreground">{e.role}: </span><span className="font-medium">{e.text}</span></p>{e.contacts.map((c, j) => <div key={j} className="mt-1"><ContactBtns c={c} named={e.contacts.length > 1} /></div>)}</div>)}</Card>)}</div>}</>}
  </div>;
}

function Catchments() {
  const [ll, setLl] = useState<{ lat: string; lon: string } | null>(null); const [err, setErr] = useState("");
  const here = () => navigator.geolocation?.getCurrentPosition((p) => setLl({ lat: p.coords.latitude.toFixed(6), lon: p.coords.longitude.toFixed(6) }), () => setErr("Location unavailable here; open the map in a new tab instead."));
  const url = ll ? catchUrl(ll.lat, ll.lon) : "https://catchments.medricsoftware.co.za/";
  return <div className="space-y-3"><div className="flex flex-wrap gap-2 items-center justify-between"><div><h1 className="text-xl font-semibold">EMS catchments</h1><p className="text-sm text-muted-foreground">Medric EMS catchment and pre-notification map. Referrals with a shared location open here directly.</p></div>
    <div className="flex gap-2"><Button variant="outline" size="sm" onClick={here}><MapPin className="h-4 w-4 mr-1" />My location</Button><a href={url} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink className="h-4 w-4 mr-1" />Open full screen</Button></a></div></div>
    {err && <p className="text-sm text-muted-foreground">{err}</p>}
    <iframe key={url} title="Medric EMS catchments" src={url} className="w-full h-[70vh] rounded-md border bg-muted" allow="geolocation" /></div>;
}

function Doctors() {
  const { data = [], isLoading } = useQuery<Doctor[]>({ queryKey: ["/api/doctors"] }); const [q, setQ] = useState("");
  const l = data.filter(d => !q || JSON.stringify(d).toLowerCase().includes(q.toLowerCase()));
  return <div className="space-y-4"><div className="flex justify-between items-center gap-3"><h1 className="text-xl font-semibold">Referring doctors</h1><Input className="max-w-xs" placeholder="Search name or hospital" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <p className="text-sm text-muted-foreground">Built automatically from submitted referrals. Hospital on-call contacts are on the On call page.</p>
    {isLoading ? <Skeleton className="h-40" /> : <Card className="divide-y">{l.length===0 && <p className="p-6 text-center text-muted-foreground">No doctors yet.</p>}{l.map(d => <div key={d.phone} className="p-4 flex flex-wrap gap-3 items-center"><div className="flex-1 min-w-[200px]"><p className="font-medium">Dr {d.doctorName.replace(/^dr\.?\s*/i,"")}</p><p className="text-sm text-muted-foreground">{d.hospital}{d.department && ` · ${d.department}`} · {d.count} referral{d.count>1?"s":""}</p></div>
      <a href={`tel:${d.phone}`}><Button size="sm" variant="outline"><Phone className="h-4 w-4 mr-1" />{d.phone}</Button></a><a href={`https://wa.me/${waNum(d.phone)}`} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" /></Button></a>{d.email && <a className="text-sm underline" href={`mailto:${d.email}`}>{d.email}</a>}</div>)}</Card>}</div>;
}

function Desk({ user, onLogout }: { user: Me; onLogout: () => void }) {
  const me = user.name; const admin = user.role === "admin"; const manager=admin||(user.role==="unit_admin" && !!user.team);
  const [st, setSt] = useState<AlertSettings>(defaultSettings); const [settings, setSettings] = useState(false); const [openId, setOpenId] = useState<number|null>(null);
  useEffect(() => { apiRequest("GET", "/api/settings").then(r => r.json()).then(v => v && setSt({ ...defaultSettings, ...v })).catch(() => {}); }, []);
  const { p1, due, data, isLoading, error, refetch } = useAlerts(me, st);
  useEffect(() => { document.title = (p1.length ? `(${p1.length}) P1! ` : due.length ? `(${due.length}) ` : "") + "BaraBridge"; }, [p1.length, due.length]);
  const open = (r: Referral) => setOpenId(r.id);
  return <Shell me={me} admin={manager} onLogout={onLogout} alertCount={p1.length + due.length} onSettings={() => setSettings(true)}>
    <Switch><Route path="/oncall"><OnCall me={user}/></Route><Route path="/catchments" component={Catchments} /><Route path="/doctors" component={Doctors} />
      <Route path="/admin">{manager ? <Admin me={user} /> : <Card className="p-6 space-y-3"><p>This page is for administrators.</p><Link href="/queue" className="block underline">Back to referral queue</Link></Card>}</Route><Route>{isLoading ? <p role="status">Loading referral queue...</p> : error ? <Card className="p-5 space-y-3"><p role="alert">Couldn't load the referral queue. Check your connection and try again.</p><Button onClick={() => refetch()}>Try again</Button></Card> : <Queue me={me} user={user} data={data} st={st} onOpen={open} />}</Route></Switch>
    <P1Alarm list={openId ? p1.filter(r => r.id !== openId) : p1} me={me} onOpen={open} />
    <SettingsSheet open={settings} onClose={() => setSettings(false)} st={st} setSt={setSt} due={due} onOpen={open} admin={admin} />
    <Detail key={openId} r={openId ? data.find(x => x.id === openId) || null : null} me={me} user={user} onClose={() => {setOpenId(null);queryClient.invalidateQueries({queryKey:["/api/referrals"]});}} />
  </Shell>;
}

function SessionGate({ children }: { children: ReactNode }) {
  const { restoring, restoreError, retryRestore, signOut } = useAuth();
  if (restoring) return <Shell public><div className="max-w-md mx-auto space-y-3"><p role="status">Restoring your session...</p><p className="text-sm text-muted-foreground">You can return Home or sign in again.</p><Button variant="outline" onClick={() => signOut("/login")}>Sign in instead</Button></div></Shell>;
  if (restoreError) return <Shell public><Card className="max-w-md mx-auto p-5 space-y-4"><h1 className="text-xl font-semibold">Couldn't restore your session</h1><p role="alert">{restoreError}</p><div className="flex flex-wrap gap-2"><Button onClick={retryRestore}>Try again</Button><Button variant="outline" onClick={() => signOut("/login")}>Sign in again</Button></div></Card></Shell>;
  return children;
}

function StaffEntry() {
  const { user, signOut, refreshUser } = useAuth();
  if (!user) return <Login/>;
  if (user.role === "referrer") return <Shell public><Card className="max-w-md mx-auto p-5 space-y-4"><h1 className="text-xl font-semibold">You're signed in as a referrer</h1><p>Your consults are in the referrer portal. Receiving staff use an account created by their unit administrator.</p><Link href="/portal" className="block underline font-medium">Continue to my consults</Link><Button variant="outline" onClick={() => signOut("/login")}>Switch to a staff account</Button></Card></Shell>;
  if (user.mustChange) return <Shell public><ChangePassword me={user} onDone={refreshUser}/><div className="max-w-sm mx-auto"><Button variant="ghost" onClick={() => signOut()}>Sign out</Button></div></Shell>;
  return <Desk user={user} onLogout={() => signOut()}/>;
}

function AppRoutes() {
  const [location] = useLocation();
  const { user } = useAuth();
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [location, user?.id]);
  return <Switch>
    <Route path="/refer/:team" component={({params}:any) => <SessionGate><Shell public><Portal initialTeam={params.team}/></Shell></SessionGate>}/>
    <Route path="/refer"><SessionGate><Shell public><Portal initialNew/></Shell></SessionGate></Route>
    <Route path="/portal"><SessionGate><Shell public><Portal/></Shell></SessionGate></Route>
    <Route path="/followup"><Shell public><ReferrerPortal/></Shell></Route>
    <Route path="/privacy" component={Privacy}/><Route path="/status/:ref" component={StatusPage}/><Route path="/status" component={StatusPage}/>
    {["/login", "/queue", "/admin", "/oncall", "/catchments", "/doctors"].map(path => <Route key={path} path={path}><SessionGate><StaffEntry/></SessionGate></Route>)}
    <Route path="/" component={Landing}/>
    <Route><Shell public><Card className="max-w-md mx-auto p-5 space-y-3"><h1 className="text-xl font-semibold">Page not found</h1><p>This link doesn't match a BaraBridge page. Choose Home, Staff sign-in or Referrer portal above.</p><Link href="/" className="underline font-medium">Back to Home</Link></Card></Shell></Route>
  </Switch>;
}

export default function App() {
  return <QueryClientProvider client={queryClient}><Toaster/><Router hook={useHashLocation}><AuthProvider><AppRoutes/></AuthProvider></Router></QueryClientProvider>;
}
