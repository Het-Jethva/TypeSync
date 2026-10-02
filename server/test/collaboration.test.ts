import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { createDocumentRuntime, type DocumentRuntimeOptions } from "../src/socket/document-runtime.ts";
import { CollaborativeSyncManager } from "../../client/src/lib/sync-manager.ts";

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
  local.getText("default").insert(0, "saved");
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
  collaborator.getText("default").insert(5, "A");
  const remoteUpdate = Y.encodeStateAsUpdate(collaborator, vector);
  assert.equal(first.applyUpdate("document", remoteUpdate).kind, "accepted");
  Y.applyUpdate(local, remoteUpdate, "remote");
  local.getText("default").insert(6, "B");
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
  local.getText("default").insert(7, " offline edit");
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
      assert.equal(database.getText("default").toString(), "saved");
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
      assert.equal(reopened.getText("default").toString(), "savedAB offline edit");
      assert.equal(reopened.getText("default").toString(), local.getText("default").toString());
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
  local.getText("default").insert(0, "abc");
  local.getText("default").delete(0, 1);
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
    local.getText("default").delete(0, 1);
    assert.equal(sends, 1);
    assert.equal(manager.getState().hasPendingUpdates, false);
    const collaborator = new Y.Doc();
    try {
      Y.applyUpdate(collaborator, runtime.snapshotForJoin("document").state);
      const vector = Y.encodeStateVector(collaborator);
      collaborator.getText("default").delete(0, 1);
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
      assert.equal(database.getText("default").toString(), "");
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
    local.getText("default").insert(0, "a");
    local.getText("default").insert(1, "b");
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
    large.getText("default").insert(0, "x".repeat(1_100_000));
    assert.equal(runtime.applyUpdate("large", Y.encodeStateAsUpdate(large)).kind, "accepted");
  } finally {
    large.destroy();
    runtime.discard("large");
  }

  const local = new Y.Doc();
  local.getText("default").insert(0, "x".repeat(1000));
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
    local.getText("default").insert(1000, "growth");
    assert.equal(full.applyUpdate("full", Y.encodeStateAsUpdate(local, vector)).kind, "document-too-large");
    assert.deepEqual(full.snapshotForJoin("full").state, stored);
    assert.equal(full.applyUpdate("full", new Uint8Array([255])).kind, "invalid");
    assert.deepEqual(full.snapshotForJoin("full").state, stored);

    local.getText("default").delete(0, local.getText("default").length);
    const deletion = full.applyUpdate("full", Y.encodeStateAsUpdate(local, vector));
    assert.equal(deletion.kind, "accepted");
    if (deletion.kind === "accepted") assert.equal(deletion.status?.level, "ok");
    assert(full.snapshotForJoin("full").state.byteLength < stored.byteLength);
  } finally {
    full.discard("full");
    local.destroy();
  }
});
