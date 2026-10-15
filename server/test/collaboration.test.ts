import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { editorSchema } from "@typesync/shared/editor-schema";

import { createDocumentRuntime, type DocumentRuntimeOptions } from "../src/socket/document-runtime.ts";
import { CollaborativeSyncManager } from "../../client/src/lib/sync-manager.ts";
import { CollaborativeRoomSession, type SessionAccess } from "../src/socket/room-session.ts";
import type { TypeSyncSocket } from "../src/socket/types.ts";
import { joinFailureAction } from "../../client/src/lib/join-failure.ts";

test("pending joins retain bounded state and stale completion cannot clear a replacement join", async () => {
  let loads = 0;
  const rooms = new CollaborativeRoomSession({ repository: {
    loadState: async () => { loads++; return null; },
    saveState: async () => ({ title: "Untitled", updatedAt: new Date() }),
  } });
  const roomNames = new Set<string>();
  const socket = {
    id: "socket", connected: true, data: { userId: "user", userName: "User" }, rooms: roomNames,
    join: (name: string) => { roomNames.add(name); },
    leave: (name: string) => { roomNames.delete(name); },
    emit: () => {},
  } as unknown as TypeSyncSocket;
  rooms.initializeSocket(socket);
  const states = Reflect.get(rooms, "socketJoins");
  assert(states instanceof Map);
  const state = states.get(socket.id);
  const editor = { hasAccess: true, role: "editor" } satisfies SessionAccess;
  const join = (documentId: string, checkSession = async () => "valid" as const,
    authorize: () => Promise<SessionAccess> = async () => editor) =>
    rooms.joinSession({ socket, documentId, checkSession, authorize });
  for (let index = 0; index < 100; index++) {
    await rooms.leaveSession(socket, `unknown-${index}`);
    assert.equal((await join(`forbidden-${index}`, undefined, async () => ({ hasAccess: false }))).success, false);
  }
  assert.deepEqual(state, { current: new Map(), inFlight: 0 });
  assert.equal(loads, 0);

  const gates = Array.from({ length: 8 }, () => Promise.withResolvers<"valid">());
  const pending = gates.map(gate => join("document", () => gate.promise));
  let checks = 0;
  let reads = 0;
  const limitedJoin = () => join("document", async () => { checks++; return "valid"; }, async () => { reads++; return editor; });
  assert.deepEqual(await limitedJoin(), { success: false, code: "rate-limited", error: "Too many pending document joins" });
  await rooms.leaveSession(socket, "document");
  assert.deepEqual(state, { current: new Map(), inFlight: 8 });
  assert.equal((await limitedJoin()).success, false);
  assert.equal(checks, 0);
  assert.equal(reads, 0);
  gates.slice(0, 7).forEach(gate => gate.resolve("valid"));
  for (const result of await Promise.all(pending.slice(0, 7))) {
    assert.deepEqual(result, { success: false, code: "cancelled", error: "Document join was cancelled" });
  }

  const finalRead = Promise.withResolvers<SessionAccess>();
  const reading = Promise.withResolvers<void>();
  let accessReads = 0;
  const replacement = join("document", undefined, async () => {
    if (++accessReads === 2) { reading.resolve(); return finalRead.promise; }
    return editor;
  });
  await reading.promise;
  rooms.reconcileAccessChange("document", "user", "viewer");
  gates[7]?.resolve("valid");
  assert.equal((await pending[7])?.success, false);
  finalRead.resolve(editor);
  const result = await replacement;
  assert(result.success);
  assert.equal(result.role, "viewer");
  assert.deepEqual(state, { current: new Map(), inFlight: 0 });
  assert.equal(rooms.aiAccess(socket, "document", true), "Unauthorized to edit this document");
  assert.equal(joinFailureAction("rate-limited"), "retry");

  const oldSession = Promise.withResolvers<"valid">();
  const disconnectedJoin = join("document", () => oldSession.promise);
  await rooms.handleDisconnect(socket);
  rooms.initializeSocket(socket);
  const replacementState = states.get(socket.id);
  assert.notEqual(replacementState, state);
  const newSession = Promise.withResolvers<"valid">();
  const newJoin = join("document", () => newSession.promise);
  oldSession.resolve("valid");
  assert.equal((await disconnectedJoin).success, false);
  assert.equal(replacementState.inFlight, 1);
  assert.equal(replacementState.current.size, 1);
  newSession.resolve("valid");
  assert.equal((await newJoin).success, true);
  assert.deepEqual(replacementState, { current: new Map(), inFlight: 0 });
  await rooms.waitForDrain();
  await rooms.leaveSession(socket, "document");
  await rooms.handleDisconnect(socket);
  assert.equal(states.size, 0);
});

