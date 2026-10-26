import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, session } from "./lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Phone, MessageCircle, LogOut, CalendarDays, ClipboardList, ShieldCheck, Send, User as UserIcon } from "lucide-react";
import { TeamSelect, ImagePicker, messageOf, type UploadImage } from "./workflows";
import type { Referral, Status, RosterSpec, RosterContact } from "@shared/schema";

/* ---------- shared display helpers (kept local to the PWA) ---------- */
const pColor: Record<string, string> = { P1: "bg-red-600 text-white", P2: "bg-amber-500 text-black", P3: "bg-emerald-600 text-white" };
const sLabel: Record<Status, string> = { pending: "New", accepted: "Accepted", declined: "Declined", waiting: "Waiting", advised: "Advice sent" };
const sColor: Record<Status, string> = {
  pending: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  accepted: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  declined: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  waiting: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  advised: "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100",
};
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
const waNum = (p: string) => { const d = p.replace(/\D/g, ""); return d.startsWith("0") ? "27" + d.slice(1) : d; };
const LOCS = ["Casualty / ED", "Ward", "ICU / High care", "Theatre", "Clinic / OPD"];
const BEDS = ["General ward", "High care", "ICU", "Theatre", "No bed – advice only"];
const saToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

/* localStorage keys — the referrer's profile survives reloads so consults
   auto-fill their details (the settled "autofill" requirement). */
const TK = "td_token", PK = "td_referrer";
const loadProfile = (): any => { try { return JSON.parse(localStorage.getItem(PK) || "null"); } catch { return null; } };
const saveProfile = (u: any) => { try { localStorage.setItem(PK, JSON.stringify(u)); } catch {} };
const clearAuth = () => { try { localStorage.removeItem(TK); localStorage.removeItem(PK); } catch {} };

