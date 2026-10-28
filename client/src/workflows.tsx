import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select,SelectTrigger,SelectValue,SelectContent,SelectItem } from "@/components/ui/select";
import { TEAMS, TEAM_NAMES, type Team } from "@shared/teams";
import type { Followup,ImageAttachment,User } from "@shared/schema";
import { askNotify,notify } from "./alerts";

const PORTAL_HEADER="x-portal-token";
export const messageOf=(e:any)=>{ try { return JSON.parse(String(e.message).replace(/^\d+:\s*/,"")).message; } catch { return "Request failed. Please try again."; } };
export type UploadImage={name:string;mime:"image/jpeg";data:string};

export function TeamSelect({value,onChange,all=false,id,disabled}: {value:string;onChange:(v:string)=>void;all?:boolean;id?:string;disabled?:boolean}) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger id={id} data-testid="select-team"><SelectValue placeholder="Choose receiving unit" /></SelectTrigger>
    <SelectContent>{all && <SelectItem value="all">All units</SelectItem>}{TEAMS.map(t=><SelectItem value={t} key={t}>{t} · {TEAM_NAMES[t]}</SelectItem>)}</SelectContent></Select>;
}

export function ImagePicker({images,onChange}: {images:UploadImage[];onChange:(v:UploadImage[])=>void}) {
  const [busy,setBusy]=useState(false),[err,setErr]=useState("");
  async function choose(files:FileList|null) {
    setErr(""); if(!files) return; if(files.length+images.length>3) return setErr("Add up to 3 images per submission.");
    setBusy(true);
    try {
      const added:UploadImage[]=[];
      for(const file of Array.from(files)) {
        if(!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("Use JPEG, PNG or WebP images. HEIC/PDF/DICOM files are not supported.");
        if(file.size>12*1024*1024) throw new Error("Each source image must be under 12 MB.");
        const bitmap=await createImageBitmap(file); const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement("canvas"); canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale);
        const ctx=canvas.getContext("2d"); if(!ctx) throw new Error("Could not process image.");
        ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
        let data=canvas.toDataURL("image/jpeg",.92).split(",")[1];
        if(data.length>2700000) data=canvas.toDataURL("image/jpeg",.75).split(",")[1];
        if(data.length>2700000) throw new Error("Image too large after processing. Please crop it first.");
        added.push({name:`clinical-image-${images.length+added.length+1}.jpg`,mime:"image/jpeg",data});
      }
      onChange([...images,...added]);
    } catch(e:any) { setErr(e.message || "Unable to process image."); } finally { setBusy(false); }
  }
  return <div className="space-y-2"><Label>Clinical images (optional)</Label>
    <Input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} data-testid="input-images" onChange={e=>{choose(e.target.files);e.target.value="";}} />
    <p className="text-xs text-muted-foreground">Up to 3 images, stored privately with this case. Crop out names, ID numbers and faces. Images are resized and metadata is removed; they are not a replacement for original diagnostic imaging.</p>
    {busy && <p className="text-xs">Processing images…</p>}{err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    <div className="flex gap-2 flex-wrap">{images.map((im,i)=><div key={i} className="w-24"><img src={`data:image/jpeg;base64,${im.data}`} className="w-24 h-20 object-cover rounded border" alt={`Image ${i+1} preview`} /><Button type="button" size="sm" variant="ghost" onClick={()=>onChange(images.filter((_,j)=>j!==i))}>Remove</Button></div>)}</div>
  </div>;
}

export function Images({images,referralId,portalToken,imageBase}: {images?:ImageAttachment[];referralId?:number;portalToken?:string;imageBase?:string}) {
  const [loaded,setLoaded]=useState<Record<number,string>>({}),[err,setErr]=useState("");
  async function load(im:ImageAttachment) {
    try { const r=await (portalToken ? apiRequest("POST",`/api/portal/image/${im.id}`,undefined,{headers:{[PORTAL_HEADER]:portalToken!}}) : apiRequest("GET",`${imageBase || `/api/referrals/${referralId}`}/images/${im.id}`));
      const d=await r.json();setLoaded(x=>({...x,[im.id]:`data:${d.mime};base64,${d.data}`})); } catch(e) {setErr(messageOf(e));}
  }
  return <div className="space-y-2">{images?.map(im=><div key={im.id} className="border rounded p-2">
    {loaded[im.id] ? <><img src={loaded[im.id]} alt="Clinical attachment" className="max-w-full max-h-[520px] object-contain mx-auto" /><Button variant="ghost" size="sm" onClick={()=>setLoaded(x=>{const n={...x};delete n[im.id];return n;})}>Hide image</Button></> : <Button size="sm" variant="outline" onClick={()=>load(im)}>View image · {im.name}</Button>}
  </div>)}{err && <p className="text-sm text-destructive">{err}</p>}</div>;
}