test("shutdown saves unrelated documents while AI listeners settle and reports every failure", async () => {
  const stored = new Map<string, Uint8Array>();
  const attempts: string[] = [];
  const written = Promise.withResolvers<void>();
  const rooms = new CollaborativeRoomSession({
    repository: {
      loadState: async () => null,
      saveState: async (documentId, state) => {
        attempts.push(documentId);
        if (documentId === "failed-document") throw new Error("database unavailable");
        stored.set(documentId, state);
        written.resolve();
        return { title: "Untitled", updatedAt: new Date() };
      },
    },
    getRoomOccupancy: () => 1,
  });
  const roomNames = new Set<string>();
  const socket = {
    id: "socket", connected: true, data: { userId: "user", userName: "User" }, rooms: roomNames,
    join: (name: string) => { roomNames.add(name); },
    leave: (name: string) => { roomNames.delete(name); },
    emit: () => {},
  } as unknown as TypeSyncSocket;
  const doc = new Y.Doc();
  const saved = new Y.Doc();
  const history = Promise.withResolvers<void>();
  const syncError = new Error("AI listener threw synchronously");
  const asyncError = new Error("AI history save failed");
  const listeners: string[] = [];
  rooms.initializeSocket(socket);
  rooms.onAiFlush(() => { listeners.push("sync"); throw syncError; });
  rooms.onAiFlush(async () => { listeners.push("async"); throw asyncError; });
  rooms.onAiFlush(async () => { listeners.push("history"); await history.promise; });
  try {
    insertEditorText(doc, 0, "ordinary dirty edit");
    for (const documentId of ["ordinary-document", "failed-document"]) {
      assert.equal((await rooms.joinSession({
        socket, documentId, checkSession: async () => "valid",
        authorize: async () => ({ hasAccess: true, role: "owner" }),
      })).success, true);
      assert.equal(rooms.applyUpdate({ socket, documentId, update: Y.encodeStateAsUpdate(doc) }).success, true);
    }
    rooms.beginDrain();
    const flush = rooms.flushAll();
    const rejected = assert.rejects(flush, error => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors.slice(0, 2), [syncError, asyncError]);
      assert.match(error.errors[2].message, /failed-document/);
      assert.deepEqual(error.cause, { succeeded: ["ordinary-document"], failed: ["failed-document"] });
      return true;
    });
    await written.promise;
    assert.deepEqual(listeners, ["sync", "async", "history"]);
    assert.deepEqual(attempts, ["ordinary-document", "failed-document"]);
    history.resolve();
    await rejected;
    assert.deepEqual(attempts, ["ordinary-document", "failed-document"]);
    const state = stored.get("ordinary-document");
    assert(state);
    Y.applyUpdate(saved, state);
    assert.equal(editorText(saved).toString(), "ordinary dirty edit");
  } finally {
    history.resolve();
    rooms.handleDocumentDeleted("ordinary-document", []);
    rooms.handleDocumentDeleted("failed-document", []);
    doc.destroy();
    saved.destroy();
  }
});

test("an occupied runtime retries a failed explicit flush", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const runtime = createDocumentRuntime({
    repository: {
      loadState: async () => null,
      saveState: async () => {
        if (++attempts === 1) throw new Error("database unavailable");
        return { title: "Test", updatedAt: new Date() };
      },
    },
    roomOccupancyProvider: () => 1,
  });
  const doc = new Y.Doc();
  try {
    await runtime.ensureLoaded("document");
    insertEditorText(doc, 0, "accepted AI text");
    assert.equal(runtime.applyUpdate("document", Y.encodeStateAsUpdate(doc)).kind, "accepted");
    await assert.rejects(runtime.flushDocument("document"), /unavailable/);
    assert.equal(runtime.snapshotForJoin("document").persistedRevision, 0);
    context.mock.timers.tick(15_000);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(attempts, 2);
    assert.equal(runtime.snapshotForJoin("document").persistedRevision, 1);
  } finally {
    runtime.discard("document");
    doc.destroy();
  }
});

