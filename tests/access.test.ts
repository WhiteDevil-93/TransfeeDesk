import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccess,canManage, type Principal } from "../shared/teams";
const root:Principal={id:1,role:"admin",team:null};
test("global admin sees all units and unassigned",()=>{
  for(const team of ["MEU","TEU","SEU",null]) assert.equal(canAccess(root,team),true);
});
test("each unit is isolated",()=>{
  for(const role of ["unit_admin","clinician"] as const) for(const team of ["MEU","TEU","SEU"] as const) {
    const user:Principal={id:2,role,team};
    for(const dest of ["MEU","TEU","SEU",null]) assert.equal(canAccess(user,dest),dest===team);
  }
  assert.equal(canAccess({id:2,role:"clinician",team:null},null),false);
});
test("consultants manage only clinicians in their own unit",()=>{
  const admin:Principal={id:2,role:"unit_admin",team:"MEU"};
  for(const role of ["admin","unit_admin","clinician"] as const) for(const team of ["MEU","TEU","SEU"] as const) {
    assert.equal(canManage(admin,{id:3,role,team}),role==="clinician"&&team==="MEU");
  }
});
