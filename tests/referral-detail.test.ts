import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDetail } from "../client/src/lib/referral-detail";

const queueRow = { id: 7, status: "pending", priority: "P2", bedStatus: "Not assigned" };
const fullRecord = { id: 7, status: "accepted", priority: "P1", bedStatus: "Bed allocated", history: "Full history", exam: "Full exam", timeline: [] };

test("decisions stay locked until the full record for the open referral has loaded", () => {
  assert.deepEqual(resolveDetail(queueRow, undefined, false), { r: queueRow, ready: false });
  assert.equal(resolveDetail(queueRow, { ...fullRecord, id: 8 }, false).ready, false, "a previous referral's detail is never used");
  assert.equal(resolveDetail(queueRow, fullRecord, true).ready, false, "a failed (re)load locks actions even with cached data");
  assert.equal(resolveDetail(queueRow, fullRecord, false).ready, true);
  assert.deepEqual(resolveDetail(null, fullRecord, false), { r: null, ready: false });
});

test("the full record's workflow state is never overwritten by an older queue row", () => {
  const { r } = resolveDetail(queueRow, fullRecord, false);
  assert.equal(r?.status, "accepted");
  assert.equal(r?.priority, "P1");
  assert.equal(r?.bedStatus, "Bed allocated");
});