test("AI acceptance retains its persistence cursor through older acknowledgements and restart recovery", () => {
  const callbacks: Parameters<ConstructorParameters<typeof CollaborativeSyncManager>[0]["emitUpdate"]>[3][] = [];
  const updates: Uint8Array[] = [];
  const manager = new CollaborativeSyncManager({
    documentId: "document",
    emitUpdate(_id, update, _timeout, callback) { updates.push(update); callbacks.push(callback); },
    emitAwareness() {},
  });
  const local = new Y.Doc();
  try {
    manager.noteServerPersistence("epoch", 0);
    manager.setDocumentRole("owner");
    manager.setConnected(true);
    insertEditorText(local, 0, "local ");
    manager.enqueueDocumentUpdate(Y.encodeStateAsUpdate(local));
    insertEditorText(local, 6, "AI text");
    manager.noteAcceptedServerUpdate("epoch", 2);
    assert.equal(updates.length, 1);
    assert.equal(manager.getState().awaitingPersistence, true);
    callbacks[0]?.(null, { success: true, epoch: "epoch", revision: 1 });
    manager.notePersisted("epoch", 1);
    assert.equal(manager.getState().syncStatus, "syncing");
    manager.setConnected(false);
    manager.noteServerPersistence("restart", 0);
    manager.setConnected(true);
    manager.reconcilePendingUpdates(local, new Uint8Array([0, 0]));
    assert.equal(updates.length, 2);
    const recovered = new Y.Doc();
    try {
      const recoveryUpdate = updates[1];
      assert(recoveryUpdate);
      Y.applyUpdate(recovered, recoveryUpdate);
      assert.equal(editorText(recovered).toString(), "local AI text");
    } finally { recovered.destroy(); }
    callbacks[1]?.(null, { success: true, epoch: "restart", revision: 1 });
    manager.notePersisted("restart", 1);
    assert.equal(manager.getState().syncStatus, "synced");
    manager.notePersisted("restart", 2);
    manager.noteAcceptedServerUpdate("restart", 2);
    assert.equal(manager.getState().awaitingPersistence, false);
  } finally {
    manager.destroy();
    local.destroy();
  }
});

test("an unsaved join snapshot protects viewers without submitting an edit", () => {
  let sends = 0;
  const manager = new CollaborativeSyncManager({ documentId: "document", emitUpdate() { sends++; }, emitAwareness() {} });
  const local = new Y.Doc();
  try {
    insertEditorText(local, 0, "AI text");
    const state = Y.encodeStateAsUpdate(local);
    manager.noteServerPersistence("epoch", 0);
    manager.setDocumentRole("viewer", { flush: false });
    manager.setConnected(true);
    manager.reconcilePendingUpdates(local, state);
    manager.noteAcceptedServerUpdate("epoch", 1);
    assert.equal(sends, 0);
    assert.equal(manager.getState().hasPendingUpdates, false);
    assert.equal(manager.getState().awaitingPersistence, true);
    assert.equal(manager.getState().syncStatus, "syncing");
    manager.notePersisted("epoch", 1);
    assert.equal(manager.getState().syncStatus, "synced");
  } finally { manager.destroy(); local.destroy(); }
});

function editorText(doc: Y.Doc): Y.XmlText {
  const fragment = doc.getXmlFragment("default");
  if (fragment.length === 0) {
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText()]);
    fragment.insert(0, [paragraph]);
  }
  const paragraph = fragment.get(0);
  assert(paragraph instanceof Y.XmlElement);
  const text = paragraph.get(0);
  assert(text instanceof Y.XmlText);
  return text;
}

function insertEditorText(doc: Y.Doc, index: number, text: string): void {
  doc.transact(() => editorText(doc).insert(index, text));
}

