import * as Y from "yjs";
import type { DocumentSizeStatus } from "@typesync/shared";
import {
  DrizzleDocumentStateRepository,
  type DocumentStateRepository,
} from "./repository.js";

interface PersistenceState {
  dirty: boolean;
  flushRequested: boolean;
  persisting?: Promise<void>;
  debounceTimer?: NodeJS.Timeout;
  maxWaitTimer?: NodeJS.Timeout;
  retryTimer?: NodeJS.Timeout;
  cancelled: boolean;
}

interface DocumentSizeState {
  encodedBytes: number;
  pendingUpdateBytes: number;
  warningEmitted: boolean;
}

export interface DocumentRuntime {
  ensureLoaded(documentId: string): Promise<void>;
  snapshotForJoin(documentId: string): {
    state: Uint8Array;
    stateVector: Uint8Array;
    sizeStatus: DocumentSizeStatus | null;
  };
  applyUpdate(documentId: string, update: Uint8Array): DocumentUpdateResult;
  evictIfEmpty(documentId: string, occupancy?: number): Promise<void>;
  discard(documentId: string): void;
  flushAll(): Promise<{ succeeded: string[]; failed: string[] }>;
}

export type DocumentUpdateResult =
  | { kind: "accepted"; status: DocumentSizeStatus | null }
  | { kind: "update-too-large"; status: DocumentSizeStatus }
  | { kind: "document-too-large"; status: DocumentSizeStatus | null }
  | { kind: "not-loaded" }
  | { kind: "invalid"; error: unknown };

const docs = new Map<string, Y.Doc>();
const loadedDocs = new Set<string>();
const loadingDocs = new Map<string, Promise<void>>();
const persistenceStates = new Map<string, PersistenceState>();
const documentSizeStates = new Map<string, DocumentSizeState>();

const SAVE_DEBOUNCE_INTERVAL = 5000;
const SAVE_MAX_WAIT_INTERVAL = 30000;
const SAVE_RETRY_INTERVAL = 15000;
const MAX_DOC_UPDATE_BYTES = 1 * 1024 * 1024;
const DOC_SIZE_WARNING_BYTES = 8 * 1024 * 1024;
const MAX_DOC_STATE_BYTES = 10 * 1024 * 1024;

function getOrCreateDoc(docId: string): Y.Doc {
  let doc = docs.get(docId);
  if (!doc) {
    doc = new Y.Doc();
    docs.set(docId, doc);
  }
  return doc;
}

function recordEncodedDocumentSize(docId: string, ydoc: Y.Doc): number {
  const encodedBytes = Y.encodeStateAsUpdate(ydoc).byteLength;
  documentSizeStates.set(docId, {
    encodedBytes,
    pendingUpdateBytes: 0,
    warningEmitted: encodedBytes >= DOC_SIZE_WARNING_BYTES,
  });
  return encodedBytes;
}

function getDocumentSizeState(docId: string, ydoc: Y.Doc): DocumentSizeState {
  let state = documentSizeStates.get(docId);
  if (!state) {
    recordEncodedDocumentSize(docId, ydoc);
    state = documentSizeStates.get(docId)!;
  }
  return state;
}

function sizeStatus(documentId: string, bytes: number): DocumentSizeStatus | null {
  if (bytes < DOC_SIZE_WARNING_BYTES) return null;
  return {
    documentId,
    level: bytes >= MAX_DOC_STATE_BYTES ? "limit" : "warning",
    reason: "document",
    bytes,
    maxBytes: MAX_DOC_STATE_BYTES,
  };
}

function preflightDocumentUpdate(
  docId: string,
  ydoc: Y.Doc,
  update: Uint8Array
): { allowed: boolean; status: DocumentSizeStatus | null } {
  const state = getDocumentSizeState(docId, ydoc);
  if (state.encodedBytes >= MAX_DOC_STATE_BYTES) {
    return { allowed: false, status: sizeStatus(docId, state.encodedBytes) };
  }

  const projectedUpperBound =
    state.encodedBytes + state.pendingUpdateBytes + update.byteLength;
  const needsWarningCheckpoint =
    !state.warningEmitted && projectedUpperBound >= DOC_SIZE_WARNING_BYTES;
  const needsLimitCheckpoint = projectedUpperBound > MAX_DOC_STATE_BYTES;

  if (!needsWarningCheckpoint && !needsLimitCheckpoint) {
    state.pendingUpdateBytes += update.byteLength;
    return { allowed: true, status: null };
  }

  const currentSnapshot = Y.encodeStateAsUpdate(ydoc);
  const candidateSnapshot = Y.mergeUpdates([currentSnapshot, update]);

  if (candidateSnapshot.byteLength > MAX_DOC_STATE_BYTES) {
    state.encodedBytes = currentSnapshot.byteLength;
    state.pendingUpdateBytes = 0;
    return {
      allowed: false,
      status: {
        documentId: docId,
        level: "limit",
        reason: "document",
        bytes: candidateSnapshot.byteLength,
        maxBytes: MAX_DOC_STATE_BYTES,
      },
    };
  }

  state.encodedBytes = candidateSnapshot.byteLength;
  state.pendingUpdateBytes = 0;
  const crossedWarning =
    !state.warningEmitted && candidateSnapshot.byteLength >= DOC_SIZE_WARNING_BYTES;
  if (crossedWarning) state.warningEmitted = true;
  return {
    allowed: true,
    status: crossedWarning
      ? sizeStatus(docId, candidateSnapshot.byteLength)
      : null,
  };
}

