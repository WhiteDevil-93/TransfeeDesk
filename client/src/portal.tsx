import { lazy, Suspense, useLayoutEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./lib/queryClient";
import { Link } from "wouter";
import { useAuth } from "./auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Phone, MessageCircle, LogOut, CalendarDays, ClipboardList, Send, User as UserIcon } from "lucide-react";
import { PriorityPill, SectionHeading } from "./components/clinical-ui";
import { ReferrerAuth } from "./referrer-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ImagePicker, Images, Timeline, messageOf, type UploadImage } from "./workflows";
import type { Referral, Status, RosterSpec, RosterContact } from "@shared/schema";

const ConsultForm = lazy(() => import("./referral-form").then(module => ({ default: module.ConsultForm })));

/* ---------- shared display helpers (kept local to the PWA) ---------- */
const sLabel: Record<Status, string> = { pending: "Awaiting review", accepted: "Accepted for transfer", declined: "Declined", waiting: "Waiting", advised: "Advice sent" };
const sColor: Record<Status, string> = {
  pending: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  accepted: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  declined: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  waiting: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  advised: "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100",
};
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
const waNum = (p: string) => { const d = p.replace(/\D/g, ""); return d.startsWith("0") ? "27" + d.slice(1) : d; };
const saToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);



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
  const { data, isLoading, error, refetch } = useQuery<{ specs: RosterSpec[]; hospital: string; generated: string }>({ queryKey: [`/api/referrer/roster?date=${date}`] });
  const specs = (data?.specs || []).filter((s) => !q || JSON.stringify(s).toLowerCase().includes(q.toLowerCase()));
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2 items-end justify-between"><div><h2 className="font-semibold">On-call roster</h2><p className="text-xs text-muted-foreground">{data?.hospital || ""} · built {data?.generated || "previously"}. Rosters change at short notice; confirm with the switchboard when in doubt.</p></div>
      <div className="flex gap-2"><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" /><Button variant="outline" size="sm" onClick={() => setDate(saToday())}>Today</Button></div></div>
    <Input placeholder="Search specialty or name" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
    {isLoading ? <p role="status">Loading on-call roster...</p> : error ? <Card className="p-5 space-y-3"><p role="alert">Couldn't load the roster. Try again or confirm with switchboard.</p><Button onClick={() => refetch()}>Try again</Button></Card> : specs.length === 0 ? <Card className="p-6 text-center text-muted-foreground">No roster for this date.</Card> :
      <div className="grid md:grid-cols-2 gap-3">{specs.map((s) => <Card key={s.id} className="p-4 space-y-2"><div className="flex justify-between gap-2"><p className="font-semibold">{s.name}</p><span className="text-xs text-muted-foreground">{s.group}</span></div>
        {s.entries.length === 0 ? <p className="text-sm text-muted-foreground">No roster for this date.</p> : s.entries.map((e, i) => <div key={i} className="text-sm border-t pt-2 first:border-0 first:pt-0"><p><span className="text-muted-foreground">{e.role}: </span><span className="font-medium">{e.text}</span></p>{e.contacts.map((c, j) => <div key={j}><RosterContactBtns c={c} /></div>)}</div>)}</Card>)}</div>}</div>;
}

