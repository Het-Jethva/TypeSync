import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import express from "express";
import { createResendWebhookHandler } from "../src/routes/resend-webhook.js";

const messageId = "56761188-7520-42d8-8898-ff6fc54ce618";
const personal = "recipient-private@example.test";

test("signed delivery endpoint enforces HTTP boundaries and logs only safe event fields", async () => {
  const key = randomBytes(32);
  const app = express();
  app.post("/api/webhooks/resend", createResendWebhookHandler(`whsec_${key.toString("base64")}`));
  app.use(express.json());
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  const logs: unknown[][] = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = (...args: unknown[]) => { logs.push(args); };
  console.warn = (...args: unknown[]) => { logs.push(args); };
  const createdAt = "2025-01-01T00:00:00.000Z";
  const payload = {
    type: "email.delivered", created_at: createdAt,
    data: { email_id: messageId, to: [personal], subject: "private subject", bounce: { message: "private bounce" } },
  };
  const body = JSON.stringify(payload);
  function signedHeaders(value: string, timestamp = Math.floor(Date.now() / 1000)): Record<string, string | string[]> {
    const id = "msg_fixture";
    return {
      "content-type": "application/json", "svix-id": id, "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${value}`).digest("base64")}`,
    };
  }
  function post(value: string | Buffer, headers: Record<string, string | string[]>): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/api/webhooks/resend", method: "POST", headers }, (res) => {
        let response = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { response += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: response }));
      });
      req.on("error", reject);
      req.end(value);
    });
  }
  try {
    for (const type of ["email.delivered", "email.delivery_delayed", "email.bounced", "email.failed", "email.complained", "email.suppressed"]) {
      const value = JSON.stringify({ ...payload, type });
      assert.equal((await post(value, signedHeaders(value))).status, 204);
      assert.deepEqual(logs.at(-1), ["Resend delivery event", JSON.stringify({ event: type, messageId, eventCreatedAt: createdAt })]);
    }
    assert.equal((await post(body, signedHeaders(body))).status, 204);
    assert.equal(logs.length, 7, "duplicates are harmless log entries");
    const rotated = signedHeaders(body);
    rotated["svix-signature"] = `v1,${Buffer.alloc(32).toString("base64")} ${rotated["svix-signature"]}`;
    assert.equal((await post(body, rotated)).status, 204);
    const now = Math.floor(Date.now() / 1000);
    const cases: [string | Buffer, Record<string, string | string[]>][] = [
      [body + " ", signedHeaders(body)],
      ["{", signedHeaders("{")],
      [body, signedHeaders(body, now - 600)],
      [body, signedHeaders(body, now + 600)],
      [body, { "content-type": "application/json" }],
      [body, { ...signedHeaders(body), "content-type": "text/plain" }],
      [gzipSync(body), { ...signedHeaders(body), "content-encoding": "gzip" }],
      [" ".repeat(65 * 1024), signedHeaders(" ".repeat(65 * 1024))],
    ];
    for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
      const missing = signedHeaders(body);
      delete missing[name];
      cases.push([body, missing]);
      const repeated = signedHeaders(body);
      const value = repeated[name];
      assert.equal(typeof value, "string");
      cases.push([body, { ...repeated, [name]: [String(value), String(value)] }]);
    }
    for (const [value, headers] of cases) {
      assert.deepEqual(await post(value, headers), { status: 400, body: '{"error":"Invalid webhook request"}' });
    }
    assert.equal(logs.length, 8, "rejected authentication and parser requests do not log payloads");
    const unsupported = JSON.stringify({ type: "email.opened", data: { to: personal } });
    assert.equal((await post(unsupported, signedHeaders(unsupported))).status, 204);
    assert.equal(logs.length, 8, "unsupported authenticated types are silent");
    for (const invalid of [
      { ...payload, created_at: personal },
      { ...payload, data: { email_id: personal } },
    ]) {
      const value = JSON.stringify(invalid);
      assert.equal((await post(value, signedHeaders(value))).status, 400);
      assert.deepEqual(logs.at(-1), ["Resend webhook diagnostic", JSON.stringify({ diagnostic: "invalid_event_payload" })]);
    }
    const serialized = JSON.stringify(logs);
    for (const value of [personal, "private subject", "private bounce"]) assert(!serialized.includes(value));
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("email acceptance logs a UUID and preserves success when diagnostics are malformed", async () => {
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.EMAIL_FROM = "TypeSync <sender@example.test>";
  const { sendVerificationEmail } = await import("../src/lib/verification-email.js");
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const logs: unknown[][] = [];
  console.info = (...args: unknown[]) => { logs.push(args); };
  console.warn = (...args: unknown[]) => { logs.push(args); };
  const options = { email: personal, url: "https://example.test/verify?token=private-token" };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ id: messageId, to: personal }));
    await sendVerificationEmail(options);
    assert.deepEqual(logs.pop(), ["Verification email accepted", JSON.stringify({ operation: "verification_email", status: "accepted", messageId })]);
    for (const body of ["{}", JSON.stringify({ id: personal }), "private malformed JSON"]) {
      globalThis.fetch = async () => new Response(body);
      await sendVerificationEmail(options);
      assert.deepEqual(logs.at(-1), ["Verification email acceptance diagnostic", JSON.stringify({
        operation: "verification_email", status: "accepted", diagnostic: "invalid_provider_response",
      })]);
    }
    globalThis.fetch = async () => new Response(personal, { status: 503 });
    await assert.rejects(sendVerificationEmail(options), /HTTP 503/);
    assert.equal(logs.length, 3, "non-success response creates no acceptance log");
    for (const value of [personal, "private-token", "private malformed JSON"]) assert(!JSON.stringify(logs).includes(value));
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.warn = originalWarn;
  }
});