function Field({ label, children, hint }: any) { return <div className="space-y-1.5"><Label className="text-sm font-medium">{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>; }

const useSpecs = () => useQuery<{ id: string; name: string; group: string }[]>({ queryKey: ["/api/specialties"] });
const specName = (specs: any[] | undefined, id: string) => specs?.find((s) => s.id === id)?.name || id || "Unspecified";

/* ---------- on-call roster (full 24-spec roster for referrers) ---------- */
function RosterContactBtns({ c }: { c: RosterContact }) {
  return <span className="inline-flex gap-1 items-center flex-wrap">{c.name && <span className="text-xs text-muted-foreground mr-1">{c.name}</span>}
    {c.phone && <a href={`tel:${c.phone}`}><Button size="sm" variant="outline" className="h-7 px-2"><Phone className="h-3.5 w-3.5 mr-1" />{c.phone}</Button></a>}
    {c.phone && /^0[6-8]/.test(c.phone.replace(/\D/g, "")) && <a href={`https://wa.me/${waNum(c.phone)}`} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="h-7 px-2" aria-label="WhatsApp"><MessageCircle className="h-3.5 w-3.5" /></Button></a>}
    {c.hash && <span className="text-xs font-mono text-muted-foreground">ext {c.hash}</span>}</span>;
}

function RosterView() {
  const [date, setDate] = useState(saToday());
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<{ specs: RosterSpec[]; hospital: string; generated: string }>({ queryKey: [`/api/referrer/roster?date=${date}`] });
  const specs = (data?.specs || []).filter((s) => !q || JSON.stringify(s).toLowerCase().includes(q.toLowerCase()));
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2 items-end justify-between"><div><h2 className="font-semibold">On-call roster</h2><p className="text-xs text-muted-foreground">{data?.hospital || ""} · built {data?.generated || "previously"}. Rosters change at short notice; confirm with the switchboard when in doubt.</p></div>
      <div className="flex gap-2"><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" /><Button variant="outline" size="sm" onClick={() => setDate(saToday())}>Today</Button></div></div>
    <Input placeholder="Search specialty or name" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
    {isLoading ? <Skeleton className="h-40" /> : specs.length === 0 ? <Card className="p-6 text-center text-muted-foreground">No roster for this date.</Card> :
      <div className="grid md:grid-cols-2 gap-3">{specs.map((s) => <Card key={s.id} className="p-4 space-y-2"><div className="flex justify-between gap-2"><p className="font-semibold">{s.name}</p><span className="text-xs text-muted-foreground">{s.group}</span></div>
        {s.entries.length === 0 ? <p className="text-sm text-muted-foreground">No roster for this date.</p> : s.entries.map((e, i) => <div key={i} className="text-sm border-t pt-2 first:border-0 first:pt-0"><p><span className="text-muted-foreground">{e.role}: </span><span className="font-medium">{e.text}</span></p>{e.contacts.map((c, j) => <div key={j}><RosterContactBtns c={c} /></div>)}</div>)}</Card>)}</div>}</div>;
}

/* ---------- read-only referral detail for the referrer ---------- */
function ReferralDetail({ r, onClose }: { r: Referral; onClose: () => void }) {
  const { data: full } = useQuery<Referral & { timeline: any[] }>({ queryKey: [`/api/referrals/${r.id}`], staleTime: 0, refetchInterval: 15000 });
  const d: Referral & { timeline: any[] } = full || { ...r, timeline: [] };
  const { data: specs } = useSpecs();
  const Sec = ({ t, v }: any) => <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t}</p><p className="text-sm whitespace-pre-wrap">{v || "-"}</p></div>;
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
    <div className="bg-background rounded-t-xl sm:rounded-xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 pr-8"><span className={`rounded px-2 py-0.5 text-xs font-bold ${pColor[d.priority]}`}>{d.priority}</span><span className="font-semibold">{d.diagnosis}</span><Button size="icon" variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button></div>
      <div className="flex flex-wrap gap-2 items-center text-sm"><Badge className={sColor[d.status]}>{sLabel[d.status]}</Badge><span className="font-mono">{d.ref}</span><span className="text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</span></div>
      <p className="text-xs text-muted-foreground">{d.team || "Unassigned"} · {d.consultType === "advice" ? "Advice-only consult" : "Transfer request"}</p>
      <div className="grid grid-cols-3 gap-3 text-sm"><Sec t="Specialty" v={specName(specs, d.specialty)} /><Sec t="Bed needed" v={d.bedNeeded} /><Sec t="Patient" v={`${d.patientInitials}, ${d.age} ${d.sex}`} /></div>
      {d.decisionNote && <Card className="p-3 border-primary space-y-1"><p className="text-xs font-semibold uppercase tracking-wide text-primary">Clinical advice / decision</p><p className="text-sm whitespace-pre-wrap">{d.decisionNote}</p>{d.decidedBy && <p className="text-xs text-muted-foreground">By {d.decidedBy}{d.decidedAt && `, ${ago(d.decidedAt)}`}</p>}</Card>}
      {d.timeline && d.timeline.length > 0 && <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Updates and response history</p>{d.timeline.map((e: any) => <Card key={e.id} className={`p-3 space-y-1 ${e.kind === "advice" ? "border-primary" : ""}`}><div className="flex justify-between text-xs"><span className="font-semibold">{e.kind === "advice" ? "Clinical advice" : e.kind === "decision" ? "Decision" : "Clinical update"} · {e.author}</span><span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span></div><p className="text-sm whitespace-pre-wrap">{e.body}</p></Card>)}</div>}
      <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
    </div></div>;
}