for (const scenario of ["rejoin", "superseded join"]) {
  test(`${scenario} cannot restore editor authority after a viewer downgrade`, async () => {
    const rooms = new CollaborativeRoomSession({ repository: {
      loadState: async () => null,
      saveState: async () => ({ title: "Untitled", updatedAt: new Date() }),
    } });
    const roomNames = new Set<string>();
    const socket = {
      id: "socket", connected: true, data: { userId: "user", userName: "User" }, rooms: roomNames,
      join: (name: string) => { roomNames.add(name); },
      leave: (name: string) => { roomNames.delete(name); },
      emit: () => {},
    } as unknown as TypeSyncSocket;
    rooms.initializeSocket(socket);
    const editor = { hasAccess: true, role: "editor" } satisfies SessionAccess;
    const join = (authorize: () => Promise<SessionAccess>, checkSession = async () => "valid" as const) =>
      rooms.joinSession({ socket, documentId: "document", checkSession, authorize });
    const oldSession = Promise.withResolvers<"valid">();
    let oldJoin: ReturnType<typeof join> | undefined;
    if (scenario === "rejoin") {
      assert.equal((await join(async () => editor)).success, true);
    } else {
      oldJoin = join(async () => editor, () => oldSession.promise);
    }
    const finalRead = Promise.withResolvers<SessionAccess>();
    const reading = Promise.withResolvers<void>();
    let accessReads = 0;
    const pendingJoin = join(async () => {
      if (++accessReads === 2) {
        reading.resolve();
        return finalRead.promise;
      }
      return editor;
    });
    try {
      await reading.promise;
      rooms.reconcileAccessChange("document", "user", "viewer");
      if (oldJoin) {
        oldSession.resolve("valid");
        assert.deepEqual(await oldJoin, {
          success: false, code: "cancelled", error: "Document join was cancelled",
        });
      } else {
        assert.equal(rooms.aiAccess(socket, "document", true), "Unauthorized to edit this document");
      }
      finalRead.resolve(editor);
      const joined = await pendingJoin;
      assert(joined.success);
      assert.equal(joined.role, "viewer");
      assert.equal(joined.presence.role, "viewer");
      assert.equal(rooms.aiAccess(socket, "document", true), "Unauthorized to edit this document");
      assert.deepEqual(rooms.applyUpdate({ socket, documentId: "document", update: new Uint8Array() }), {
        success: false, code: "forbidden", error: "Unauthorized to edit this document",
      });
    } finally {
      oldSession.resolve("valid");
      finalRead.resolve(editor);
      await Promise.all([oldJoin, pendingJoin]);
      rooms.handleDocumentDeleted("document", []);
    }
  });
}

test("reconnecting restores remote dependencies before reporting local edits persisted", async () => {
  let stored: Uint8Array | null = null;
  const repository = {
    loadState: async () => stored,
    saveState: async (_id: string, state: Uint8Array) => {
      stored = state;
      return { title: "Untitled", updatedAt: new Date() };
    },
  };
  const saves: Parameters<NonNullable<DocumentRuntimeOptions["onDocumentSaved"]>>[0][] = [];
  const first = createDocumentRuntime({ repository, onDocumentSaved: (metadata) => saves.push(metadata) });
  await first.ensureLoaded("document");
  let runtime = first;
  const local = new Y.Doc();
  const manager = new CollaborativeSyncManager({
    documentId: "document",
    emitUpdate(_id, update, _timeout, acknowledge) {
      const result = runtime.applyUpdate("document", update);
      assert.equal(result.kind, "accepted");
      if (result.kind === "accepted") {
        acknowledge(null, { success: true, epoch: result.epoch, revision: result.revision });
      }
    },
    emitAwareness() {},
  });
  local.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") manager.enqueueDocumentUpdate(update);
  });
  const initial = first.snapshotForJoin("document");
  manager.noteServerPersistence(initial.epoch, initial.persistedRevision);
  manager.setDocumentRole("owner");
  manager.setConnected(true);
  insertEditorText(local, 0, "saved");
  await first.flushAll();
  assert.equal(saves[0]?.title, "Untitled");
  assert(saves[0]?.updatedAt instanceof Date);
  assert.equal(saves[0]?.epoch, initial.epoch);
  assert.equal(saves[0]?.revision, 1);
  manager.notePersisted(initial.epoch, 1);
  assert.equal(manager.getState().syncStatus, "synced");

  const collaborator = new Y.Doc();
  Y.applyUpdate(collaborator, first.snapshotForJoin("document").state);
  const vector = Y.encodeStateVector(collaborator);
  insertEditorText(collaborator, 5, "A");
  const remoteUpdate = Y.encodeStateAsUpdate(collaborator, vector);
  assert.equal(first.applyUpdate("document", remoteUpdate).kind, "accepted");
  Y.applyUpdate(local, remoteUpdate, "remote");
  insertEditorText(local, 6, "B");
  collaborator.destroy();

  const unsaved = first.snapshotForJoin("document");
  manager.cancelDeliveryAttempt();
  manager.setConnected(false);
  manager.noteServerPersistence(unsaved.epoch, unsaved.persistedRevision);
  manager.setConnected(true);
  manager.setDocumentRole("owner", { flush: false });
  manager.reconcilePendingUpdates(local, unsaved.state);
  assert.equal(manager.getState().awaitingPersistence, true);
  assert.equal(manager.getState().syncStatus, "syncing");

  manager.cancelDeliveryAttempt();
  manager.setConnected(false);
  first.discard("document");
  insertEditorText(local, 7, " offline edit");
  runtime = createDocumentRuntime({ repository });
  try {
    await runtime.ensureLoaded("document");
    const rejoined = runtime.snapshotForJoin("document");
    assert.notEqual(rejoined.epoch, initial.epoch);
    manager.noteServerPersistence(rejoined.epoch, rejoined.persistedRevision);
    manager.setDocumentRole("owner", { flush: false });
    manager.setConnected(true);
    manager.reconcilePendingUpdates(local, rejoined.state);
    assert.equal(manager.getState().awaitingPersistence, true);
    assert.equal(manager.getState().syncStatus, "syncing");
    const database = new Y.Doc();
    try {
      assert(stored);
      Y.applyUpdate(database, stored);
      assert.equal(editorText(database).toString(), "saved");
    } finally {
      database.destroy();
    }
    await runtime.flushAll();
    const persisted = runtime.snapshotForJoin("document");
    manager.notePersisted(persisted.epoch, persisted.persistedRevision);
    assert.equal(manager.getState().syncStatus, "synced");
    const reopened = new Y.Doc();
    try {
      assert(stored);
      Y.applyUpdate(reopened, stored);
      assert.equal(editorText(reopened).toString(), "savedAB offline edit");
      assert.equal(editorText(reopened).toString(), editorText(local).toString());
    } finally {
      reopened.destroy();
    }
  } finally {
    manager.destroy();
    runtime.discard("document");
    local.destroy();
  }
});