/* ---------- read-only referral detail for the referrer ---------- */
function ReferralDetail({ r, onClose }: { r: Referral; onClose: () => void }) {
  const detailPath = `/api/referrer/referrals/${r.id}`;
  const { data: full, error, refetch } = useQuery<Referral & { timeline: any[] }>({ queryKey: [detailPath], staleTime: 0, refetchInterval: 15000 });
  const [body, setBody] = useState(""), [images, setImages] = useState<UploadImage[]>([]);
  const { toast } = useToast();
  const followup = useMutation({ mutationFn: () => apiRequest("POST", `${detailPath}/followup`, { body, images }), onSuccess: () => { setBody(""); setImages([]); refetch(); toast({ title: "Update sent to the receiving team" }); }, onError: e => toast({ title: messageOf(e), variant: "destructive" }) });
  const d: Referral & { timeline: any[] } = full || { ...r, timeline: [] };
  const { data: specs } = useSpecs();
  const Sec = ({ t, v }: any) => <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t}</p><p className="text-sm whitespace-pre-wrap">{v || "-"}</p></div>;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent aria-label="Referral details" className="max-w-2xl max-h-[92dvh] overflow-y-auto p-0 gap-0"><DialogHeader className="border-b px-5 py-4 pr-12 text-left"><DialogTitle className="text-base">Referral details <span className="ml-2 font-mono text-primary">{d.ref}</span></DialogTitle><DialogDescription>{d.team || "Unassigned"} · {new Date(d.createdAt).toLocaleString()}</DialogDescription></DialogHeader><div className="p-5 space-y-5">
      {error && <div role="alert" className="space-y-2"><p>Couldn't load the latest referral details. Information below may be incomplete.</p><Button variant="outline" onClick={() => refetch()}>Try again</Button></div>}
      <div className="bb-case-banner space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="bb-patient-initials">{d.patientInitials}<span className="ml-2 text-sm font-normal text-teal-100">{d.age} · {d.sex === "M" ? "Male" : "Female"}</span></p><p className="mt-2 text-sm text-teal-100">{d.team || "Unassigned"} · {d.consultType === "advice" ? "Advice-only consult" : "Transfer request"}</p></div><PriorityPill priority={d.priority}/></div><div className="border-t border-white/20 pt-3"><p className="text-xs text-teal-100">Current decision</p><p className="mt-1 text-lg font-bold">{sLabel[d.status]}</p></div></div>
      <div className="space-y-1 text-xs text-muted-foreground"><p>{d.openedAt ? `Opened by ${d.openedBy || "the receiving team"}, ${ago(d.openedAt)}` : "Not yet opened by the receiving team"}</p><p>An opened receipt is not acceptance for transfer.</p></div><p className="text-lg font-semibold leading-relaxed">{d.diagnosis}</p>
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">Original referral & clinical details</summary><div className="pt-4 space-y-4"><div className="grid grid-cols-2 gap-4">{d.specialty && <Sec t="Specialty" v={specName(specs, d.specialty)}/>}{d.bedNeeded && <Sec t="Bed needed" v={d.bedNeeded}/>}</div><Sec t="History" v={d.history}/><Sec t="Examination" v={d.exam}/><Sec t="Investigations" v={d.investigations}/><Sec t="Request" v={d.reason}/></div></details>
      {d.decisionNote && <Card className="p-3 border-primary space-y-1"><p className="text-xs font-semibold uppercase tracking-wide text-primary">Clinical advice / decision</p><p className="text-sm whitespace-pre-wrap">{d.decisionNote}</p>{d.decidedBy && <p className="text-xs text-muted-foreground">By {d.decidedBy}{d.decidedAt && `, ${ago(d.decidedAt)}`}</p>}</Card>}
      <Images images={d.images} imageBase={detailPath}/>
      <section aria-label="Updates and response history" className="space-y-3"><h2 className="font-semibold">Updates and response history</h2><Timeline entries={d.timeline} imageBase={detailPath}/></section>
      {!d.purgedAt && <form className="space-y-4 rounded-xl border bg-card p-4" onSubmit={e => { e.preventDefault(); followup.mutate(); }}><label htmlFor="referrer-update" className="text-sm font-semibold">Send an update or follow-up question</label><Textarea id="referrer-update" value={body} onChange={e => setBody(e.target.value)} placeholder="New findings, results or a question for the receiving team" minLength={2} maxLength={5000} required/><details className="text-sm"><summary className="cursor-pointer font-medium text-primary">Attach clinical images (optional)</summary><div className="pt-3"><ImagePicker images={images} onChange={setImages}/></div></details><Button className="w-full" disabled={followup.isPending || body.trim().length < 2}>{followup.isPending ? "Sending..." : "Send update to the team"}</Button></form>}
      <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
    </div></DialogContent></Dialog>;
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
  return <Card className="p-5 space-y-4 border-amber-200"><SectionHeading>{me?.hasCard ? "Card received · review pending" : "Verify your account"}</SectionHeading>
    <p className="text-sm leading-relaxed text-muted-foreground">{me?.hasCard ? "Your staff card has been received. An administrator needs to verify it before you can send referrals. Check the status below or use the on-call roster while you wait." : "Upload your staff card showing your name, facility and professional details. An administrator will review it. You can send referrals after verification."}</p>
    {img && <img src={`data:${mime};base64,${img}`} alt="Staff card preview" className="max-h-56 rounded border" />}
    <div className="space-y-3"><Input aria-label="Staff card photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => pick(e.target.files)} /><Button className="w-full sm:w-auto" onClick={send} disabled={busy || !img}>{busy ? "Sending..." : me?.hasCard ? "Replace staff card" : "Send staff card"}</Button></div>
    {err && <p className="text-sm text-destructive" role="alert">{err}</p>}</Card>;
}