export interface DocumentRuntimeOptions {
  repository?: DocumentStateRepository;
  roomOccupancyProvider?: (documentId: string) => number;
  onDocumentSaved?: (payload: { documentId: string; updatedAt: Date }) => void;
}

export function createDocumentRuntime(
  options: DocumentRuntimeOptions = {}
): DocumentRuntime {
  const repository = options.repository ?? new DrizzleDocumentStateRepository();
  const roomOccupancyProvider = options.roomOccupancyProvider ?? (() => 0);
  const onDocumentSavedCallback = options.onDocumentSaved;

  async function loadDocFromDB(docId: string, ydoc: Y.Doc): Promise<void> {
    const state = await repository.loadState(docId);
    if (state) {
      try {
        Y.applyUpdate(ydoc, state);
      } catch (error) {
        console.error(`Malformed Yjs document state in DB for document ${docId}:`, error);
        throw new Error("Malformed document state in database", { cause: error });
      }
    }
  }

  async function saveDocToDB(docId: string, state: Uint8Array): Promise<Date> {
    return await repository.saveState(docId, state);
  }

  function getPersistenceState(docId: string): PersistenceState {
    let state = persistenceStates.get(docId);
    if (!state) {
      state = { dirty: false, flushRequested: false, cancelled: false };
      persistenceStates.set(docId, state);
    }
    return state;
  }

  function clearPersistenceTimers(state: PersistenceState): void {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    if (state.maxWaitTimer) clearTimeout(state.maxWaitTimer);
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.debounceTimer = undefined;
    state.maxWaitTimer = undefined;
    state.retryTimer = undefined;
  }

  async function runPersistence(docId: string, ydoc: Y.Doc, state: PersistenceState): Promise<void> {
    if (state.persisting) return state.persisting;

    const operation = (async () => {
      while (state.flushRequested && !state.cancelled) {
        state.flushRequested = false;
        clearPersistenceTimers(state);
        if (!state.dirty) continue;

        state.dirty = false;
        const snapshot = Y.encodeStateAsUpdate(ydoc);
        documentSizeStates.set(docId, {
          encodedBytes: snapshot.byteLength,
          pendingUpdateBytes: 0,
          warningEmitted: snapshot.byteLength >= DOC_SIZE_WARNING_BYTES,
        });
        try {
          const updatedAt = await saveDocToDB(docId, snapshot);
          onDocumentSavedCallback?.({ documentId: docId, updatedAt });
        } catch (error) {
          state.dirty = true;
          throw error;
        }
      }
    })();

    state.persisting = operation;
    try {
      await operation;
    } finally {
      if (state.persisting === operation) state.persisting = undefined;
    }
  }

  function scheduleRetry(docId: string, ydoc: Y.Doc, state: PersistenceState): void {
    if (state.cancelled || state.retryTimer) return;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = undefined;
      triggerScheduledFlush(docId, ydoc, state);
    }, SAVE_RETRY_INTERVAL);
  }

  function triggerScheduledFlush(docId: string, ydoc: Y.Doc, state: PersistenceState): void {
    if (state.cancelled) return;
    state.flushRequested = true;
    if (state.persisting) return;

    void runPersistence(docId, ydoc, state).catch((error) => {
      if (state.cancelled) return;
      console.error(`Failed to save doc ${docId}; retrying:`, error);
      scheduleRetry(docId, ydoc, state);
    });
  }

  function scheduleSave(docId: string, ydoc: Y.Doc): void {
    const state = getPersistenceState(docId);
    state.dirty = true;

    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = undefined;
      triggerScheduledFlush(docId, ydoc, state);
    }, SAVE_DEBOUNCE_INTERVAL);

    if (!state.maxWaitTimer) {
      state.maxWaitTimer = setTimeout(() => {
        state.maxWaitTimer = undefined;
        triggerScheduledFlush(docId, ydoc, state);
      }, SAVE_MAX_WAIT_INTERVAL);
    }
  }

  async function flushDocumentNow(docId: string, ydoc: Y.Doc): Promise<void> {
    const state = getPersistenceState(docId);
    clearPersistenceTimers(state);

    while (!state.cancelled) {
      state.flushRequested = true;
      await runPersistence(docId, ydoc, state);
      if (!state.dirty && !state.persisting) return;
    }
  }

  function discardPersistenceState(docId: string): void {
    const state = persistenceStates.get(docId);
    documentSizeStates.delete(docId);
    if (!state) return;
    state.cancelled = true;
    state.flushRequested = false;
    clearPersistenceTimers(state);
    persistenceStates.delete(docId);
  }

  async function ensureDocLoaded(docId: string, ydoc: Y.Doc): Promise<void> {
    if (loadedDocs.has(docId)) return;

    const existingLoad = loadingDocs.get(docId);
    if (existingLoad) {
      await existingLoad;
      return;
    }

    const loadPromise = loadDocFromDB(docId, ydoc)
      .then(() => {
        loadedDocs.add(docId);
        recordEncodedDocumentSize(docId, ydoc);
      })
      .finally(() => {
        loadingDocs.delete(docId);
      });
    loadingDocs.set(docId, loadPromise);
    await loadPromise;
  }

  function discardRuntime(documentId: string): void {
    discardPersistenceState(documentId);
    const ydoc = docs.get(documentId);
    if (ydoc) {
      ydoc.destroy();
      docs.delete(documentId);
    }
    loadedDocs.delete(documentId);
    loadingDocs.delete(documentId);
    documentSizeStates.delete(documentId);
  }

  return {
    async ensureLoaded(documentId) {
      const ydoc = getOrCreateDoc(documentId);
      try {
        await ensureDocLoaded(documentId, ydoc);
      } catch (error) {
        discardRuntime(documentId);
        throw error;
      }
    },

    snapshotForJoin(documentId) {
      const ydoc = docs.get(documentId);
      if (!ydoc || !loadedDocs.has(documentId)) {
        throw new Error(`Document ${documentId} is not loaded`);
      }
      const state = Y.encodeStateAsUpdate(ydoc);
      return {
        state,
        stateVector: Y.encodeStateVector(ydoc),
        sizeStatus: sizeStatus(documentId, state.byteLength),
      };
    },

    applyUpdate(documentId, update) {
      if (update.byteLength > MAX_DOC_UPDATE_BYTES) {
        return {
          kind: "update-too-large",
          status: {
            documentId,
            level: "limit",
            reason: "update",
            bytes: update.byteLength,
            maxBytes: MAX_DOC_UPDATE_BYTES,
          },
        };
      }

      const ydoc = docs.get(documentId);
      if (!ydoc) return { kind: "not-loaded" };

      try {
        Y.decodeUpdate(update);
      } catch (error) {
        return { kind: "invalid", error };
      }

      let preflight: { allowed: boolean; status: DocumentSizeStatus | null };
      try {
        preflight = preflightDocumentUpdate(documentId, ydoc, update);
      } catch (error) {
        return { kind: "invalid", error };
      }
      if (!preflight.allowed) {
        return { kind: "document-too-large", status: preflight.status };
      }

      try {
        Y.applyUpdate(ydoc, update);
      } catch (error) {
        recordEncodedDocumentSize(documentId, ydoc);
        return { kind: "invalid", error };
      }
      scheduleSave(documentId, ydoc);
      return { kind: "accepted", status: preflight.status };
    },

    async evictIfEmpty(documentId, occupancy) {
      const currentOccupancy = occupancy ?? roomOccupancyProvider(documentId);
      if (currentOccupancy > 0) return;

      const ydoc = docs.get(documentId);
      if (!ydoc) return;

      try {
        await flushDocumentNow(documentId, ydoc);
        const postSaveOccupancy = roomOccupancyProvider(documentId);
        if (postSaveOccupancy > 0) return;
      } catch (error) {
        console.error(`Failed to save doc ${documentId}; keeping it in memory:`, error);
        const state = getPersistenceState(documentId);
        scheduleRetry(documentId, ydoc, state);
        return;
      }

      discardRuntime(documentId);
    },

    discard(documentId) {
      discardRuntime(documentId);
    },

    async flushAll() {
      const docEntries = Array.from(docs.entries());
      const succeeded: string[] = [];
      const failed: string[] = [];
      if (docEntries.length === 0) return { succeeded, failed };

      const results = await Promise.allSettled(
        docEntries.map(async ([docId, ydoc]) => {
          await flushDocumentNow(docId, ydoc);
          return docId;
        })
      );

      results.forEach((result, index) => {
        const docId = docEntries[index][0];
        if (result.status === "fulfilled") {
          succeeded.push(docId);
        } else {
          failed.push(docId);
          console.error(`Failed to save document ${docId} during flushAndCleanup:`, result.reason);
        }
      });

      console.log(`Flushed ${succeeded.length} documents successfully, ${failed.length} failed to save.`);
      return { succeeded, failed };
    },
  };
}
