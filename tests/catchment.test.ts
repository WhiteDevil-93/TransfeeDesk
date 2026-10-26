import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import express from "express";
import { facilityLocation } from "../shared/location";
import { referralInput } from "../shared/schema";
import { CATCHMENT_SOURCE, pointInRegion, selectCatchment, type DrainageRegion } from "../server/catchment";

const areas: DrainageRegion[] = [
  { border: [[-26,27],[-26,28],[-27,28],[-27,27]], color: "#0f766e", facilities: [{ name: "QA Centre A", location: [-26.2,27.8] }] },
  { border: [[-24,29],[-24,30],[-25,30],[-25,29]], color: "#123456", facilities: [{ name: "QA Centre B", location: [-24.2,29.8] }] },
];
const body = { team: "MEU", consultType: "advice", doctorName: "QA clinician", hospital: "QA facility", phone: "0700000000", patientInitials: "Q.T.", age: "30", sex: "M", diagnosis: "QA only", history: "Synthetic history", exam: "Synthetic findings", investigations: "Synthetic tests", reason: "Advice request", suggestedPriority: "P3", consent: true };

test("referrals require both bounded facility coordinates", () => {
  for (const point of [{}, {lat:"",lon:""}, {lat:"-26.1"}, {lat:"91",lon:"27"}, {lat:"-26",lon:"181"}, {lat:"NaN",lon:"27"}, {lat:"-26",lon:"Infinity"}]) {
    assert.equal(facilityLocation.safeParse(point).success, false);
    assert.equal(referralInput.safeParse({...body,...point}).success, false);
  }
  assert.deepEqual(facilityLocation.parse({lat:" -26.1 ",lon:"27.9"}), {lat:"-26.1",lon:"27.9"});
  assert(referralInput.safeParse({...body,lat:"-26.1",lon:"27.9"}).success);
});

test("drainage matching includes boundary points and returns only centres assigned to the containing area", () => {
  for (const border of [areas[0].border, [...areas[0].border].reverse()]) {
    assert(pointInRegion(-26.1,27.9,border)); assert(pointInRegion(-26,27.5,border)); assert(!pointInRegion(-25,27.5,border));
  }
  assert.deepEqual(selectCatchment(areas,-26.1,27.9).facilities.map(f=>f.name), ["QA Centre A"]);
  assert.deepEqual(selectCatchment(areas,-24.1,29.9).facilities.map(f=>f.name), ["QA Centre B"]);
  assert.deepEqual(selectCatchment(areas,0,0).facilities, []);
  assert.equal(selectCatchment(areas,0,0).status,"outside");
});

test("live handlers reject missing location before writing and handle catchment outage/invalid data without invented centres", async t => {
  process.env.APP_DB_SECRET = "location-test-secret-longer-than-thirty-two-characters";
  process.env.SUPABASE_URL = "https://example.supabase.co"; process.env.SUPABASE_PUBLISHABLE_KEY = "location-test-key";
  const {db} = await import("../server/db"), {registerRoutes} = await import("../server/routes");
  t.mock.method(db,"sessionUser",async token => token === "referrer" ? {id:7,name:"QA",role:"referrer",verifyStatus:"verified"} as any : null);
  const create = t.mock.method(db,"create",async () => ({id:11,ref:"QA-LOCATION",followupCode:"fixture"}) as any);
  t.mock.method(db,"audit",async () => {});
  const nativeFetch = globalThis.fetch; let mode = "offline"; const providerRequests:string[] = [];
  t.mock.method(globalThis,"fetch",async (input, init) => {
    if (String(input) !== CATCHMENT_SOURCE) return nativeFetch(input,init);
    providerRequests.push(String(input));
    if (mode === "oversize") return new Response(" ".repeat(15_000_001));
    return new Response(JSON.stringify(mode === "invalid" ? [{border:[],facilities:[]}] : areas), {status:mode === "offline" ? 503 : 200,headers:{"content-type":"application/json"}});
  });
  const app=express();app.use(express.json());const server=createServer(app);await registerRoutes(server,app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const headers={authorization:"Bearer referrer","content-type":"application/json"};
  try {
    for (const point of [{}, {lat:"",lon:"27"}, {lat:"-26",lon:"181"}]) assert.equal((await fetch(base+"/api/referrals",{method:"POST",headers,body:JSON.stringify({...body,...point})})).status,400);
    assert.equal(create.mock.callCount(),0);
    assert.equal((await fetch(base+"/api/catchment?lat=-26.1&lon=27.9")).status,401);
    assert.equal((await fetch(base+"/api/catchment?lat=-26.1",{headers})).status,400);
    assert.equal((await fetch(base+"/api/catchment?lat=91&lon=27.9",{headers})).status,400);
    const url=base+"/api/catchment?lat=-26.1&lon=27.9";
    assert.equal((await fetch(url,{headers})).status,503); mode="invalid";
    assert.equal((await fetch(url,{headers})).status,503); mode="oversize";
    assert.equal((await fetch(url,{headers})).status,503); mode="valid";
    const match=await fetch(url,{headers});assert.equal(match.status,200);assert.deepEqual((await match.json()).facilities.map((f:any)=>f.name),["QA Centre A"]);
    const other=await fetch(base+"/api/catchment?lat=-24.1&lon=29.9",{headers});assert.deepEqual((await other.json()).facilities.map((f:any)=>f.name),["QA Centre B"]);
    const outside=await fetch(base+"/api/catchment?lat=0&lon=0",{headers});assert.deepEqual((await outside.json()).facilities,[]);
    assert.equal(providerRequests.length,4,"successful dataset is cached and shared across location checks");
    assert(providerRequests.every(url=>url===CATCHMENT_SOURCE),"facility/patient coordinates are not sent to the drainage provider");
    assert.equal((await fetch(base+"/api/referrals",{method:"POST",headers,body:JSON.stringify({...body,lat:"-26.1",lon:"27.9"})})).status,200);
    assert.equal(create.mock.callCount(),1);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