/* ---------- new consult form (autofills the referrer's details) ---------- */
const emptyForm = { team: "", consultType: "transfer", consent: false, specialty: "", currentLocation: "", bedNeeded: "", lat: "", lon: "", patientInitials: "", age: "", sex: "", folderNo: "", diagnosis: "", history: "", exam: "", investigations: "", reason: "", suggestedPriority: "P2" };
function ConsultForm({ me, onDone, initialTeam }: { me: any; onDone: () => void; initialTeam?: string }) {
  const { toast } = useToast();
  // Referring-doctor fields are prefilled from the stored profile (the
  // "autofill" requirement) and stay editable in case details changed.
  const freshForm = () => ({
    ...emptyForm, team: ["MEU", "TEU", "SEU"].includes(initialTeam || "") ? initialTeam : "",
    doctorName: me.name || "", hospital: me.hospital || "", department: me.department || "",
    phone: me.phone || "", email: me.email || "",
  });
  const [f, setF] = useState<any>(freshForm);
  const [images, setImages] = useState<UploadImage[]>([]);
  const [done, setDone] = useState<any>(null);
  const [geo, setGeo] = useState("");
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target ? e.target.value : e });
  const { data: specs } = useSpecs();
  const groups = useMemo(() => Array.from(new Set((specs || []).map((s) => s.group))).filter((g) => g !== "Management"), [specs]);
  const locate = () => { if (!navigator.geolocation) return setGeo("Location not available on this device"); setGeo("Finding location...");
    navigator.geolocation.getCurrentPosition((p) => { setF((x: any) => ({ ...x, lat: p.coords.latitude.toFixed(6), lon: p.coords.longitude.toFixed(6) })); setGeo(""); }, () => setGeo("Could not get location. You can skip this."), { enableHighAccuracy: true, timeout: 10000 }); };
  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/referrals", f)).json(),
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["/api/referrer/my-referrals"] }); setDone(d); },
    onError: (e) => toast({ title: messageOf(e), variant: "destructive" }),
  });
  if (done) return <Card className="p-6 space-y-3"><Check className="mx-auto h-10 w-10 text-primary" /><h2 className="text-lg font-semibold text-center">Consult sent to {f.team || "the unit"}</h2>
    <p className="text-sm">Reference <span className="font-mono font-bold" data-testid="text-ref">{done.ref}</span>. Track it under My consults; advice and decisions appear there and in your secure portal.</p>
    <div className="flex gap-2 flex-wrap"><Button onClick={onDone}>Back to dashboard</Button><Button variant="outline" onClick={() => { setF(freshForm()); setImages([]); setDone(null); }}>New consult</Button></div></Card>;
  return <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
    <Card className="p-5 space-y-4"><div className="flex items-center gap-2"><UserIcon className="h-4 w-4 text-primary" /><h2 className="font-semibold">Your details</h2><Badge variant="outline" className="ml-auto">Auto-filled — edit if changed</Badge></div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Full name *"><Input value={f.doctorName} onChange={set("doctorName")} required /></Field>
        <Field label="Hospital / facility *"><Input value={f.hospital} onChange={set("hospital")} required /></Field>
        <Field label="Department / ward"><Input value={f.department} onChange={set("department")} /></Field>
        <Field label="Cellphone (WhatsApp) *"><Input type="tel" value={f.phone} onChange={set("phone")} required /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
      </div></Card>
    <Card className="p-5 space-y-4"><h2 className="font-semibold">Referral to</h2>
      <div className="grid sm:grid-cols-2 gap-4"><Field label="Receiving unit *"><TeamSelect value={f.team} onChange={(v) => setF({ ...f, team: v })} /></Field>
        <Field label="Consult type"><Select value={f.consultType} onValueChange={(v) => setF({ ...f, consultType: v, bedNeeded: v === "advice" ? "No bed – advice only" : "" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="transfer">Transfer request</SelectItem><SelectItem value="advice">Advice only / no transfer</SelectItem></SelectContent></Select></Field></div>
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Specialty *"><Select value={f.specialty} onValueChange={set("specialty")}><SelectTrigger><SelectValue placeholder="Select specialty" /></SelectTrigger><SelectContent>
          {groups.map((g) => <div key={g}><p className="px-2 py-1 text-xs font-semibold text-muted-foreground">{g}</p>{(specs || []).filter((s) => s.group === g).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</div>)}
          <SelectItem value="other">Other / not listed</SelectItem></SelectContent></Select></Field>
        <Field label="Patient currently in"><Select value={f.currentLocation} onValueChange={set("currentLocation")}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{LOCS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Bed needed"><Select value={f.bedNeeded} onValueChange={set("bedNeeded")}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{BEDS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></Field>
      </div></Card>
    <Card className="p-5 space-y-4"><h2 className="font-semibold">Patient</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Initials *"><Input value={f.patientInitials} onChange={set("patientInitials")} required /></Field>
        <Field label="Age *"><Input value={f.age} onChange={set("age")} required /></Field>
        <Field label="Sex *"><Select value={f.sex} onValueChange={set("sex")}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="M">Male</SelectItem><SelectItem value="F">Female</SelectItem></SelectContent></Select></Field>
        <Field label="Folder no."><Input value={f.folderNo} onChange={set("folderNo")} /></Field>
      </div>
      <Field label="Working diagnosis *"><Input value={f.diagnosis} onChange={set("diagnosis")} required /></Field>
      <Field label="History *"><Textarea rows={4} value={f.history} onChange={set("history")} required /></Field>
      <Field label="Examination (incl. vitals) *"><Textarea rows={4} value={f.exam} onChange={set("exam")} required placeholder="BP, HR, RR, SpO2, Temp, GCS, glucose, then findings" /></Field>
      <Field label="Investigations *"><Textarea rows={4} value={f.investigations} onChange={set("investigations")} required placeholder="Bloods, ECG, imaging, results available so far" /></Field>
      <Field label="Reason for referral / request *"><Textarea rows={2} value={f.reason} onChange={set("reason")} required /></Field>
      <Field label="Suggested priority *"><div className="grid sm:grid-cols-3 gap-2">{[["P1", "Emergency, needs transfer now"], ["P2", "Urgent, within hours"], ["P3", "Routine / advice"]].map(([p, d]) =>
        <button type="button" key={p} onClick={() => setF({ ...f, suggestedPriority: p })} className={`text-left rounded-md border p-3 transition ${f.suggestedPriority === p ? "border-primary ring-2 ring-primary/30" : "hover-elevate"}`}><span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${pColor[p]}`}>{p}</span><p className="text-sm mt-1">{d}</p></button>)}</div></Field></Card>
    <Card className="p-4"><ImagePicker images={images} onChange={(v) => { setImages(v); setF({ ...f, images: v }); }} /></Card>
    <Card className="p-4 space-y-2 text-sm"><label className="flex gap-3 items-start"><input type="checkbox" className="mt-1 h-4 w-4" checked={!!f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
      <span>I confirm this information is shared only for this patient's care and transfer, contains the minimum needed, and the patient (or their representative) has been told it is being shared where this is possible. *</span></label></Card>
    <Button type="submit" size="lg" className="w-full" disabled={m.isPending || !f.consent || !f.team}>{m.isPending ? "Sending..." : "Submit consult"}</Button>
  </form>;
}

/* ---------- staff-card upload (verification fallback) ---------- */
function CardUpload({ me, onUploaded }: { me: any; onUploaded: () => void }) {
  const { toast } = useToast();
  const [img, setImg] = useState<string | null>(null);
  const [mime, setMime] = useState<string>("image/jpeg");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async (files: FileList | null) => {
    setErr(""); if (!files || !files[0]) return;
    const file = files[0];
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setErr("Use a JPEG, PNG or WebP photo.");
    if (file.size > 2 * 1024 * 1024) return setErr("Photo must be under 2 MB.");
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
    setMime(file.type); setImg(b64);
  };
  const send = async () => {
    if (!img) return; setBusy(true); setErr("");
    try { const d = await (await apiRequest("POST", "/api/referrer/card", { image: { name: "staff-card.jpg", mime, data: img } })).json(); toast({ title: "Staff card sent", description: d.message || "The owner will verify it shortly." }); onUploaded(); }
    catch (e: any) { setErr(messageOf(e)); } finally { setBusy(false); }
  };
  const shown = me?.verifyStatus === "card_pending" || me?.verifyStatus === "verified";
  return <Card className="p-4 space-y-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><p className="font-semibold text-sm">Verify your account</p></div>
    <p className="text-xs text-muted-foreground">{me?.verifyStatus === "verified" ? "Your account is verified." : "Upload a photo of your staff card (showing your name, facility and, where present, HPCSA/DOH details). You can send referrals after the owner verifies your account."}</p>
    {img && <img src={`data:${mime};base64,${img}`} alt="Staff card preview" className="max-h-56 rounded border" />}
    <div className="flex flex-wrap gap-2"><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => pick(e.target.files)} /><Button onClick={send} disabled={busy || !img}>{busy ? "Sending..." : "Send staff card"}</Button></div>
    {err && <p className="text-sm text-destructive" role="alert">{err}</p>}</Card>;
}

/* ---------- login + signup ---------- */
function PortalAuth({ onIn }: { onIn: (u: any) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [su, setSu] = useState({ name: "", email: "", phone: "", hospital: "", department: "", specialty: "", profession: "doctor", hpcsa: "", username: "", password: "" });
  const setS = (k: string) => (e: any) => setSu({ ...su, [k]: e.target ? e.target.value : e });
  const { toast } = useToast();
  const doLogin = async (e: any) => { e.preventDefault(); setBusy(true); setErr("");
    try { const r = await (await apiRequest("POST", "/api/login", { username: u, password: p })).json();
      if (r.user.role !== "referrer") return setErr("This is a staff account, not a referral-PWA account. Use Staff sign-in on the home page.");
      session.token = r.token; localStorage.setItem(TK, r.token); saveProfile(r.user); onIn(r.user);
    } catch (x: any) { setErr(messageOf(x)); } finally { setBusy(false); } };
  const doSignup = async (e: any) => { e.preventDefault(); setBusy(true); setErr("");
    try { const d = await (await apiRequest("POST", "/api/referrer/signup", { ...su, name: su.name, email: su.email, phone: su.phone, hospital: su.hospital, department: su.department, specialty: su.specialty, profession: su.profession, hpcsa: su.hpcsa })).json();
      const r = await (await apiRequest("POST", "/api/login", { username: su.username, password: su.password })).json();
      session.token = r.token; localStorage.setItem(TK, r.token); saveProfile(r.user); toast({ title: d.autoApproved ? "Verified against HPCSA" : "Account created", description: d.message }); onIn(r.user);
    } catch (x: any) { setErr(messageOf(x)); } finally { setBusy(false); } };
  return <div className="max-w-md mx-auto space-y-5">
    <div className="flex gap-1 rounded-md border p-1">{(["login", "signup"] as const).map((mm) => <button key={mm} onClick={() => { setMode(mm); setErr(""); }} className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${mode === mm ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{mm === "login" ? "Sign in" : "Create account"}</button>)}</div>
    {mode === "login" ? <form className="space-y-3" onSubmit={doLogin}>
      <Field label="Username"><Input value={u} onChange={(e) => setU(e.target.value)} required data-testid="input-portal-username" autoComplete="username" /></Field>
      <Field label="Password"><Input type="password" value={p} onChange={(e) => setP(e.target.value)} required data-testid="input-portal-password" autoComplete="current-password" /></Field>
      {err && <p className="text-sm text-destructive">{err}</p>}<Button className="w-full" disabled={busy} data-testid="button-portal-login">{busy ? "Signing in..." : "Sign in"}</Button>
    </form> : <form className="space-y-3" onSubmit={doSignup}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Full name *"><Input value={su.name} onChange={setS("name")} required /></Field>
        <Field label="Profession *"><Select value={su.profession} onValueChange={(v) => setSu({ ...su, profession: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="doctor">Doctor</SelectItem><SelectItem value="nurse">Nurse</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></Field>
        <Field label="Email *"><Input type="email" value={su.email} onChange={setS("email")} required /></Field>
        <Field label="Cellphone *"><Input type="tel" value={su.phone} onChange={setS("phone")} required placeholder="082 123 4567" /></Field>
        <Field label="Hospital / facility *"><Input value={su.hospital} onChange={setS("hospital")} required /></Field>
        <Field label="Department / ward"><Input value={su.department} onChange={setS("department")} /></Field>
        <Field label="Specialty *"><Input value={su.specialty} onChange={setS("specialty")} required placeholder="e.g. Emergency Medicine" /></Field>
        <Field label="HPCSA reg no. (optional)" hint="Auto-verifies you if it matches the HPCSA register."><Input value={su.hpcsa} onChange={setS("hpcsa")} placeholder="MP 0123456" /></Field>
        <Field label="Username *"><Input value={su.username} onChange={(e) => setSu({ ...su, username: e.target.value.toLowerCase().replace(/\s/g, "") })} required placeholder="3-30 letters/numbers" /></Field>
        <Field label="Password *"><Input type="password" value={su.password} onChange={setS("password")} required placeholder="10+ characters" /></Field>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}<Button className="w-full" disabled={busy} data-testid="button-portal-signup">{busy ? "Creating..." : "Create account"}</Button>
      <p className="text-xs text-muted-foreground">Your details are stored so future consults auto-fill. No HPCSA number? Upload a staff card after signing up and the owner will verify you.</p>
    </form>}
  </div>;
}

/* ---------- dashboard ---------- */
function Dashboard({ me, onLogout, onRefresh, initialTeam }: { me: any; onLogout: () => void; onRefresh: () => void; initialTeam?: string }) {
  const [tab, setTab] = useState<"consults" | "roster" | "new">(initialTeam ? "new" : "consults");
  const [openId, setOpenId] = useState<number | null>(null);
  const { data: list = [], isLoading } = useQuery<Referral[]>({ queryKey: ["/api/referrer/my-referrals"], refetchInterval: 20000 });
  const verified = me.verifyStatus === "verified";
  return <div className="max-w-4xl mx-auto space-y-5">
    <div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><div><p className="font-semibold">{me.name}</p><p className="text-xs text-muted-foreground">{me.hospital} · {me.specialty} · {me.profession}</p></div></div>
      <Badge className={verified ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"}>{verified ? "Verified" : "Verification pending"}</Badge>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onLogout}><LogOut className="h-4 w-4 mr-1" />Sign out</Button></div>
    {!verified && <><CardUpload me={me} onUploaded={onRefresh} /><Button size="sm" variant="outline" onClick={onRefresh}>Check verification status</Button></>}
    <div className="flex gap-1 rounded-md border p-1 w-fit">{([["consults", "My consults", ClipboardList], ["new", "New consult", Send], ["roster", "On-call roster", CalendarDays]] as const).map(([t, l, I]) =>
      <button key={t} onClick={() => setTab(t as any)} className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><I className="h-4 w-4" />{l}</button>)}</div>
    {tab === "new" && (verified ? <ConsultForm me={me} initialTeam={initialTeam} onDone={() => setTab("consults")} /> : <Card className="p-5">Your account must be verified before you can send a referral. Upload your staff card above, then check your verification status.</Card>)}
    {tab === "roster" && <RosterView />}
    {tab === "consults" && <>
      {isLoading ? <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div> :
        list.length === 0 ? <Card className="p-10 text-center text-muted-foreground">No consults yet. Start one with New consult.</Card> :
        <div className="space-y-2">{list.map((r) => <Card key={r.id} onClick={() => setOpenId(r.id)} className={`p-4 cursor-pointer hover-elevate flex gap-3 items-start ${r.priority === "P1" && r.status === "pending" ? "border-l-4 border-l-red-600" : ""}`}>
          <span className={`rounded px-2 py-1 text-xs font-bold ${pColor[r.priority]}`}>{r.priority}</span>
          <div className="flex-1 min-w-0"><div className="flex flex-wrap gap-x-2 items-center"><span className="font-semibold">{r.diagnosis}</span><span className="font-mono text-xs text-muted-foreground">{r.ref}</span></div>
            <p className="text-sm text-muted-foreground">{r.team || "Unassigned"} · {r.consultType === "advice" ? "Advice only" : "Transfer"} · {ago(r.createdAt)}</p></div>
          <Badge className={sColor[r.status]}>{sLabel[r.status]}</Badge></Card>)}</div>}
      {openId && <ReferralDetail r={list.find((x) => x.id === openId)!} onClose={() => setOpenId(null)} />}
    </>}
  </div>;
}

/* ---------- root: restore session from localStorage, else auth ---------- */
export function Portal({ initialTeam }: { initialTeam?: string } = {}) {
  const [me, setMe] = useState<any | null>(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const tk = localStorage.getItem(TK);
    if (!tk) return setRestored(true);
    session.token = tk;
    apiRequest("GET", "/api/referrer/profile").then((r) => r.json()).then((d) => {
      session.token = tk; saveProfile(d.profile); setMe(d.profile);
    }).catch(() => { clearAuth(); session.token = ""; }).finally(() => setRestored(true));
  }, []);
  const refresh = () => { apiRequest("GET", "/api/referrer/profile").then((r) => r.json()).then((d) => { saveProfile(d.profile); setMe(d.profile); }).catch(() => {}); };
  const logout = () => { apiRequest("POST", "/api/me/logout").catch(() => {}); clearAuth(); session.token = ""; setMe(null); };
  if (!restored) return <div className="py-16 flex justify-center"><Skeleton className="h-6 w-40" /></div>;
  return me ? <Dashboard me={me} onLogout={logout} onRefresh={refresh} initialTeam={initialTeam} /> : <PortalAuth onIn={setMe} />;
}