/* ---------- dashboard ---------- */
function Dashboard({ me, onLogout, onRefresh, initialTeam, initialNew }: { me: any; onLogout: () => void; onRefresh: () => void; initialTeam?: string; initialNew?: boolean }) {
  const [tab, setTab] = useState<"consults" | "roster" | "new">(initialTeam || initialNew ? "new" : "consults");
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [tab]);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const { data: list = [], isLoading, error, refetch } = useQuery<Referral[]>({ queryKey: ["/api/referrer/my-referrals"], refetchInterval: 20000 });
  const isAdmin = me.role === "admin"; const verified = isAdmin || me.verifyStatus === "verified";
  const shown = list.filter(referral => !search || [referral.ref, referral.patientInitials, referral.diagnosis, referral.team].join(" ").toLowerCase().includes(search.toLowerCase()));
  return <div className="bb-referrer-workspace max-w-4xl mx-auto space-y-5">{isAdmin && <Card className="p-4 space-y-3"><p className="font-semibold">Global administrator · referral workspace</p><p className="text-sm text-muted-foreground">View all consults and use the referral form with your administrator account. Submissions are attributed to you.</p><div className="flex flex-wrap gap-4"><Link href="/queue" className="underline">Back to referral desk</Link><Link href="/admin" className="underline">Back to Admin</Link></div></Card>}
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"><div className="flex items-center gap-3"><span className="bb-role-icon h-10 w-10"><UserIcon className="h-5 w-5"/></span><div><p className="font-semibold">{me.name}</p><p className="text-xs text-muted-foreground">{[me.specialty, me.profession].filter(Boolean).join(" · ")}</p></div></div>
      <Badge className={verified ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"}>{isAdmin ? "Global administrator" : verified ? "Verified" : "Verification pending"}</Badge>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onLogout}><LogOut className="h-4 w-4 mr-1" />Sign out</Button></div>
    {!verified && <><CardUpload me={me} onUploaded={onRefresh} /><Button size="sm" variant="outline" onClick={onRefresh}>Check verification status</Button></>}
    <nav aria-label="Referrer workspace" className="bb-referrer-nav">{([["consults", isAdmin ? "All consults" : "My consults", ClipboardList], ["new", "New consult", Send], ["roster", "On-call roster", CalendarDays]] as const).map(([t, l, I]) =>
      <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t as any)}><I/>{l}</button>)}</nav>
    {tab === "new" && <Button variant="ghost" onClick={() => setTab("consults")}>{isAdmin ? "Back to all consults" : "Back to my consults"}</Button>}
    {tab === "new" && (verified ? <Suspense fallback={<p role="status">Loading referral form...</p>}><ConsultForm me={me} initialTeam={initialTeam} onDone={() => setTab("consults")} /></Suspense> : <Card className="p-5">Your account must be verified before you can send a referral. Upload your staff card above, then check your verification status.</Card>)}
    {tab === "roster" && <RosterView />}
    {tab === "consults" && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight">{isAdmin ? "All consults" : "My consults"}</h1><p className="mt-1 text-sm text-muted-foreground">Track referrals, clinical advice and transfer decisions.</p></div>{verified && <Button onClick={() => setTab("new")}><Plus/>New referral</Button>}</div>
      {list.length > 0 && <div className="relative"><Search className="absolute left-3 top-4 h-4 w-4 text-muted-foreground"/><Input aria-label="Search your consults" placeholder="Search initials, reference or diagnosis" className="pl-10" value={search} onChange={event => setSearch(event.target.value)}/></div>}
      {isLoading ? <p role="status">Loading your consults...</p> : error ? <Card className="p-5 space-y-3"><p role="alert">Couldn't load your consults. Check your connection and try again.</p><Button onClick={() => refetch()}>Try again</Button></Card> :
        list.length === 0 ? <Card className="p-6 space-y-3"><p>{verified ? "No consults yet. Create your first referral to request advice or a transfer." : "No consults yet. Your account must be verified before you can send one."}</p>{verified && <Button onClick={() => setTab("new")}>Start a new consult</Button>}</Card> :
        shown.length === 0 ? <Card className="p-6 space-y-3"><p>No consults match your search.</p><Button variant="outline" onClick={() => setSearch("")}>Clear search</Button></Card> : <div className="space-y-3">{shown.map((r) => <button type="button" key={r.id} onClick={() => setOpenId(r.id)} className={`w-full rounded-xl border bg-card p-5 text-left shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${r.priority === "P1" && r.status === "pending" ? "border-l-4 border-l-red-500" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><PriorityPill priority={r.priority}/><span className="font-mono text-xs text-muted-foreground">{r.ref} · {ago(r.createdAt)}</span></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="bb-patient-initials">{r.patientInitials}<span className="ml-2 text-sm font-normal text-muted-foreground">{r.age} · {r.sex === "M" ? "Male" : r.sex === "F" ? "Female" : r.sex}</span></p><Badge className={sColor[r.status]}>{sLabel[r.status]}</Badge></div>
          <p className="mt-3 font-semibold leading-relaxed">{r.diagnosis}</p><p className="mt-1 text-sm text-muted-foreground">{r.team || "Unassigned"} · {r.consultType === "advice" ? "Advice only" : "Transfer request"}</p>{r.decidedBy && <p className="mt-3 border-t pt-3 text-xs font-medium text-primary">Response from {r.decidedBy}</p>}
        </button>)}</div>}
      {openId && list.some(x => x.id === openId) && <ReferralDetail r={list.find((x) => x.id === openId)!} onClose={() => setOpenId(null)} />}
    </>}
  </div>;
}

/* ---------- root: one shared session for staff and referrers ---------- */
export function Portal({ initialTeam, initialNew }: { initialTeam?: string; initialNew?: boolean } = {}) {
  const { user, signOut, refreshUser } = useAuth();
  const { toast } = useToast();
  const refresh = () => { refreshUser().then(() => toast({ title: "Verification status refreshed" })).catch(e => toast({ title: messageOf(e), variant: "destructive" })); };
  if (user && user.role !== "referrer" && !(user.role === "admin" && !user.mustChange)) return <Card className="max-w-md mx-auto p-5 space-y-4"><h1 className="text-xl font-semibold">You're signed in as receiving staff</h1><p>The referral desk is where you review and manage incoming consults.</p><Link href="/queue" className="block underline font-medium">Continue to referral desk</Link><Button variant="outline" onClick={() => signOut("/portal")}>Switch to a referrer account</Button></Card>;
  return user ? <Dashboard key={`${initialTeam || "all"}:${initialNew ? "new" : "consults"}`} me={user} onLogout={() => signOut()} onRefresh={refresh} initialTeam={initialTeam} initialNew={initialNew} /> : <ReferrerAuth/>;
}
