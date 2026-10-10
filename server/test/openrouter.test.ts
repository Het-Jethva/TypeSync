import assert from "node:assert/strict";
import { test } from "node:test";

process.env.OPENROUTER_API_KEY = "test-server-key";
const { streamEdit } = await import("../src/services/openrouter.js");

test("provider resets partial output before fallback and reports the actual model", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  let replacement = "";
  let actualModel = "";
  globalThis.fetch = async (_url, init) => {
    assert.equal(typeof init?.body, "string");
    const body = JSON.parse(String(init?.body));
    requested.push(body.model);
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
    const frames = requested.length === 1
      ? 'data: {"model":"pinned/free","choices":[{"delta":{"content":"Partial"}}]}\n\ndata: {"error":{"message":"failure"}}\n\n'
      : ': keepalive\r\ndata: {"model":"actual/free","choices":[{"delta":{"content":"Corrected café."}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(frames);
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    } }));
  };
  try {
    await streamEdit({ action: "grammar", instruction: "", sourceText: "Wrong café.",
      signal: new AbortController().signal,
      onReset() { replacement = ""; actualModel = ""; },
      onDelta(delta) { replacement += delta; },
      onModel(model) { actualModel = model; },
    });
    assert.equal(requested.length, 2);
    assert(requested[0]?.endsWith(":free"));
    assert.equal(requested[1], "openrouter/free");
    assert.equal(replacement, "Corrected café.");
    assert.equal(actualModel, "actual/free");
  } finally { globalThis.fetch = originalFetch; }
});

test("provider refuses truncated output and cancellation does not start fallback", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('data: {"model":"actual/free","choices":[{"delta":{"content":"Incomplete"}}]}\n\n');
  };
  const options = { action: "rewrite" as const, instruction: "", sourceText: "Source.",
    onDelta() {}, onModel() {}, signal: new AbortController().signal };
  try {
    await assert.rejects(streamEdit(options), /ended early/);
    assert.equal(calls, 2);
    calls = 0;
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(streamEdit({ ...options, signal: controller.signal }), /cancelled/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
