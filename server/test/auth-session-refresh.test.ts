import assert from "node:assert/strict";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

test("read-only session checks preserve HTTP renewal and reject expired or revoked sessions", async () => {
  const storage: Record<string, Record<string, unknown>[]> = {
    user: [], session: [], account: [], verification: [],
  };
  const auth = betterAuth({
    database: memoryAdapter(storage),
    secret: "local-session-test-secret-12345678901234567890",
    baseURL: "http://localhost:3000",
    emailAndPassword: { enabled: true },
    session: { expiresIn: 7 * 86400, updateAge: 86400 },
  });
  const signup = await auth.api.signUpEmail({
    body: { name: "Session Test", email: "session@example.invalid", password: "local-session-test-password" },
    returnHeaders: true,
  });
  const cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(cookie);
  const sessionRow = storage.session?.[0];
  assert.ok(sessionRow);
  const renewalDueExpiry = new Date(Date.now() + 5 * 86400 * 1000);
  sessionRow.expiresAt = renewalDueExpiry;
  const headers = new Headers({ cookie });
  const readOnlyLookup = () => auth.api.getSession({ headers, query: { disableRefresh: true } });

  const session = await readOnlyLookup();
  assert.equal(session?.user.id, signup.response.user.id);
  assert.equal(session?.session.expiresAt.getTime(), renewalDueExpiry.getTime());
  assert.equal(sessionRow.expiresAt, renewalDueExpiry);

  const browserResponse = await auth.handler(new Request("http://localhost:3000/api/auth/get-session", { headers }));
  assert.equal(browserResponse.status, 200);
  assert.match(browserResponse.headers.get("set-cookie") ?? "", /better-auth\.session_token=/);
  assert.ok(sessionRow.expiresAt instanceof Date);
  assert.ok(sessionRow.expiresAt.getTime() > renewalDueExpiry.getTime() + 86400 * 1000);

  sessionRow.expiresAt = new Date(Date.now() - 1000);
  assert.equal(await readOnlyLookup(), null);

  sessionRow.expiresAt = new Date(Date.now() + 86400 * 1000);
  storage.session = [sessionRow];
  assert.equal((await readOnlyLookup())?.session.id, session?.session.id);
  storage.session = [];
  assert.equal(await readOnlyLookup(), null);
});
