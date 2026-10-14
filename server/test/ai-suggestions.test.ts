import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import * as Y from "yjs";
import { z } from "zod";
import { absolutePositionToRelativePosition, initProseMirrorDoc, prosemirrorJSONToYDoc, updateYFragment } from "@tiptap/y-tiptap";
import { Transform } from "@tiptap/pm/transform";
import { editorSchema, isTextOnlySelection, selectedText, unsafeAiSelectionReason } from "@typesync/shared/editor-schema";
import { AiSuggestionSchema, type AiCreateRequest, type AiSuggestion, type Role } from "@typesync/shared";
import { AiSuggestionService } from "../src/services/ai-suggestions.ts";
import { CollaborativeRoomSession } from "../src/socket/room-session.ts";
import type { TypeSyncSocket } from "../src/socket/types.ts";

type Provider = NonNullable<ConstructorParameters<typeof AiSuggestionService>[0]["provider"]>;

async function fixture(provider: Provider) {
  const initial = prosemirrorJSONToYDoc(editorSchema, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world", marks: [{ type: "bold" }] }] }, { type: "paragraph", content: [{ type: "text", text: "Keep this." }] }] }, "default");
  let state = Y.encodeStateAsUpdate(initial);
  initial.destroy();
  let history: unknown = [];
  const repository = {
    loadState: async () => state,
    saveState: async (_id: string, next: Uint8Array) => { state = next; return { title: "Test", updatedAt: new Date() }; },
    loadAiSuggestions: async () => structuredClone(history),
    saveAiSuggestions: async (_id: string, next: unknown) => { history = structuredClone(next); },
  };
  const rooms = new CollaborativeRoomSession({ repository });
  const documentId = randomUUID();
  async function socket(role: Role) {
    const roomNames = new Set<string>();
    const fake = { id: randomUUID(), connected: true, rooms: roomNames, data: { userId: randomUUID(), userName: role },
      join: (name: string) => { roomNames.add(name); }, leave: (name: string) => { roomNames.delete(name); }, emit: () => {},
    } as unknown as TypeSyncSocket;
    rooms.initializeSocket(fake);
    const joined = await rooms.joinSession({ socket: fake, documentId, checkSession: async () => "valid", authorize: async () => ({ hasAccess: true, role }) });
    assert(joined.success);
    return fake;
  }
  const owner = await socket("owner");
  const viewer = await socket("viewer");
  const editor = await socket("editor");
  const events: AiSuggestion[] = [];
  const updates: Uint8Array[] = [];
  const ai = new AiSuggestionService({ rooms, repository, configured: () => true, provider,
    emit: (_id, suggestion) => events.push(structuredClone(suggestion)), emitUpdate: (_id, update) => updates.push(update),
  });
  function request(from = 1, to = 12): AiCreateRequest {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, rooms.snapshotForAi(documentId));
    const fragment = doc.getXmlFragment("default");
    const mapped = initProseMirrorDoc(fragment, editorSchema);
    const result = { requestId: randomUUID(), action: "rewrite" as const, instruction: "", sourceText: selectedText(mapped.doc, from, to),
      from: Array.from(Y.encodeRelativePosition(absolutePositionToRelativePosition(from, fragment, mapped.mapping))),
      to: Array.from(Y.encodeRelativePosition(absolutePositionToRelativePosition(to, fragment, mapped.mapping))),
    };
    doc.destroy();
    return result;
  }
  function mutate(transform: (value: Transform) => Transform) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, rooms.snapshotForAi(documentId));
    const vector = Y.encodeStateVector(doc);
    const fragment = doc.getXmlFragment("default");
    const mapped = initProseMirrorDoc(fragment, editorSchema);
    updateYFragment(doc, fragment, transform(new Transform(mapped.doc)).doc, mapped.meta);
    assert(rooms.applyUpdate({ socket: editor, documentId, update: Y.encodeStateAsUpdate(doc, vector) }).success);
    doc.destroy();
  }
  function content() {
    const doc = new Y.Doc(); Y.applyUpdate(doc, rooms.snapshotForAi(documentId));
    const content = initProseMirrorDoc(doc.getXmlFragment("default"), editorSchema).doc;
    doc.destroy(); return content;
  }
  async function cleanup() { rooms.beginDrain(); await rooms.flushAll(); rooms.handleDocumentDeleted(documentId, []); }
  return { ai, rooms, documentId, owner, viewer, editor, request, mutate, content, events, updates, repository, cleanup };
}