test("clean viewers send nothing, but acknowledged deletions survive reconnects", async () => {
  const local = new Y.Doc();
  insertEditorText(local, 0, "abc");
  editorText(local).delete(0, 1);
  let stored = Y.encodeStateAsUpdate(local);
  const repository = {
    loadState: async () => stored,
    saveState: async (_id: string, state: Uint8Array) => {
      stored = state;
      return { title: "Untitled", updatedAt: new Date() };
    },
  };
  let runtime = createDocumentRuntime({ repository });
  let sends = 0;
  const manager = new CollaborativeSyncManager({
    documentId: "document",
    emitUpdate(_id, update, _timeout, acknowledge) {
      sends += 1;
      const result = runtime.applyUpdate("document", update);
      assert.equal(result.kind, "accepted");
      if (result.kind === "accepted") {
        acknowledge(null, { success: true, epoch: result.epoch, revision: result.revision });
      }
    },
    emitAwareness() {},
  });
  try {
    await runtime.ensureLoaded("document");
    const initial = runtime.snapshotForJoin("document");
    manager.noteServerPersistence(initial.epoch, initial.persistedRevision);
    manager.setConnected(true);
    manager.setDocumentRole("viewer", { flush: false });
    manager.reconcilePendingUpdates(local, initial.state);
    assert.equal(sends, 0);
    assert.equal(manager.getState().syncStatus, "synced");
    assert.equal(manager.getState().hasPendingUpdates, false);

    manager.setDocumentRole("editor");
    local.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") manager.enqueueDocumentUpdate(update);
    });
    editorText(local).delete(0, 1);
    assert.equal(sends, 1);
    assert.equal(manager.getState().hasPendingUpdates, false);
    const collaborator = new Y.Doc();
    try {
      Y.applyUpdate(collaborator, runtime.snapshotForJoin("document").state);
      const vector = Y.encodeStateVector(collaborator);
      editorText(collaborator).delete(0, 1);
      const deletion = Y.encodeStateAsUpdate(collaborator, vector);
      assert.equal(runtime.applyUpdate("document", deletion).kind, "accepted");
      Y.applyUpdate(local, deletion, "remote");
    } finally {
      collaborator.destroy();
    }
    manager.cancelDeliveryAttempt();
    manager.setConnected(false);
    runtime.discard("document");
    runtime = createDocumentRuntime({ repository });
    await runtime.ensureLoaded("document");
    const rejoined = runtime.snapshotForJoin("document");
    manager.noteServerPersistence(rejoined.epoch, rejoined.persistedRevision);
    manager.setConnected(true);
    manager.setDocumentRole("viewer", { flush: false });
    manager.reconcilePendingUpdates(local, rejoined.state);
    assert.equal(sends, 1);
    assert.equal(manager.getState().hasPendingUpdates, true);
    assert.equal(manager.getState().syncStatus, "failed");
    manager.setDocumentRole("editor");
    assert.equal(sends, 2);
    await runtime.flushAll();
    const database = new Y.Doc();
    try {
      Y.applyUpdate(database, stored);
      assert.equal(editorText(database).toString(), "");
    } finally {
      database.destroy();
    }
  } finally {
    manager.destroy();
    runtime.discard("document");
    local.destroy();
  }
});

