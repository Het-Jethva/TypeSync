import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { createDocumentRuntime } from "../src/socket/document-runtime.ts";
import { CollaborativeSyncManager } from "../../client/src/lib/sync-manager.ts";

test("reconnecting after a server restart waits for the new edits to persist", async () => {
  let stored: Uint8Array | null = null;
  const repository = {
    loadState: async () => stored,
    saveState: async (_id: string, state: Uint8Array) => {
      stored = state;
      return new Date();
    },
  };
  const first = createDocumentRuntime({ repository });
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
  local.on("update", (update: Uint8Array) => manager.enqueueDocumentUpdate(update));
  const initial = first.snapshotForJoin("document");
  manager.noteServerPersistence(initial.epoch, initial.persistedRevision);
  manager.setDocumentRole("owner");
  manager.setConnected(true);
  local.getText("default").insert(0, "saved");
  await first.flushAll();
  manager.notePersisted(initial.epoch, 1);
  assert.equal(manager.getState().syncStatus, "synced");

  manager.cancelDeliveryAttempt();
  manager.setConnected(false);
  first.discard("document");
  local.getText("default").insert(5, " offline edit");
  runtime = createDocumentRuntime({ repository });
  try {
    await runtime.ensureLoaded("document");
    const rejoined = runtime.snapshotForJoin("document");
    assert.notEqual(rejoined.epoch, initial.epoch);
    manager.noteServerPersistence(rejoined.epoch, rejoined.persistedRevision);
    manager.setDocumentRole("owner", { flush: false });
    manager.setConnected(true);
    manager.reconcilePendingUpdates();
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
    manager.notePersisted(rejoined.epoch, 1);
    assert.equal(manager.getState().syncStatus, "synced");
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
      return new Date();
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
    manager.reconcilePendingUpdates();
    assert.equal(sends, 0);
    assert.equal(manager.getState().syncStatus, "synced");
    assert.equal(manager.getState().hasPendingUpdates, false);

    manager.setDocumentRole("editor");
    local.on("update", (update: Uint8Array) => manager.enqueueDocumentUpdate(update));
    local.getText("default").delete(0, 1);
    assert.equal(sends, 1);
    assert.equal(manager.getState().hasPendingUpdates, false);
    manager.cancelDeliveryAttempt();
    manager.setConnected(false);
    runtime.discard("document");
    runtime = createDocumentRuntime({ repository });
    await runtime.ensureLoaded("document");
    const rejoined = runtime.snapshotForJoin("document");
    manager.noteServerPersistence(rejoined.epoch, rejoined.persistedRevision);
    manager.setConnected(true);
    manager.setDocumentRole("editor", { flush: false });
    manager.reconcilePendingUpdates();
    assert.equal(sends, 2);
    await runtime.flushAll();
    const database = new Y.Doc();
    try {
      Y.applyUpdate(database, stored);
      assert.equal(database.getText("default").toString(), "c");
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