export function Timeline({entries,referralId,portalToken,imageBase}: {entries?:Followup[];referralId?:number;portalToken?:string;imageBase?:string}) {
  return <div className="space-y-3">{entries?.map(e=><Card key={e.id} className={`p-3 space-y-2 ${e.kind==="advice" ? "border-primary" : ""}`}>
    <div className="flex justify-between flex-wrap gap-1 text-xs"><span className="font-semibold">{e.kind==="advice"?"Clinical advice":e.kind==="decision"?"Decision":"Clinical update"} · {e.author}</span><span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span></div>
    <p className="text-sm whitespace-pre-wrap">{e.body}</p><Images images={e.images} referralId={referralId} portalToken={portalToken} imageBase={imageBase} />
  </Card>)}</div>;
}

export function ReferrerPortal({initialRef="",initialCode=""}: {initialRef?:string;initialCode?:string}) {
  const [ref,setRef]=useState(initialRef),[code,setCode]=useState(initialCode);
  const [token,setToken]=useState(""),[active,setActive]=useState(false),[opening,setOpening]=useState(false);
  const tokenRef=useRef("");
  const [data,setData]=useState<any>(null),[err,setErr]=useState(""),[body,setBody]=useState(""),[images,setImages]=useState<UploadImage[]>([]),[busy,setBusy]=useState(false),[sent,setSent]=useState(false);
  const last=useRef<{opened:string|null;count:number}|null>(null);
  const ENDED=410;
  const endSession=(message:string)=>{tokenRef.current="";setToken("");setActive(false);setData(null);last.current=null;setErr(message);};
  const apply=(d:any)=>{
    if(last.current && !last.current.opened && d.openedAt) notify("Referral opened",`${d.ref} was opened by the receiving team`,"opened-"+d.ref);
    if(last.current && d.timeline.length>last.current.count && d.timeline.at(-1)?.kind!=="update") notify("Referral response",`A response is available for ${d.ref}`,"response-"+d.ref);
    last.current={opened:d.openedAt,count:d.timeline.length};
    tokenRef.current=d.portalToken;setToken(d.portalToken);setData(d);setErr("");
  };
  const withToken=()=>({headers:{[PORTAL_HEADER]:tokenRef.current}});
  const ended=(e:any)=>String(e?.message||"").startsWith(String(ENDED));
  async function open(refValue:string,codeValue:string) {
    setOpening(true);setErr("");last.current=null;
    try { apply(await (await apiRequest("POST","/api/portal",{ref:refValue.trim().toUpperCase(),code:codeValue.trim()})).json());setActive(true);setCode(""); }
    catch(e){setErr(messageOf(e));} finally{setOpening(false);}
  }
  useEffect(()=>{ if(initialRef && initialCode) open(initialRef,initialCode); },[]);
  useEffect(()=>{
    if(!active) return; let alive=true;
    const refresh=async()=>{
      try { const d=await (await apiRequest("POST","/api/portal",undefined,withToken())).json(); if(alive) apply(d); }
      catch(e) { if(!alive) return; if(ended(e)) endSession(messageOf(e)); else setErr(messageOf(e)); }
    };
    const t=setInterval(refresh,20000);return()=>{alive=false;clearInterval(t);};
  },[active]);
  async function submit(e:any) {
    e.preventDefault();setBusy(true);setErr("");setSent(false);
    try {await apiRequest("POST","/api/portal/followup",{body,images},withToken());setBody("");setImages([]);setSent(true);
      apply(await(await apiRequest("POST","/api/portal",undefined,withToken())).json());
    } catch(e){ if(ended(e)) endSession(messageOf(e)); else setErr(messageOf(e)); } finally{setBusy(false);}
  }
  return <div className="max-w-2xl mx-auto space-y-4">
    <h1 className="text-xl font-semibold">Follow up a referral</h1>
    <p className="text-sm text-muted-foreground">Use the reference and private follow-up code from your receipt. This portal shows opened receipts, advice and responses, and accepts new clinical information.</p>
    {!active && <form className="space-y-3" onSubmit={e=>{e.preventDefault();open(ref,code);}}>
      <Input value={ref} onChange={e=>setRef(e.target.value)} placeholder="Referral reference" aria-label="Referral reference" required data-testid="input-portal-ref" />
      <Input value={code} onChange={e=>setCode(e.target.value)} placeholder="Private follow-up code" aria-label="Private follow-up code" type="password" autoComplete="off" required data-testid="input-portal-code" />
      <Button disabled={opening} data-testid="button-portal-open">{opening?"Opening…":"Open referral"}</Button>
    </form>}
    {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
    {active && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>askNotify()}>Enable opened / response notifications</Button><Button size="sm" variant="ghost" onClick={()=>endSession("")}>Close portal</Button></div>}
    {data && <>
      <Card className="p-4 space-y-2"><p className="font-mono font-semibold">{data.ref} · {data.team} · {data.status}</p>
        <p className="text-sm" data-testid="text-opened">{data.openedAt ? `Opened by ${data.openedBy}, ${new Date(data.openedAt).toLocaleString()}` : "Not yet opened by the receiving team"}</p>
        {data.decidedBy && <p className="text-xs text-muted-foreground">Responded by {data.decidedBy}, {new Date(data.decidedAt).toLocaleString()}</p>}
        <p className="text-xs text-muted-foreground">An opened receipt does not mean the referral has been accepted. This page refreshes every 20 seconds; browser notifications require it to remain open. The session ends after 30 minutes without a refresh, and you then enter the code again.</p>
      </Card>
      <Images images={data.images} portalToken={token} /><Timeline entries={data.timeline} portalToken={token} />
      <Card className="p-4"><form onSubmit={submit} className="space-y-3"><Label htmlFor="portal-followup">Follow-up / new clinical information</Label>
        <Textarea id="portal-followup" value={body} onChange={e=>setBody(e.target.value)} rows={4} minLength={2} maxLength={5000} required placeholder="New examination findings, investigations, deterioration or a follow-up question" data-testid="input-followup" />
        <ImagePicker images={images} onChange={setImages}/><Button disabled={busy} data-testid="button-followup-send">{busy?"Sending…":"Send follow-up to the team"}</Button>
        {sent && <p className="text-sm text-primary" role="status">Update sent. The team will see it marked as new.</p>}
      </form></Card>
    </>}
  </div>;
}