test("typing during backoff waits for the scheduled retry", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const local = new Y.Doc();
  let sends = 0;
  const manager = new CollaborativeSyncManager({
    documentId: "document",
    emitUpdate(_id, _update, _timeout, acknowledge) {
      sends += 1;
      acknowledge(null, { success: false, code: "unavailable", error: "Unavailable" });
    },
    emitAwareness() {},
  });
  try {
    manager.setDocumentRole("owner");
    manager.setConnected(true);
    local.on("update", (update: Uint8Array) => manager.enqueueDocumentUpdate(update));
    insertEditorText(local, 0, "a");
    insertEditorText(local, 1, "b");
    assert.equal(sends, 1);
    assert.equal(manager.getState().retrying, true);
    context.mock.timers.tick(1000);
    assert.equal(sends, 2);
  } finally {
    manager.destroy();
    local.destroy();
  }
});

test("size checks accept large pastes and shrinking edits without applying rejected updates", async () => {
  const repository = { loadState: async () => null, saveState: async () => ({ title: "Untitled", updatedAt: new Date() }) };
  const large = new Y.Doc();
  const runtime = createDocumentRuntime({ repository });
  try {
    await runtime.ensureLoaded("large");
    insertEditorText(large, 0, "x".repeat(1_100_000));
    assert.equal(runtime.applyUpdate("large", Y.encodeStateAsUpdate(large)).kind, "accepted");
  } finally {
    large.destroy();
    runtime.discard("large");
  }

  const local = new Y.Doc();
  insertEditorText(local, 0, "x".repeat(1000));
  const stored = Y.encodeStateAsUpdate(local);
  const full = createDocumentRuntime({
    repository: { ...repository, loadState: async () => stored },
    sizeLimits: {
      maxUpdateBytes: 1_000_000,
      warningBytes: stored.byteLength - 10,
      maxStateBytes: stored.byteLength,
    },
  });
  try {
    await full.ensureLoaded("full");
    assert.equal(full.snapshotForJoin("full").sizeStatus?.level, "limit");
    const vector = Y.encodeStateVector(local);
    insertEditorText(local, 1000, "growth");
    assert.equal(full.applyUpdate("full", Y.encodeStateAsUpdate(local, vector)).kind, "document-too-large");
    assert.deepEqual(full.snapshotForJoin("full").state, stored);
    assert.equal(full.applyUpdate("full", new Uint8Array([255])).kind, "invalid");
    assert.deepEqual(full.snapshotForJoin("full").state, stored);

    editorText(local).delete(0, editorText(local).length);
    const deletion = full.applyUpdate("full", Y.encodeStateAsUpdate(local, vector));
    assert.equal(deletion.kind, "accepted");
    if (deletion.kind === "accepted") assert.equal(deletion.status?.level, "ok");
    assert(full.snapshotForJoin("full").state.byteLength < stored.byteLength);
  } finally {
    full.discard("full");
    local.destroy();
  }
});