async function settled(ai: AiSuggestionService, socket: TypeSyncSocket, documentId: string) {
  for (let index = 0; index < 100; index++) {
    const listed = await ai.list(socket, documentId);
    if (listed.success && listed.suggestions.every(item => item.status !== "streaming")) { await ai.flush(); return listed.suggestions; }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error("Suggestion did not finish");
}

test("provider null characters fail generation before contaminating persisted history", async () => {
  const f = await fixture(async ({ onDelta }) => {
    onDelta("Safe prefix");
    onDelta("bad\u0000response");
  });
  try {
    assert((await f.ai.create(f.owner, f.documentId, f.request())).success);
    const [suggestion] = await settled(f.ai, f.owner, f.documentId);
    assert.equal(suggestion?.status, "failed");
    assert.equal(suggestion?.error, "AI response contains null characters");
    assert.equal(suggestion?.replacement, "Safe prefix");
    const history = z.array(z.object({ suggestion: AiSuggestionSchema })).parse(await f.repository.loadAiSuggestions());
    assert.equal(history[0]?.suggestion.status, "failed");
    assert.equal(history[0]?.suggestion.replacement, "Safe prefix");
    assert.equal(JSON.stringify(history).includes("\\u0000"), false);
    assert.equal(f.content().firstChild?.textContent, "Hello world");
    assert.deepEqual(f.updates, []);
  } finally { await f.cleanup(); }
});

test("failed AI acceptance saves retry the document and then finalize history", async context => {
  const f = await fixture(async ({ onDelta }) => onDelta("Hi everyone"));
  try {
    const created = await f.ai.create(f.owner, f.documentId, f.request());
    assert(created.success);
    await settled(f.ai, f.owner, f.documentId);
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const saveState = f.repository.saveState;
    const saveHistory = f.repository.saveAiSuggestions;
    let documentAttempts = 0;
    let historyAttempts = 0;
    f.repository.saveState = async (id, state) => {
      documentAttempts++;
      if (documentAttempts === 1) {
        f.mutate(transform => transform.insert(transform.doc.content.size - 1, editorSchema.text(" later edit")));
      }
      if (documentAttempts === 2) throw new Error("database unavailable");
      return saveState(id, state);
    };
    f.repository.saveAiSuggestions = async (id, history) => {
      if (++historyAttempts === 1) throw new Error("history unavailable");
      return saveHistory(id, history);
    };
    assert.equal((await f.ai.resolve(f.editor, f.documentId, { suggestionId: created.suggestion.id, decision: "accept" })).success, false);
    assert.equal(f.content().firstChild?.textContent, "Hi everyone");
    const persistedStatus = async () => {
      const raw = z.array(z.object({ suggestion: AiSuggestionSchema })).parse(await f.repository.loadAiSuggestions());
      return raw[0]?.suggestion.status;
    };
    assert.equal(await persistedStatus(), "ready");
    context.mock.timers.tick(15_000);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(documentAttempts, 3);
    assert.equal(historyAttempts, 1);
    assert.equal(await persistedStatus(), "ready");
    context.mock.timers.tick(15_000);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(historyAttempts, 2);
    assert.equal(await persistedStatus(), "accepted");
    assert.equal(f.updates.length, 1);
  } finally { await f.cleanup(); }
});

test("streaming remains separate from document, viewers can read and only editors resolve", async () => {
  const f = await fixture(async ({ onDelta, onModel }) => { onModel("test/free-model"); onDelta("Hi "); onDelta("everyone"); });
  try {
    const before = f.rooms.snapshotForAi(f.documentId);
    assert.equal((await f.ai.create(f.viewer, f.documentId, f.request())).success, false);
    const created = await f.ai.create(f.owner, f.documentId, f.request()); assert(created.success, JSON.stringify(created));
    const [suggestion] = await settled(f.ai, f.viewer, f.documentId); assert(suggestion);
    assert.equal(suggestion.status, "ready"); assert.equal(suggestion.model, "test/free-model");
    assert.deepEqual(f.rooms.snapshotForAi(f.documentId), before);
    assert(f.events.some(item => item.status === "streaming" && item.replacement === "Hi "));
    assert.equal((await f.ai.resolve(f.viewer, f.documentId, { suggestionId: suggestion.id, decision: "accept" })).success, false);
    assert((await f.ai.resolve(f.editor, f.documentId, { suggestionId: suggestion.id, decision: "accept" })).success);
    assert.equal(f.content().textBetween(0, f.content().content.size, "\n"), "Hi everyone\nKeep this.");
    assert.equal(f.content().firstChild?.firstChild?.marks[0]?.type.name, "bold");
    assert.equal(f.updates.length, 1);
    await f.rooms.flushAll();
    const fresh = new AiSuggestionService({ rooms: f.rooms, repository: f.repository, configured: () => true, emit: () => {}, emitUpdate: () => {} });
    const restored = await fresh.list(f.viewer, f.documentId); assert(restored.success); assert.equal(restored.suggestions[0]?.status, "accepted");
  } finally { await f.cleanup(); }
});

test("anchors follow unrelated edits while edits to selected rich text reject acceptance", async () => {
  const f = await fixture(async ({ onDelta }) => onDelta("Good morning"));
  try {
    const created = await f.ai.create(f.owner, f.documentId, f.request()); assert(created.success, JSON.stringify(created));
    await settled(f.ai, f.owner, f.documentId);
    f.mutate(transform => transform.insert(15, editorSchema.text("new ")));
    assert((await f.ai.resolve(f.editor, f.documentId, { suggestionId: created.suggestion.id, decision: "accept" })).success);
    assert.equal(f.content().firstChild?.textContent, "Good morning");
  } finally { await f.cleanup(); }
  const stale = await fixture(async ({ onDelta }) => onDelta("Good morning"));
  try {
    const created = await stale.ai.create(stale.owner, stale.documentId, stale.request()); assert(created.success, JSON.stringify(created));
    await settled(stale.ai, stale.owner, stale.documentId);
    stale.mutate(transform => transform.removeMark(1, 12, editorSchema.marks.bold));
    const before = stale.rooms.snapshotForAi(stale.documentId);
    const result = await stale.ai.resolve(stale.editor, stale.documentId, { suggestionId: created.suggestion.id, decision: "accept" });
    assert(!result.success); assert.match(result.error, /changed/);
    assert.deepEqual(stale.rooms.snapshotForAi(stale.documentId), before);
  } finally { await stale.cleanup(); }
});

test("reject cancels a live stream and late chunks cannot revive it; retry ids do not generate twice", async () => {
  let finish: (() => void) | undefined;
  let calls = 0;
  let cancelled = false;
  const f = await fixture(async ({ onDelta, signal }) => {
    calls++; onDelta("Partial");
    await new Promise<void>(resolve => { finish = resolve; signal.addEventListener("abort", () => { cancelled = true; resolve(); }); });
    onDelta(" late");
  });
  try {
    const request = f.request();
    const result = await f.ai.create(f.owner, f.documentId, request); assert(result.success, JSON.stringify(result));
    assert((await f.ai.create(f.owner, f.documentId, request)).success); assert.equal(calls, 1);
    assert((await f.ai.resolve(f.editor, f.documentId, { suggestionId: result.suggestion.id, decision: "reject" })).success);
    finish?.();
    const [suggestion] = await settled(f.ai, f.viewer, f.documentId);
    assert(cancelled); assert.equal(suggestion?.status, "rejected"); assert.equal(suggestion?.replacement, "Partial");
    assert.equal(f.content().firstChild?.textContent, "Hello world"); assert.equal(f.updates.length, 0);
  } finally { await f.cleanup(); }
});


test("accept fits selections across paragraphs and rejects replacing selected text with identical characters", async () => {
  const f = await fixture(async ({ onDelta }) => onDelta("One\nparagraph"));
  try {
    f.mutate(transform => transform.insert(6, editorSchema.node("hardBreak")));
    const created = await f.ai.create(f.owner, f.documentId, f.request(1, 25)); assert(created.success, JSON.stringify(created));
    await settled(f.ai, f.viewer, f.documentId);
    const result = await f.ai.resolve(f.editor, f.documentId, { suggestionId: created.suggestion.id, decision: "accept" });
    assert(result.success, JSON.stringify(result));
    assert.equal(selectedText(f.content(), 0, f.content().content.size), "One\nparagraph");
    assert.equal(f.content().firstChild?.child(1).type.name, "hardBreak");
    assert.equal(f.content().firstChild?.firstChild?.marks[0]?.type.name, "bold");
  } finally { await f.cleanup(); }
  const stale = await fixture(async ({ onDelta }) => onDelta("Hi"));
  try {
    const created = await stale.ai.create(stale.owner, stale.documentId, stale.request()); assert(created.success, JSON.stringify(created));
    await settled(stale.ai, stale.viewer, stale.documentId);
    stale.mutate(transform => transform.replaceWith(4, 8, editorSchema.text("xxxx", [editorSchema.mark("bold")])));
    stale.mutate(transform => transform.replaceWith(4, 8, editorSchema.text("lo w", [editorSchema.mark("bold")])));
    const result = await stale.ai.resolve(stale.editor, stale.documentId, { suggestionId: created.suggestion.id, decision: "accept" });
    assert(!result.success); assert.match(result.error, /changed/);
    assert.equal(stale.content().firstChild?.textContent, "Hello world");
  } finally { await stale.cleanup(); }
});

for (const contentType of ["image", "table"] as const) {
  test(`AI rejects ${contentType}-spanning generation and restored ready acceptance without changing the document`, async () => {
    let generations = 0;
    const f = await fixture(async ({ onDelta }) => { generations++; onDelta("Replacement"); });
    try {
      if (contentType === "image") {
        f.mutate(transform => transform.insert(13, editorSchema.node("image", { src: "https://example.com/image.png" })));
      } else {
        const cell = (text: string) => editorSchema.node("tableCell", null, [editorSchema.node("paragraph", null, editorSchema.text(text))]);
        const table = editorSchema.node("table", null, [
          editorSchema.node("tableRow", null, [cell("Alpha"), cell("Beta")]),
          editorSchema.node("tableRow", null, [cell("Unselected left"), cell("Unselected right")]),
        ]);
        f.mutate(transform => transform.replaceWith(0, transform.doc.content.size, table));
      }
      const from = contentType === "image" ? 1 : 6;
      const to = contentType === "image" ? f.content().content.size - 1 : 15;
      const request = f.request(from, to);
      assert.equal(request.sourceText, contentType === "image" ? "Hello world\nKeep this." : "pha\nBe");
      assert.equal(isTextOnlySelection(f.content(), from, to), false);
      assert.equal(isTextOnlySelection(f.content(), contentType === "image" ? 1 : 4, contentType === "image" ? 12 : 9), true);
      const code = editorSchema.node("doc", null, [editorSchema.node("codeBlock", null, editorSchema.text("first\nsecond"))]);
      assert.equal(isTextOnlySelection(code, 1, code.content.size - 1), true);
      const before = f.rooms.snapshotForAi(f.documentId);
      assert.deepEqual(await f.ai.create(f.owner, f.documentId, request), { success: false, error: unsafeAiSelectionReason });
      assert.equal(generations, 0);
      assert.deepEqual(await f.repository.loadAiSuggestions(), []);

      const clone = new Y.Doc();
      Y.applyUpdate(clone, before);
      const fragment = clone.getXmlFragment("default");
      const mapped = initProseMirrorDoc(fragment, editorSchema);
      const identity = createHash("sha256");
      for (let position = from; position <= to; position++) {
        identity.update(Y.encodeRelativePosition(absolutePositionToRelativePosition(position, fragment, mapped.mapping)));
      }
      const now = new Date().toISOString();
      const suggestion = { ...request, id: randomUUID(), documentId: f.documentId, authorId: f.owner.data.userId, authorName: "owner",
        replacement: "Replacement", model: null, createdAt: now, updatedAt: now, status: "ready" } satisfies AiSuggestion;
      await f.repository.saveAiSuggestions(f.documentId, [{ suggestion,
        sourceSlice: JSON.stringify(mapped.doc.slice(from, to).toJSON()), sourceIdentity: identity.digest("hex"),
      }]);
      clone.destroy();
      const restored = new AiSuggestionService({ rooms: f.rooms, repository: f.repository, configured: () => true,
        emit: () => {}, emitUpdate: (_id, update) => f.updates.push(update),
      });
      assert.deepEqual(await restored.resolve(f.editor, f.documentId, { suggestionId: suggestion.id, decision: "accept" }),
        { success: false, error: unsafeAiSelectionReason });
      assert.deepEqual(f.rooms.snapshotForAi(f.documentId), before);
      if (contentType === "image") assert.equal(f.content().child(1).type.name, "image");
      else assert.deepEqual(f.content().firstChild?.content.content.map(row => row.childCount), [2, 2]);
      assert.equal(f.updates.length, 0);
      const listed = await restored.list(f.owner, f.documentId);
      assert(listed.success);
      assert.equal(listed.suggestions[0]?.status, "ready");
    } finally { await f.cleanup(); }
  });
}

test("AI accepts multiple paragraphs within one cell and rejects nested or enclosing table ranges", async () => {
  const f = await fixture(async ({ onDelta }) => onDelta("Corrected\nText"));
  const paragraph = (text: string) => editorSchema.node("paragraph", null, editorSchema.text(text));
  const nested = editorSchema.node("table", null, [editorSchema.node("tableRow", null, [
    editorSchema.node("tableCell", null, [paragraph("Nested")]),
  ])]);
  const table = editorSchema.node("table", null, [editorSchema.node("tableRow", null, [
    editorSchema.node("tableHeader", null, [paragraph("Alpha"), paragraph("Beta")]),
    editorSchema.node("tableCell", null, [paragraph("Before nested"), nested, paragraph("After nested")]),
  ])]);
  try {
    f.mutate(transform => transform.replaceWith(0, transform.doc.content.size, [paragraph("Outside before"), table, paragraph("Outside after")]));
    const doc = f.content();
    const positions = new Map<string, number>();
    doc.descendants((node, position) => { if (node.isText) positions.set(node.textContent, position); });
    const position = (text: string) => {
      const value = positions.get(text);
      assert(value !== undefined, `Missing text ${text}`);
      return value;
    };
    const alpha = position("Alpha");
    const beta = position("Beta");
    const before = position("Before nested");
    const inside = position("Nested");
    const after = position("After nested");
    assert.equal(isTextOnlySelection(doc, inside, inside + 6), true);
    for (const [from, to] of [
      [before, inside + 6], [inside, after + 12], [before, after + 12],
      [position("Outside before"), alpha + 5], [beta, position("Outside after") + 13],
      [position("Outside before"), position("Outside after") + 13],
    ]) assert.equal(isTextOnlySelection(doc, from, to), false);
    const created = await f.ai.create(f.owner, f.documentId, { ...f.request(alpha, beta + 4), action: "grammar" });
    assert(created.success);
    await settled(f.ai, f.owner, f.documentId);
    assert((await f.ai.resolve(f.owner, f.documentId, { suggestionId: created.suggestion.id, decision: "accept" })).success);
    const expectedCell = editorSchema.node("tableHeader", null, [editorSchema.node("paragraph", null, [
      editorSchema.text("Corrected"), editorSchema.node("hardBreak"), editorSchema.text("Text"),
    ])]);
    const expectedDoc = editorSchema.node("doc", null, [paragraph("Outside before"),
      editorSchema.node("table", null, [editorSchema.node("tableRow", null, [expectedCell, table.child(0).child(1)])]),
      paragraph("Outside after"),
    ]);
    assert.deepEqual(f.content().toJSON(), expectedDoc.toJSON());
    f.content().check();
  } finally { await f.cleanup(); }
});

for (const decision of ["accept", "reject"] as const) {
  for (const recovery of ["retry", "flush"] as const) {
    test(`${decision} history save failures recover through ${recovery} without applying text twice`, async () => {
      const f = await fixture(async ({ onDelta }) => onDelta("Hi everyone"));
      const saveHistory = f.repository.saveAiSuggestions;
      try {
        const created = await f.ai.create(f.owner, f.documentId, f.request());
        assert(created.success);
        await settled(f.ai, f.owner, f.documentId);
        let fail = true;
        const writes: string[] = [];
        const saveState = f.repository.saveState;
        f.repository.saveState = async (...args) => { writes.push("document"); return saveState(...args); };
        f.repository.saveAiSuggestions = async (...args) => {
          writes.push("history");
          if (fail) throw new Error("Injected history save failure");
          await saveHistory(...args);
        };
        const request = { suggestionId: created.suggestion.id, decision };
        assert.equal((await f.ai.resolve(f.owner, f.documentId, request)).success, false);
        if (decision === "accept") assert.deepEqual(writes, ["document", "history"]);
        await assert.rejects(f.ai.flush(), /Injected history save failure/);
        fail = false;
        if (recovery === "retry") assert((await f.ai.resolve(f.owner, f.documentId, request)).success);
        else { f.rooms.beginDrain(); await f.rooms.flushAll(); }
        const restored = z.array(z.object({ suggestion: AiSuggestionSchema })).parse(await f.repository.loadAiSuggestions());
        assert.equal(restored[0]?.suggestion.status, decision === "accept" ? "accepted" : "rejected");
        assert.equal(f.content().firstChild?.textContent, decision === "accept" ? "Hi everyone" : "Hello world");
        assert.equal(f.updates.length, decision === "accept" ? 1 : 0);
      } finally {
        f.repository.saveAiSuggestions = saveHistory;
        await f.cleanup();
      }
    });
  }
}

for (const role of ["viewer", null] as const) {
  test(`initial AI save rejects creation after editor access changes to ${role}`, async () => {
    let generations = 0;
    const f = await fixture(async ({ onDelta }) => { generations++; onDelta("Hi"); });
    const saveHistory = f.repository.saveAiSuggestions;
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    let firstWrite = true;
    f.repository.saveAiSuggestions = async (...args) => {
      if (firstWrite) {
        firstWrite = false;
        started.resolve();
        await held.promise;
      }
      await saveHistory(...args);
    };
    try {
      const request = f.request();
      const original = f.ai.create(f.editor, f.documentId, request);
      await started.promise;
      const duplicate = f.ai.create(f.editor, f.documentId, request);
      f.rooms.reconcileAccessChange(f.documentId, f.editor.data.userId, role);
      held.resolve();
      const expected = { success: false, error: role === "viewer" ? "Unauthorized to edit this document" : "Not joined to this document" };
      assert.deepEqual(await original, expected);
      assert.deepEqual(await duplicate, expected);
      assert.equal(generations, 0);
      assert.equal(f.events.some(entry => entry.status === "streaming"), false);
      const [suggestion] = await settled(f.ai, f.owner, f.documentId);
      assert.equal(suggestion?.status, "failed");
      assert.equal(suggestion?.error, expected.error);
      const history = z.array(z.object({ suggestion: AiSuggestionSchema })).parse(await f.repository.loadAiSuggestions());
      assert.equal(history.length, 1);
      assert.equal(history[0]?.suggestion.status, "failed");
      assert.equal(history[0]?.suggestion.error, expected.error);
    } finally {
      held.resolve();
      f.repository.saveAiSuggestions = saveHistory;
      await f.cleanup();
    }
  });
}

for (const outcome of ["success", "failure", "delete", "drain"] as const) {
  test(`initial AI save ${outcome} keeps duplicate requests private until committed`, async () => {
    let generations = 0;
    const f = await fixture(async ({ onDelta }) => { generations++; onDelta("Hi"); });
    let existing: AiSuggestion | undefined;
    if (outcome === "failure") {
      const created = await f.ai.create(f.editor, f.documentId, f.request());
      assert(created.success);
      [existing] = await settled(f.ai, f.viewer, f.documentId);
      generations = 0;
      f.events.length = 0;
    }
    const saveHistory = f.repository.saveAiSuggestions;
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    let provisionalId = "";
    let firstWrite = true;
    f.repository.saveAiSuggestions = async (...args) => {
      if (firstWrite) {
        firstWrite = false;
        const entries = z.array(z.object({ suggestion: AiSuggestionSchema })).parse(args[1]);
        provisionalId = entries.at(-1)?.suggestion.id ?? "";
        started.resolve();
        await held.promise;
      }
      await saveHistory(...args);
    };
    try {
      const request = f.request();
      const original = f.ai.create(f.owner, f.documentId, request);
      await started.promise;
      let duplicateSettled = false;
      const duplicate = f.ai.create(f.owner, f.documentId, request).then(result => { duplicateSettled = true; return result; });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(duplicateSettled, false);
      assert.equal((await f.ai.create(f.editor, f.documentId, request)).success, false);
      const listed = await f.ai.list(f.viewer, f.documentId);
      assert(listed.success); assert.deepEqual(listed.suggestions, existing ? [existing] : []);
      assert.equal((await f.ai.resolve(f.owner, f.documentId, { suggestionId: provisionalId, decision: "reject" })).success, false);
      const resolving = existing ? f.ai.resolve(f.owner, f.documentId, { suggestionId: existing.id, decision: "reject" }) : undefined;
      if (outcome === "delete") f.rooms.handleDocumentDeleted(f.documentId, []);
      if (outcome === "drain") f.rooms.beginDrain();
      const flushing = f.ai.flush();
      if (outcome === "failure") held.reject(new Error("Injected initial save failure"));
      else held.resolve();
      const [first, second] = await Promise.all([original, duplicate]);
      if (resolving) assert((await resolving).success);
      await flushing;
      if (outcome === "success") {
        assert(first.success); assert(second.success);
        assert.equal(first.suggestion.id, second.suggestion.id);
        await settled(f.ai, f.viewer, f.documentId);
        assert.equal(generations, 1);
        const history = z.array(z.object({ suggestion: AiSuggestionSchema })).parse(await f.repository.loadAiSuggestions());
        assert.equal(history.length, 1);
        assert.equal(history[0]?.suggestion.status, "ready");
      } else {
        assert.equal(generations, 0);
        assert.equal(f.events.some(entry => entry.status === "streaming"), false);
        if (outcome === "failure") {
          assert.deepEqual(first, { success: false, error: "Could not save AI suggestion" });
          assert.deepEqual(second, first);
          const history = z.array(z.object({ suggestion: AiSuggestionSchema })).parse(await f.repository.loadAiSuggestions());
          assert.equal(history.length, 1);
          assert.equal(history[0]?.suggestion.id, existing?.id);
          assert.equal(history[0]?.suggestion.status, "rejected");
        } else if (outcome === "delete") {
          assert.equal(first.success, false); assert.equal(second.success, false);
          assert.deepEqual(f.events, []);
        } else {
          const history = z.array(z.object({ suggestion: AiSuggestionSchema })).parse(await f.repository.loadAiSuggestions());
          assert.equal(history[0]?.suggestion.status, "failed");
        }
      }
    } finally {
      held.resolve();
      f.repository.saveAiSuggestions = saveHistory;
      await f.cleanup();
    }
  });
}
