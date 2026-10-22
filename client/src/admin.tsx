import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Check, X } from "lucide-react";
import type { User, AuditRow, AppSettings } from "@shared/schema";
import { TeamSelect } from "./workflows";

const errMsg = (e: any) => { const m = String(e?.message || ""); try { return JSON.parse(m.replace(/^\d+:\s*/, "")).message; } catch { return m.replace(/^\d+:\s*/, "") || "Something went wrong"; } };
const tempPw = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; const b = new Uint32Array(12); crypto.getRandomValues(b); return Array.from(b, x => a[x % a.length]).join(""); };

function Users({ me }: { me: User }) {
  const { data = [], isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] }); const { toast } = useToast();
  const fresh=():{username:string;name:string;role:string;team:string;phone:string;password:string}=>({username:"",name:"",role:"clinician",team:me.team||"MEU",phone:"",password:tempPw()});
  const [f, setF] = useState(fresh); const [shown, setShown] = useState<string | null>(null);
  const inv = () => queryClient.invalidateQueries({ queryKey: ["/api/users"] });
  const add = useMutation({ mutationFn: async () => (await apiRequest("POST", "/api/users", f)).json(), onSuccess: () => { setShown(`${f.username} / ${f.password}`); setF(fresh()); inv(); }, onError: (e) => toast({ title: errMsg(e), variant: "destructive" }) });
  const upd = useMutation({ mutationFn: async ({ id, ...b }: any) => apiRequest("PATCH", `/api/users/${id}`, b), onSuccess: inv, onError: (e) => toast({ title: errMsg(e), variant: "destructive" }) });
  const reset = (u: User) => { const pw = tempPw(); upd.mutate({ id: u.id, password: pw }, { onSuccess: () => { setShown(`${u.username} / ${pw}`); inv(); } }); };
  return <div className="space-y-4">
    <Card className="p-4 space-y-3"><p className="font-semibold text-sm">Add a team member</p>
      <form className="grid sm:grid-cols-5 gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="space-y-1"><Label className="text-xs">Full name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dr T Hendricks" required data-testid="input-new-name" /></div>
        <div className="space-y-1"><Label className="text-xs">Username</Label><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, "") })} placeholder="thendricks" required data-testid="input-new-username" /></div>
        <div className="space-y-1"><Label className="text-xs">Role</Label><Select value={f.role} onValueChange={(v) => setF({ ...f, role: v })} disabled={me.role!=="admin"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="clinician">Team member</SelectItem><SelectItem value="unit_admin">Unit admin / consultant</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">Unit</Label>{me.role==="admin"?<TeamSelect value={f.team} onChange={team=>setF({...f,team})}/>:<p className="text-sm py-2">{me.team}</p>}</div>
        <div className="space-y-1"><Label className="text-xs">Contact number</Label><Input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})} type="tel"/></div>
        <div className="space-y-1"><Label className="text-xs">Temporary password</Label><Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="font-mono" /></div>
        <Button disabled={add.isPending} data-testid="button-add-user">Add</Button></form>
      {shown && <div className="rounded-md bg-amber-50 dark:bg-amber-950 p-3 text-sm flex flex-wrap gap-2 items-center"><span>Give this to the person privately (in person or by phone, not in a group chat). They must change it on first sign-in:</span><span className="font-mono font-semibold" data-testid="text-temp-pw">{shown}</span><Button size="sm" variant="ghost" onClick={() => setShown(null)}>Done</Button></div>}
    </Card>
    {isLoading ? <Skeleton className="h-40" /> : <Card className="divide-y">{data.map(u => <div key={u.id} className="p-3 flex flex-wrap gap-3 items-center">
      <div className="flex-1 min-w-[180px]"><p className="font-medium">{u.name} {!u.active && <Badge variant="outline" className="ml-1">Deactivated</Badge>}{u.mustChange && u.active && <Badge variant="outline" className="ml-1">Temp password</Badge>}</p><p className="text-xs text-muted-foreground">{u.username} · {u.role==="admin"?"Global admin":u.role==="unit_admin"?"Unit admin":"Team member"} · {u.team||"No unit"} · last sign-in {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "never"}</p></div>
      {me.role==="admin"&&u.role!=="admin"&&<><div className="w-52"><TeamSelect value={u.team||""} onChange={team=>upd.mutate({id:u.id,team})}/></div><Select value={u.role} onValueChange={(v) => upd.mutate({ id: u.id, role: v })}><SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="clinician">Team member</SelectItem><SelectItem value="unit_admin">Unit admin</SelectItem></SelectContent></Select></>}
      {u.role!=="admin"&&(me.role==="admin"||u.role==="clinician")&&<><Button size="sm" variant="outline" onClick={() => reset(u)}>Reset password</Button>
      {u.id !== me.id && <Button size="sm" variant={u.active ? "outline" : "default"} onClick={() => upd.mutate({ id: u.id, active: !u.active })}>{u.active ? "Deactivate" : "Reactivate"}</Button>}</>}
    </div>)}</Card>}
    <p className="text-xs text-muted-foreground">Deactivate people as soon as they leave the rotation. Deactivating or resetting a password signs them out everywhere.</p>
  </div>;
}

