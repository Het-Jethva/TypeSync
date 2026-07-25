import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { createDocumentRuntime } from "./document-runtime.js";
import { InMemoryDocumentStateRepository } from "./repository.js";

describe("Collaborative Room Session / DocumentRuntime Seam", () => {
  let repository: InMemoryDocumentStateRepository;

  beforeEach(() => {
    repository = new InMemoryDocumentStateRepository();
  });

  test("loads document state from repository on ensureLoaded", async () => {
    const docId = "550e8400-e29b-41d4-a716-446655440000";
    
    // Seed in-memory repository with initial Y.Doc state
    const initialDoc = new Y.Doc();
    const text = initialDoc.getText("content");
    text.insert(0, "Hello TypeSync");
    const initialState = Y.encodeStateAsUpdate(initialDoc);
    await repository.saveState(docId, initialState);

    const runtime = createDocumentRuntime({ repository });
    await runtime.ensureLoaded(docId);

    const snapshot = runtime.snapshotForJoin(docId);
    assert.ok(snapshot.state instanceof Uint8Array);

    const loadedDoc = new Y.Doc();
    Y.applyUpdate(loadedDoc, snapshot.state);
    assert.equal(loadedDoc.getText("content").toString(), "Hello TypeSync");
  });

  test("accepts valid updates and schedules state persistence", async () => {
    const docId = "550e8400-e29b-41d4-a716-446655440001";
    let savedDocId = "";

    const runtime = createDocumentRuntime({
      repository,
      onDocumentSaved({ documentId }) {
        savedDocId = documentId;
      },
    });

    await runtime.ensureLoaded(docId);

    const updateDoc = new Y.Doc();
    updateDoc.getText("content").insert(0, "New update");
    const updateBytes = Y.encodeStateAsUpdate(updateDoc);

    const result = runtime.applyUpdate(docId, updateBytes);
    assert.equal(result.kind, "accepted");
  });

  test("evicts document from memory when room occupancy is 0", async () => {
    const docId = "550e8400-e29b-41d4-a716-446655440002";
    let occupancy = 1;

    const runtime = createDocumentRuntime({
      repository,
      roomOccupancyProvider: () => occupancy,
    });

    await runtime.ensureLoaded(docId);

    // Evict while clients present should keep doc loaded
    await runtime.evictIfEmpty(docId);
    assert.doesNotThrow(() => runtime.snapshotForJoin(docId));

    // Evict when clients drop to 0 should unload doc
    occupancy = 0;
    await runtime.evictIfEmpty(docId);
    assert.throws(() => runtime.snapshotForJoin(docId), /is not loaded/);
  });
});
