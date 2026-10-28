import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import ws from "ws";
import { createClient } from "@supabase/supabase-js";
import { db } from "../server/db";
const B=process.env.TEST_BASE||"http://127.0.0.1:5000";
const sb=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false},realtime:{transport:ws as any},global:{headers:{"x-app-secret":process.env.APP_DB_SECRET!}}});
const createdUsers:number[]=[],createdCases:number[]=[],claimed:string[]=[];
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
  const referrer=await db.addReferrer({username:"qa_referrer_"+run,name:"QA Referrer",password,email:`qa-${run}@example.invalid`,phone:"0700000000",hospital:"QA Facility",department:"ED",specialty:"other",profession:"doctor",hpcsa:"",verifyStatus:"none"});
  createdUsers.push(referrer.id);
  await db.approveReferrer(referrer.id);
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
    const initial=await api("POST","/api/portal",{ref:receipt.ref,code:receipt.followupCode});assert.equal(initial.openedAt,null);assert(initial.portalToken);
    const viaToken=async(path:string,body?:any,expected=200)=>{const x=await fetch(B+path,{method:"POST",headers:{"content-type":"application/json","x-portal-token":initial.portalToken},body:JSON.stringify(body??{})});assert.equal(x.status,expected,`${path} via portal token: ${x.status}`);return x.status===200?x.json():null;};
    await fetch(B+"/api/portal",{method:"POST",headers:{"content-type":"application/json","x-portal-token":"forged.token"},body:"{}"}).then(x=>assert.equal(x.status,410));
    await api("POST","/api/portal",{ref:receipt.ref,code:"0".repeat(32)},undefined,404);
    const full=await api("GET",`/api/referrals/${r.id}`,undefined,creds[team].clinician.token);
    assert(!("portalHash" in full));assert.equal(full.images.length,1);
    const im=await api("GET",`/api/referrals/${r.id}/images/${full.images[0].id}`,undefined,creds[team].clinician.token);assert.equal(im.data,image.data);
    await api("GET",`/api/referrals/${r.id}/images/${full.images[0].id}`,undefined,creds[foreign].clinician.token,404);
    const opened=await api("POST","/api/portal",{ref:receipt.ref,code:receipt.followupCode});assert(opened.openedAt);assert.equal(opened.openedBy,creds[team].clinician.name);
    await api("PATCH",`/api/referrals/${r.id}`,{status:"advised",decisionNote:"QA clinical advice",decidedBy:"spoofed"},creds[team].clinician.token);
    const advice=await viaToken("/api/portal");assert.equal(advice.status,"advised");assert.equal(advice.decidedBy,creds[team].clinician.name);assert.equal(advice.timeline[0].body,"QA clinical advice");
    await viaToken("/api/portal/followup",{body:"QA new clinical findings",images:[image]});
    const updates=await api("GET","/api/referrals",undefined,creds[team].clinician.token);
    const unseen=(x:any)=>!!x.latestFollowupAt && (!x.followupSeenAt || x.latestFollowupAt>x.followupSeenAt);
    const updated=updates.find((x:any)=>x.id===r.id);assert(unseen(updated),"a new follow-up is flagged for the unit");
    const details=await api("GET",`/api/referrals/${r.id}`,undefined,creds[team].clinician.token);assert.equal(details.timeline.length,2);assert.equal(details.timeline[1].images.length,1);
    const seen=(await api("GET","/api/referrals",undefined,creds[team].clinician.token)).find((x:any)=>x.id===r.id);
    assert(!unseen(seen),"viewing the case clears the follow-up flag");assert.equal(seen.followupSeenAt,seen.latestFollowupAt);
    const portalState=async()=>viaToken("/api/portal");
    assert.equal((await portalState()).awaitingInfoAt,null);
    await api("POST",`/api/referrals/${r.id}/question`,{body:"QA: what are the latest observations?"},creds[foreign].clinician.token,404);
    await api("POST",`/api/referrals/${r.id}/question`,{body:"x"},creds[team].clinician.token,400);
    await api("POST",`/api/referrals/${r.id}/question`,{body:"QA: what are the latest observations?"},referrerToken,404);
    await api("POST",`/api/referrals/${r.id}/question`,{body:"QA: what are the latest observations?"},creds[team].clinician.token);
    const asked=await portalState();assert(asked.awaitingInfoAt,"the referral shows as waiting for the referrer");assert.equal(asked.timeline.at(-1).kind,"question");
    assert(asked.status==="advised","a question does not change the decision");
    assert((await api("GET","/api/referrals",undefined,creds[team].clinician.token)).find((x:any)=>x.id===r.id).awaitingInfoAt);
    assert((await api("GET","/api/referrer/my-referrals",undefined,referrerToken)).find((x:any)=>x.id===r.id).awaitingInfoAt,"the signed-in referrer sees the open question");
    await api("POST",`/api/referrer/referrals/${r.id}/followup`,{body:"QA: BP 120/80, HR 70",images:[]},referrerToken);
    const answered=await portalState();assert.equal(answered.awaitingInfoAt,null,"a reply closes the question");assert.equal(answered.timeline.at(-1).kind,"reply");
    await api("POST",`/api/referrals/${r.id}/question`,{body:"QA: second question"},creds[team].unit_admin.token);
    await viaToken("/api/portal/followup",{body:"QA: portal reply"});
    assert.equal((await portalState()).timeline.at(-1).kind,"reply");
    await api("POST",`/api/referrals/${r.id}/question`,{body:"QA: third question"},creds[team].clinician.token);
    assert((await portalState()).awaitingInfoAt);
    await api("PATCH",`/api/referrals/${r.id}`,{status:"declined",decisionNote:"QA declined"},creds[team].clinician.token);
    assert.equal((await portalState()).awaitingInfoAt,null,"declining the consult closes any open question");
    const kinds=(await api("GET",`/api/referrals/${r.id}/export`,undefined,rootToken)).timeline.map((m:any)=>m.kind);
    assert(kinds.includes("question")&&kinds.includes("reply"),"chat is part of the exported referral record");
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
  const members=await api("GET","/api/unit-members?team=MEU",undefined,consultant);
  assert(members.every((m:any)=>typeof m.pushDevices==="number"));
  const meuCase=creds.MEU.caseId,pushUser=creds.MEU.unit_admin.id;
  await api("GET","/api/push/key").then(k=>assert.equal(typeof k.enabled,"boolean"));
  await db.savePushSub({endpoint:"https://fcm.googleapis.com/fcm/send/qa-"+run,p256dh:"p".repeat(20),auth:"a".repeat(20)},{userId:pushUser});
  await db.savePushSub({endpoint:"https://fcm.googleapis.com/fcm/send/qa-portal-"+run,p256dh:"p".repeat(20),auth:"a".repeat(20)},{referralId:meuCase});
  assert.equal((await db.pushSubsForUsers([pushUser])).length,1);assert.equal((await db.pushSubsForReferral(meuCase)).length,1);
  assert.equal((await db.pushDeviceCounts([pushUser]))[pushUser],1);
  await db.savePushSub({endpoint:"https://fcm.googleapis.com/fcm/send/qa-"+run,p256dh:"q".repeat(20),auth:"b".repeat(20)},{userId:member.id});
  assert.equal((await db.pushSubsForUsers([pushUser])).length,0,"a device belongs to the account that subscribed last");
  await db.removePushSub("https://fcm.googleapis.com/fcm/send/qa-"+run,{userId:pushUser});
  assert.equal((await db.pushSubsForUsers([member.id])).length,1,"another account cannot remove it");
  await db.removePushSub("https://fcm.googleapis.com/fcm/send/qa-"+run,{userId:member.id});
  assert.equal((await db.pushSubsForUsers([member.id])).length,0);
  const key="qa-claim-"+run;claimed.push(key);
  assert.equal(await db.claimPush(key),true);assert.equal(await db.claimPush(key),false,"an alert is only ever claimed once");
  const fresh=await api("POST","/api/referrals",{team:"MEU",consultType:"advice",doctorName:"QA referrer",hospital:"QA MEU Facility",phone:"0700000000",specialty:"other",patientInitials:"Q.P.",age:"30",sex:"M",diagnosis:"QA PUSH "+run,history:"Synthetic test history",exam:"Synthetic test examination",investigations:"Synthetic test results",reason:"Advice request",suggestedPriority:"P1",consent:true,images:[],lat:"-26.1",lon:"27.9"},referrerToken);
  const freshId=(await api("GET","/api/referrals",undefined,member.token)).find((x:any)=>x.ref===fresh.ref).id;createdCases.push(freshId);
  const window=()=>[new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()+60e3).toISOString()] as [string,string,string];
  assert((await db.pushDue(...window())).unattended.some((x:any)=>x.id===freshId),"an unopened pending referral is due for escalation");
  await api("GET",`/api/referrals/${freshId}`,undefined,member.token);
  assert(!(await db.pushDue(...window())).unattended.some((x:any)=>x.id===freshId),"opening it ends the escalation");
  await api("POST",`/api/referrals/${freshId}/question`,{body:"QA push question"},member.token);
  assert((await db.pushDue(...window())).questions.some((x:any)=>x.id===freshId));
  await api("PATCH",`/api/referrals/${freshId}`,{status:"waiting",remindAt:new Date(Date.now()-60e3).toISOString()},member.token);
  assert((await db.pushDue(...window())).waiting.some((x:any)=>x.id===freshId&&x.remindAt));
  console.log("PASS: unit isolation across all three units; image and portal authorization; advice, attribution, follow-ups; consultant privilege boundaries; rosters; deactivation; global routing.");
  if(process.env.KEEP_QA) fs.writeFileSync("/tmp/unit-qa.json",JSON.stringify({creds,createdUsers,createdCases}));
} finally {
  await sb.from("unit_rosters").delete().eq("team","MEU").eq("day","2099-01-01");
  for(const key of claimed) await sb.from("push_sent").delete().eq("key",key);
  if(!process.env.KEEP_QA) await cleanup();
}