const ACT: Record<string, string> = { view_referral: "Viewed case", update_referral: "Updated case", shared_whatsapp: "Shared via WhatsApp", referral_submitted: "Referral submitted", login: "Signed in", logout: "Signed out", login_failed: "Failed sign-in", password_changed: "Changed password", user_created: "Created user", user_updated: "Updated user", settings_changed: "Changed settings", export_referral: "Exported case", delete_referral: "Deleted case", retention_purge: "Automatic purge", retention_purge_manual: "Manual purge" };
function Audit() {
  const { data = [], isLoading } = useQuery<AuditRow[]>({ queryKey: ["/api/audit"], refetchInterval: 30000 }); const [q, setQ] = useState("");
  const rows = data.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return <div className="space-y-3"><div className="flex justify-between gap-3 items-center"><p className="text-sm text-muted-foreground">Append-only record of who accessed or changed what. Latest 500 events.</p><Input className="max-w-xs" placeholder="Filter by name, action, ref" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    {isLoading ? <Skeleton className="h-60" /> : <Card className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="p-2">When</th><th className="p-2">Who</th><th className="p-2">Action</th><th className="p-2">Details</th><th className="p-2">IP</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id} className="border-b last:border-0 align-top"><td className="p-2 whitespace-nowrap tabular-nums">{new Date(r.at).toLocaleString()}</td><td className="p-2">{r.userName || "—"}</td><td className="p-2 whitespace-nowrap">{ACT[r.action] || r.action}</td><td className="p-2 text-muted-foreground">{r.detail}{r.referralId ? ` (#${r.referralId})` : ""}</td><td className="p-2 font-mono text-xs text-muted-foreground">{r.ip}</td></tr>)}</tbody></table></Card>}</div>;
}

