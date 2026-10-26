import assert from "node:assert/strict";
import { test } from "node:test";
import { apiRequest, session } from "../client/src/lib/queryClient";

test("a late failure from the previous account cannot sign out the new account", async t => {
  let finish!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => { finish = resolve; }));
  let expirations = 0;
  session.onExpire = () => { expirations++; };
  try {
    session.token = "previous-account";
    const previous = apiRequest("GET", "/api/me");
    session.token = "new-account";
    finish(new Response("Expired", { status: 401 }));
    await assert.rejects(previous);
    assert.equal(session.token, "new-account");
    assert.equal(expirations, 0);
    const current = apiRequest("GET", "/api/me");
    finish(new Response("Expired", { status: 401 }));
    await assert.rejects(current);
    assert.equal(session.token, "");
    assert.equal(expirations, 1);
  } finally { session.token = ""; session.onExpire = undefined; }
});
