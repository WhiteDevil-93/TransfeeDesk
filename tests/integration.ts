import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import ws from "ws";
import { createClient } from "@supabase/supabase-js";
import { db } from "../server/db";
const B=process.env.TEST_BASE||"http://127.0.0.1:5000";
const sb=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false},realtime:{transport:ws as any},global:{headers:{"x-app-secret":process.env.APP_DB_SECRET!}}});
const createdUsers:number[]=[],createdCases:number[]=[];
const run=crypto.randomBytes(4).toString("hex"),password=crypto.randomBytes(20).toString("hex");
const creds:any={};
async function api(method:string,path:string,body?:any,token?:string,expected=200){
  const r=await fetch(B+path,{method,headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});
  const text=await r.text(); assert.equal(r.status,expected,`${method} ${path}: ${r.status} ${text.slice(0,200)}`);
  return text ? JSON.parse(text) : null;
}
async function login(username:string){
  const r=await api("POST","/api/login",{username,password});
  await api("POST","/api/me/password",{current:password,next:password+"x"},r.token);
  return r.token;
}
async function cleanup(){
  for(const id of createdCases) await sb.from("referrals").delete().eq("id",id);
  for(const id of createdUsers) {await sb.from("sessions").delete().eq("user_id",id);await sb.from("users").delete().eq("id",id);}
}
try {
  const root=await db.addUser("qa_root_"+run,"QA global admin","admin",password); createdUsers.push(root.id);
  const rootToken=await login(root.username); creds.root={username:root.username,password:password+"x",token:rootToken};
  await api("GET","/api/referrals",undefined,undefined,401);
  const referrer=await db.addReferrer({username:"qa_referrer_"+run,name:"QA Referrer",password,email:`qa-${run}@example.invalid`,phone:"0700000000",hospital:"QA Facility",department:"ED",specialty:"other",profession:"doctor",hpcsa:""});
  createdUsers.push(referrer.id);
  await db.approveReferrer(referrer.id,"QA global admin");
  const referrerToken=await api("POST","/api/login",{username:referrer.username,password}).then(r=>r.token);
  for(const team of ["MEU","TEU","SEU"]){
    creds[team]={};
    for(const role of ["unit_admin","clinician"]){
      const username=`qa_${team.toLowerCase()}_${role}_${run}`;
      const u=await api("POST","/api/users",{username,name:`QA ${team} ${role}`,role,team,password},rootToken);createdUsers.push(u.id);
      const token=await login(username);creds[team][role]={...u,token,password:password+"x"};
    }
  }
  const image={name:"qa.png",mime:"image/png",data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX4sAAAAASUVORK5CYII="};
  for(const team of ["MEU","TEU","SEU"]){
    const receipt=await api("POST","/api/referrals",{team,consultType:"advice",doctorName:"QA referrer",hospital:`QA ${team} Facility`,phone:"0700000000",specialty:"other",patientInitials:"Q.T.",age:"30",sex:"M",diagnosis:"QA ONLY "+run,history:"Synthetic test history",exam:"Synthetic test examination",investigations:"Synthetic test results",reason:"Advice request",suggestedPriority:"P3",consent:true,images:[image],lat:"-26.1",lon:"27.9"},referrerToken);
    const ownList=await api("GET","/api/referrals",undefined,creds[team].clinician.token);
    assert(ownList.every((r:any)=>r.team===team));const r=ownList.find((r:any)=>r.ref===receipt.ref);assert(r);
    createdCases.push(r.id);creds[team].receipt=receipt;creds[team].caseId=r.id;
    const foreign=team==="MEU"?"TEU":"MEU";
    for(const role of ["clinician","unit_admin"]){
      const token=creds[foreign][role].token;
      await api("GET",`/api/referrals/${r.id}`,undefined,token,404);
      await api("PATCH",`/api/referrals/${r.id}`,{status:"accepted"},token,404);
      await api("POST",`/api/referrals/${r.id}/shared`,{},token,404);
      await api("POST",`/api/referrals/${r.id}/portal-reset`,{},token,404);
    }
    const initial=await api("POST","/api/portal",{ref:receipt.ref,code:receipt.followupCode});assert.equal(initial.openedAt,null);
    await api("POST","/api/portal",{ref:receipt.ref,code:"0".repeat(32)},undefined,404);
    const full=await api("GET",`/api/referrals/${r.id}`,undefined,creds[team].clinician.token);
    assert(!("portalHash" in full));assert.equal(full.images.length,1);
    const im=await api("GET",`/api/referrals/${r.id}/images/${full.images[0].id}`,undefined,creds[team].clinician.token);assert.equal(im.data,image.data);
    await api("GET",`/api/referrals/${r.id}/images/${full.images[0].id}`,undefined,creds[foreign].clinician.token,404);
    const opened=await api("POST","/api/portal",{ref:receipt.ref,code:receipt.followupCode});assert(opened.openedAt);assert.equal(opened.openedBy,creds[team].clinician.name);
    await api("PATCH",`/api/referrals/${r.id}`,{status:"advised",decisionNote:"QA clinical advice",decidedBy:"spoofed"},creds[team].clinician.token);
    const advice=await api("POST","/api/portal",{ref:receipt.ref,code:receipt.followupCode});assert.equal(advice.status,"advised");assert.equal(advice.decidedBy,creds[team].clinician.name);assert.equal(advice.timeline[0].body,"QA clinical advice");
    await api("POST","/api/portal/followup",{ref:receipt.ref,code:receipt.followupCode,body:"QA new clinical findings",images:[image]});
    const updates=await api("GET","/api/referrals",undefined,creds[team].clinician.token);
    const updated=updates.find((x:any)=>x.id===r.id);assert(updated.latestFollowupAt>updated.followupSeenAt);
    const details=await api("GET",`/api/referrals/${r.id}`,undefined,creds[team].clinician.token);assert.equal(details.timeline.length,2);assert.equal(details.timeline[1].images.length,1);
    await api("PATCH",`/api/referrals/${r.id}`,{team:foreign},creds[team].clinician.token,403);
    await api("GET",`/api/referrals/${r.id}/export`,undefined,creds[team].unit_admin.token,403);
    await api("GET",`/api/referrals/${r.id}/export`,undefined,rootToken);
  }
  const consultant=creds.MEU.unit_admin.token,member=creds.MEU.clinician;
  const users=await api("GET","/api/users",undefined,consultant);assert(users.every((u:any)=>u.team==="MEU"));
  const added=await api("POST","/api/users",{username:"qa_added_"+run,name:"QA added by consultant",role:"clinician",team:"MEU",password},consultant);
  createdUsers.push(added.id);
  await api("POST","/api/users",{username:"qa_foreign_"+run,name:"QA",role:"clinician",team:"TEU",password},consultant,403);
  await api("POST","/api/users",{username:"qa_escalation_"+run,name:"QA",role:"admin",team:"MEU",password},consultant,400);
  await api("POST","/api/users",{username:"qa_escalation_"+run,name:"QA",role:"unit_admin",team:"MEU",password},consultant,403);
  await api("PATCH",`/api/users/${creds.TEU.clinician.id}`,{active:false},consultant,403);
  await api("PATCH",`/api/users/${member.id}`,{role:"unit_admin"},consultant,403);
  await api("PUT","/api/unit-roster",{team:"TEU",day:"2026-10-13",entries:[]},consultant,403);
  await api("PUT","/api/unit-roster",{team:"MEU",day:"2099-01-01",entries:[{userId:creds.TEU.clinician.id,duty:"Night"}]},consultant,400);
  await api("PUT","/api/unit-roster",{team:"MEU",day:"2099-01-01",entries:[{userId:member.id,duty:"QA night registrar"}]},consultant);
  await api("PUT","/api/unit-roster",{team:"MEU",day:"2099-01-01",entries:[]},member.token,403);
  const roster=await api("GET","/api/unit-roster?team=MEU&day=2099-01-01",undefined,member.token);assert.equal(roster.entries.length,1);
  await api("GET","/api/unit-roster?team=TEU&day=2099-01-01",undefined,member.token,403);
  await api("GET","/api/unit-members?team=TEU",undefined,member.token,403);
  await api("GET","/api/roster?date=2026-10-13",undefined,member.token,403);
  const doctors=await api("GET","/api/doctors",undefined,member.token);assert(!doctors.some((d:any)=>d.hospital==="QA TEU Facility"));
  await api("PATCH",`/api/users/${member.id}`,{active:false},consultant);
  await api("GET","/api/referrals",undefined,member.token,401);
  await api("PATCH",`/api/users/${member.id}`,{active:true},consultant);
  const relog=await api("POST","/api/login",{username:member.username,password:password+"x"});creds.MEU.clinician.token=relog.token;
  const movedId=creds.SEU.caseId;
  await api("PATCH",`/api/referrals/${movedId}`,{team:"MEU"},rootToken);
  await api("GET",`/api/referrals/${movedId}`,undefined,creds.SEU.clinician.token,404);
  await api("PATCH",`/api/referrals/${movedId}`,{team:"SEU"},rootToken);
  console.log("PASS: unit isolation across all three units; image and portal authorization; advice, attribution, follow-ups; consultant privilege boundaries; rosters; deactivation; global routing.");
  if(process.env.KEEP_QA) fs.writeFileSync("/tmp/unit-qa.json",JSON.stringify({creds,createdUsers,createdCases}));
} finally {
  await sb.from("unit_rosters").delete().eq("team","MEU").eq("day","2099-01-01");
  if(!process.env.KEEP_QA) await cleanup();
}