test("table resource validation rejects unsafe updates and stored states and accepts merged content", async context => {
  context.mock.method(console, "error", () => {});
  const paragraph = editorSchema.node("paragraph", null, [editorSchema.text("line one"), editorSchema.node("hardBreak"), editorSchema.text("line two")]);
  const cell = (attrs: Record<string, unknown> = {}, content = [paragraph], type = "tableCell") => editorSchema.node(type, attrs, content);
  const row = (cells = [cell()]) => editorSchema.node("tableRow", null, cells);
  const table = (rows = 1, colspan = 1) => editorSchema.node("table", null, Array.from({ length: rows }, () => row([cell({ colspan })])));
  const oversizedNested = editorSchema.node("table", null, [row([cell({ colspan: 100 }, [paragraph, table()])]), ...Array.from({ length: 99 }, () => row([cell({ colspan: 100 })]))]);
  const cases = [
    ...[1_000_000, 0, -1, 1.5, NaN, Infinity, "2"].map(colspan => [editorSchema.node("table", null, [row([cell({ colspan })])])]),
    ...[0, -1, 1.5, Infinity, "2", 2, 201].map(rowspan => [editorSchema.node("table", null, [row([cell({ rowspan })])])]),
    ...[[], [1, 2], [-1], [Infinity], [NaN], [10_001], ["10"], "10"].map(colwidth => [editorSchema.node("table", null, [row([cell({ colwidth }, [paragraph], "tableHeader")])])]),
    [table(201)],
    [editorSchema.node("table", null, [row([cell({ colspan: 51 }), cell({ colspan: 50 })])])],
    [editorSchema.node("table", null, [row([cell({ colspan: 60, rowspan: 2 })]), row([cell({ colspan: 41 })])])],
    [table(101, 100)],
    [oversizedNested, ...Array.from({ length: 4 }, () => table(100, 100))],
    Array.from({ length: 6 }, () => table(100, 100)),
  ];
  let writes = 0;
  const runtime = createDocumentRuntime({ repository: {
    loadState: async () => null,
    saveState: async () => { writes++; return { title: "Test", updatedAt: new Date() }; },
  } });
  try {
    await runtime.ensureLoaded("document");
    const before = runtime.snapshotForJoin("document");
    for (const tables of cases) {
      const source = prosemirrorJSONToYDoc(editorSchema, editorSchema.node("doc", null, tables).toJSON(), "default");
      const update = Y.encodeStateAsUpdate(source);
      source.destroy();
      assert.equal(runtime.applyUpdate("document", update).kind, "invalid");
      assert.deepEqual(runtime.snapshotForJoin("document"), before);
      await runtime.flushDocument("document");
      assert.equal(writes, 0);
      const loaded = createDocumentRuntime({ repository: {
        loadState: async () => update,
        saveState: async () => { throw new Error("Unsafe tables must not be saved"); },
      } });
      await assert.rejects(loaded.ensureLoaded("unsafe"), /Malformed document state in database/);
      assert.throws(() => loaded.snapshotForJoin("unsafe"), /not loaded/);
    }
    const merged = editorSchema.node("table", null, [
      row([cell({ colspan: 2, rowspan: 2, colwidth: [100, 120] }, [paragraph, table()], "tableHeader"), cell()]),
      row([cell()]),
    ]);
    const valid = prosemirrorJSONToYDoc(editorSchema, editorSchema.node("doc", null, [merged, ...Array.from({ length: 4 }, () => table(100, 100))]).toJSON(), "default");
    try {
      assert.equal(runtime.applyUpdate("document", Y.encodeStateAsUpdate(valid)).kind, "accepted");
      await runtime.flushDocument("document");
      assert.equal(writes, 1);
      const state = runtime.snapshotForJoin("document").state;
      const loaded = createDocumentRuntime({ repository: {
        loadState: async () => state,
        saveState: async () => { throw new Error("Loading must not save"); },
      } });
      try { await loaded.ensureLoaded("valid"); assert.deepEqual(loaded.snapshotForJoin("valid").state, state); }
      finally { loaded.discard("valid"); }
    } finally { valid.destroy(); }
  } finally { runtime.discard("document"); }
});

test("link href validation rejects malformed updates and stored states while valid links persist and render", async context => {
  context.mock.method(console, "error", () => {});
  let stored: Uint8Array | null = null;
  let writes = 0;
  const repository = {
    loadState: async () => stored,
    saveState: async (_id: string, state: Uint8Array) => {
      stored = state;
      writes++;
      return { title: "Test", updatedAt: new Date() };
    },
  };
  const runtime = createDocumentRuntime({ repository });
  const reopened = createDocumentRuntime({ repository });
  const source = new Y.Doc();
  const restored = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  paragraph.insert(0, [text]);
  source.getXmlFragment("default").insert(0, [paragraph]);
  text.insert(0, "Link", { link: { href: "https://example.com" } });
  try {
    await runtime.ensureLoaded("document");
    assert.equal(runtime.applyUpdate("document", Y.encodeStateAsUpdate(source)).kind, "accepted");
    await runtime.flushDocument("document");
    const before = runtime.snapshotForJoin("document");
    assert.equal(writes, 1);
    for (const href of [7, null, true, [], {}]) {
      text.format(0, text.length, { link: { href } });
      const rejected = runtime.applyUpdate("document", Y.encodeStateAsUpdate(source));
      assert.equal(rejected.kind, "invalid");
      if (rejected.kind === "invalid") assert.match(String(rejected.error), /attribute href/);
      assert.deepEqual(runtime.snapshotForJoin("document"), before);
      await runtime.flushDocument("document");
      assert.equal(writes, 1);
      assert.deepEqual(stored, before.state);
      const unsafe = createDocumentRuntime({ repository: {
        loadState: async () => Y.encodeStateAsUpdate(source),
        saveState: async () => { throw new Error("Malformed links must not be saved"); },
      } });
      try {
        await assert.rejects(unsafe.ensureLoaded("unsafe"), /Malformed document state in database/);
        assert.throws(() => unsafe.snapshotForJoin("unsafe"), /not loaded/);
      } finally { unsafe.discard("unsafe"); }
    }
    await reopened.ensureLoaded("document");
    Y.applyUpdate(restored, reopened.snapshotForJoin("document").state);
    const content = editorSchema.nodeFromJSON(yXmlFragmentToProsemirrorJSON(restored.getXmlFragment("default")));
    content.check();
    const mark = content.firstChild?.firstChild?.marks[0];
    assert(mark);
    assert.equal(mark.attrs.href, "https://example.com");
    const render = mark.type.spec.toDOM;
    assert(render);
    assert.doesNotThrow(() => render(mark, true));
  } finally {
    runtime.discard("document");
    reopened.discard("document");
    source.destroy();
    restored.destroy();
  }
});