export function UnitRoster({me}: {me:User}) {
  const [team,setTeam]=useState(me.team||"MEU"),[day,setDay]=useState(new Date(Date.now()+2*3600000).toISOString().slice(0,10));
  const [entries,setEntries]=useState<{userId:number;duty:string}[]>([]),[err,setErr]=useState(""),[busy,setBusy]=useState(false);
  const {data:members=[]}=useQuery<User[]>({queryKey:[`/api/unit-members?team=${team}`]});
  const key=`/api/unit-roster?team=${team}&day=${day}`;
  const {data:roster}=useQuery<any>({queryKey:[key]});
  useEffect(()=>{if(roster)setEntries(roster.entries);},[roster]);
  const editable=me.role!=="clinician";
  async function save(){setBusy(true);setErr("");try{await apiRequest("PUT","/api/unit-roster",{team,day,entries});await queryClient.invalidateQueries({queryKey:[key]});}catch(e){setErr(messageOf(e));}finally{setBusy(false);}}
  return <Card className="p-4 space-y-3"><h2 className="font-semibold">Unit duty roster</h2><div className="flex gap-2 flex-wrap">
    {me.role==="admin"?<div className="w-64"><TeamSelect value={team} onChange={v=>setTeam(v as Team)}/></div>:<span className="font-medium self-center">{team} · {TEAM_NAMES[team as Team]}</span>}
    <Input className="w-40" type="date" value={day} onChange={e=>setDay(e.target.value)}/>
  </div>
  {entries.map((e,i)=><div className="flex gap-2 flex-wrap" key={i}>
    {editable?<><Select value={String(e.userId||"")} onValueChange={v=>setEntries(x=>x.map((a,j)=>j===i?{...a,userId:Number(v)}:a))}><SelectTrigger className="w-60"><SelectValue placeholder="Select team member"/></SelectTrigger><SelectContent>{members.filter(m=>m.team===team).map(m=><SelectItem value={String(m.id)} key={m.id}>{m.name}</SelectItem>)}</SelectContent></Select>
    <Input className="flex-1 min-w-32" value={e.duty} placeholder="Duty / shift (e.g. night registrar)" onChange={ev=>setEntries(x=>x.map((a,j)=>j===i?{...a,duty:ev.target.value}:a))}/>
    <Button variant="ghost" onClick={()=>setEntries(x=>x.filter((_,j)=>j!==i))}>Remove</Button></>:
    <p className="text-sm">{members.find(m=>m.id===e.userId)?.name||((e as any).name)||"Former team member"} · {e.duty} {(members.find(m=>m.id===e.userId)?.phone || (e as any).phone)&&<a className="underline ml-2" href={`tel:${members.find(m=>m.id===e.userId)?.phone || (e as any).phone}`}>Call</a>}</p>}
  </div>)}
  {!entries.length && <p className="text-sm text-muted-foreground">No unit roster entries for this date.</p>}
  {editable && <div className="flex gap-2"><Button variant="outline" onClick={()=>setEntries(x=>[...x,{userId:0,duty:""}])}>Add duty</Button><Button onClick={save} disabled={busy}>{busy?"Saving…":"Save daily roster"}</Button></div>}
  {err&&<p role="alert" className="text-sm text-destructive">{err}</p>}{roster?.updated_by && <p className="text-xs text-muted-foreground">Last changed by {roster.updated_by}, {new Date(roster.updated_at).toLocaleString()}</p>}
  </Card>;
}