function Data() {
  const { data: s } = useQuery<AppSettings>({ queryKey: ["/api/settings"] }); const { toast } = useToast();
  const [f, setF] = useState<Partial<AppSettings>>({}); const v = { ...s, ...f } as AppSettings;
  const save = useMutation({ mutationFn: async () => (await apiRequest("PUT", "/api/settings", f)).json(), onSuccess: () => { setF({}); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); queryClient.invalidateQueries({ queryKey: ["/api/privacy"] }); toast({ title: "Saved" }); }, onError: (e) => toast({ title: errMsg(e), variant: "destructive" }) });
  const purge = useMutation({ mutationFn: async () => (await apiRequest("POST", "/api/purge")).json(), onSuccess: (r) => { queryClient.invalidateQueries({ queryKey: ["/api/referrals"] }); toast({ title: `${r.purged} referral(s) purged` }); } });
  const [ref, setRef] = useState(""); const { data: list = [] } = useQuery<any[]>({ queryKey: ["/api/referrals"] });
  const target = list.find(r => r.ref.toUpperCase() === ref.trim().toUpperCase());
  const exp = async () => { if (!target) return; const j = await (await apiRequest("GET", `/api/referrals/${target.id}/export`)).json(); const b = new Blob([JSON.stringify(j, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${target.ref}.json`; a.click(); };
  const del = useMutation({ mutationFn: async () => apiRequest("DELETE", `/api/referrals/${target.id}`), onSuccess: () => { setRef(""); queryClient.invalidateQueries({ queryKey: ["/api/referrals"] }); toast({ title: "Referral deleted" }); } });
  if (!s) return <Skeleton className="h-60" />;
  const F = (k: keyof AppSettings, label: string, type = "text") => <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type={type} value={String(v[k] ?? "")} onChange={(e) => setF({ ...f, [k]: type === "number" ? Number(e.target.value) : e.target.value })} data-testid={`input-${k}`} /></div>;
  return <div className="space-y-4">
    <Card className="p-4 space-y-3"><p className="font-semibold text-sm">Privacy notice details</p><p className="text-xs text-muted-foreground">Shown on the public privacy notice and referral form. Your hospital's Information Officer must be named.</p>
      <div className="grid sm:grid-cols-2 gap-3">{F("responsibleParty", "Responsible party (hospital)")}{F("infoOfficer", "Information Officer name")}{F("infoOfficerEmail", "Information Officer email", "email")}{F("infoOfficerPhone", "Information Officer phone")}</div></Card>
    <Card className="p-4 space-y-3"><p className="font-semibold text-sm">Retention</p>
      <div className="grid sm:grid-cols-3 gap-3 items-end">{F("retentionDays", "Delete clinical details after (days)", "number")}<Button variant="outline" onClick={() => purge.mutate()} disabled={purge.isPending}>Run purge now</Button></div>
      <p className="text-xs text-muted-foreground">Runs automatically every hour. Purging removes patient initials, age, sex, folder number, diagnosis, history, exam, investigations, notes and location; keeps reference, facilities, dates and outcome for audit.</p></Card>
    {Object.keys(f).length > 0 && <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-settings">Save changes</Button>}
    <Card className="p-4 space-y-3"><p className="font-semibold text-sm">Access and deletion requests</p><p className="text-xs text-muted-foreground">For a POPIA request from a patient or referring clinician. Export gives the record plus its access log.</p>
      <div className="flex flex-wrap gap-2 items-center"><Input className="w-40 font-mono" placeholder="TX-XXXXXXX" value={ref} onChange={(e) => setRef(e.target.value)} />
        <Button variant="outline" disabled={!target} onClick={exp}>Export</Button>
        <Button variant="destructive" disabled={!target || del.isPending} onClick={() => { if (confirm(`Permanently delete ${target.ref}? This cannot be undone.`)) del.mutate(); }}>Delete</Button>
        {ref && !target && <span className="text-xs text-muted-foreground">No match</span>}{target && <span className="text-xs text-muted-foreground">{target.hospital} · {new Date(target.createdAt).toLocaleDateString()}</span>}</div></Card>
  </div>;
}

function Referrers() {
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/pending-referrers"], refetchInterval: 30000 });
  const { toast } = useToast();
  const [cardId, setCardId] = useState<number | null>(null);
  const [cardData, setCardData] = useState<string | null>(null);
  const act = (id: number, action: "approve" | "reject") => useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/pending-referrers/${id}/${action}`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/pending-referrers"] }); toast({ title: action === "approve" ? "Referrer verified" : "Referrer rejected" }); },
    onError: (e) => toast({ title: errMsg(e), variant: "destructive" }),
  });
  const approve = (id: number) => act(id, "approve").mutate();
  const reject = (id: number) => act(id, "reject").mutate();
  const viewCard = async (id: number) => {
    setCardId(id); setCardData(null);
    try { const d = await (await apiRequest("GET", `/api/pending-referrers/${id}/card`)).json(); setCardData(d.data); }
    catch (e) { setCardData(null); toast({ title: errMsg(e), variant: "destructive" }); }
  };
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Referral-PWA accounts that could not be auto-verified against the HPCSA register. Review the staff card, then verify or reject.</p>
    {isLoading ? <Skeleton className="h-40" /> : data.length === 0 ? <Card className="p-8 text-center text-muted-foreground">No pending referrers. New sign-ups that don't match HPCSA appear here.</Card> :
      <Card className="divide-y">{data.map((r) => <div key={r.id} className="p-4 flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[220px]"><p className="font-medium">{r.name} {r.hasCard && <Badge variant="outline" className="ml-1">Card on file</Badge>}</p>
          <p className="text-xs text-muted-foreground">{r.profession} · {r.email} · {r.phone}</p>
          {r.hpcsa && <p className="text-xs text-muted-foreground">HPCSA {r.hpcsa}</p>}</div>
        <div className="flex gap-2">
          {r.hasCard && <Button size="sm" variant="outline" onClick={() => viewCard(r.id)}>View card</Button>}
          <Button size="sm" onClick={() => approve(r.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Check className="h-4 w-4 mr-1" />Verify</Button>
          <Button size="sm" variant="destructive" onClick={() => reject(r.id)}><X className="h-4 w-4 mr-1" />Reject</Button>
        </div></div>)}</Card>}
    <Sheet open={cardId !== null} onOpenChange={(o) => { if (!o) { setCardId(null); setCardData(null); } }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto"><SheetHeader><SheetTitle>Staff card</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-2">{cardData ? <img src={`data:image/jpeg;base64,${cardData}`} alt="Referrer staff card" className="max-h-[70vh] rounded border" /> : cardId === null ? null : <p className="text-sm text-muted-foreground">Loading…</p>}</div>
      </SheetContent></Sheet>
  </div>;
}

export function Admin({ me }: { me: User }) {
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Admin</h1>
    <p className="text-sm text-muted-foreground">{me.role==="admin"?"Global administrator: access to every unit.":"Unit administrator: manage team members in "+me.team+". Daily roster changes are under On call."}</p>
    <Tabs defaultValue="users"><TabsList><TabsTrigger value="users">Users</TabsTrigger>{me.role==="admin"&&<><TabsTrigger value="referrers">Referrers</TabsTrigger><TabsTrigger value="audit">Audit log</TabsTrigger><TabsTrigger value="data">Privacy and data</TabsTrigger></>}</TabsList>
      <TabsContent value="users" className="mt-4"><Users me={me} /></TabsContent>{me.role==="admin"&&<><TabsContent value="referrers" className="mt-4"><Referrers /></TabsContent><TabsContent value="audit" className="mt-4"><Audit /></TabsContent><TabsContent value="data" className="mt-4"><Data /></TabsContent></>}</Tabs></div>;
}