test("editor schema validation rejects corrupt updates and stored states without changing the document", async (context) => {
  context.mock.method(console, "error", () => {});
  let stored: Uint8Array | null = null;
  let writes = 0;
  const runtime = createDocumentRuntime({ repository: {
    loadState: async () => stored,
    saveState: async (_id, state) => {
      stored = state;
      writes += 1;
      return { title: "Untitled", updatedAt: new Date() };
    },
  } });
  const valid = new Y.Doc();
  const corrupt = [new Y.Doc(), new Y.Doc(), new Y.Doc(), new Y.Doc(), new Y.Doc()];
  try {
    await runtime.ensureLoaded("document");
    assert.equal(runtime.applyUpdate("document", Y.encodeStateAsUpdate(valid)).kind, "accepted");
    insertEditorText(valid, 0, "saved");
    const accepted = runtime.applyUpdate("document", Y.encodeStateAsUpdate(valid));
    assert.equal(accepted.kind, "accepted");
    if (accepted.kind === "accepted") assert.equal(accepted.revision, 1);
    await runtime.flushDocument("document");
    const before = runtime.snapshotForJoin("document");
    assert.equal(writes, 1);
    assert.equal(before.persistedRevision, 1);

    const [rootText, unknownNode, invalidNesting, rootMap, textEmbed] = corrupt;
    assert(rootText && unknownNode && invalidNesting && rootMap && textEmbed);
    rootText.getText("default").insert(0, "not XML");
    unknownNode.getXmlFragment("default").insert(0, [new Y.XmlElement("unknown")]);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlElement("paragraph")]);
    invalidNesting.getXmlFragment("default").insert(0, [paragraph]);
    rootMap.getMap("default").set("unexpected", "map content");
    insertEditorText(textEmbed, 0, "text");
    editorText(textEmbed).insertEmbed(0, { unexpected: "embed" });

    for (const doc of corrupt) {
      const update = Y.encodeStateAsUpdate(doc);
      assert.equal(runtime.applyUpdate("document", update).kind, "invalid");
      assert.deepEqual(runtime.snapshotForJoin("document"), before);
      await runtime.flushDocument("document");
      assert.equal(writes, 1);
      assert.deepEqual(stored, before.state);
      const loaded = createDocumentRuntime({ repository: {
        loadState: async () => update,
        saveState: async () => { throw new Error("Corrupt state must not be saved"); },
      } });
      await assert.rejects(loaded.ensureLoaded("corrupt"), /Malformed document state in database/);
      assert.throws(() => loaded.snapshotForJoin("corrupt"), /not loaded/);
    }

    const vector = Y.encodeStateVector(valid);
    insertEditorText(valid, 5, " edit");
    const incomplete = createDocumentRuntime({ repository: {
      loadState: async () => null,
      saveState: async () => { throw new Error("Unresolved content must not be saved"); },
    } });
    try {
      await incomplete.ensureLoaded("incomplete");
      const empty = incomplete.snapshotForJoin("incomplete");
      assert.equal(incomplete.applyUpdate("incomplete", Y.encodeStateAsUpdate(valid, vector)).kind, "invalid");
      assert.deepEqual(incomplete.snapshotForJoin("incomplete"), empty);
    } finally {
      incomplete.discard("incomplete");
    }
    const edited = runtime.applyUpdate("document", Y.encodeStateAsUpdate(valid, vector));
    assert.equal(edited.kind, "accepted");
    if (edited.kind === "accepted") assert.equal(edited.revision, 2);
    await runtime.flushDocument("document");
    assert.equal(writes, 2);
    const reopened = new Y.Doc();
    try {
      assert(stored);
      Y.applyUpdate(reopened, stored);
      assert.equal(editorText(reopened).toString(), "saved edit");
    } finally {
      reopened.destroy();
    }
  } finally {
    runtime.discard("document");
    valid.destroy();
    corrupt.forEach(doc => doc.destroy());
  }
});
