import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { DOCUMENT_MAX_UPDATE_BYTES, type DocumentSizeStatus } from "@typesync/shared";
import type { DocumentStateRepository } from "./repository.js";

interface PersistenceState {
  dirty: boolean;
  flushRequested: boolean;
  persisting?: Promise<void>;
  debounceTimer?: NodeJS.Timeout;
  maxWaitTimer?: NodeJS.Timeout;
  retryTimer?: NodeJS.Timeout;
  cancelled: boolean;
}

export interface DocumentRuntime {
  ensureLoaded(documentId: string): Promise<void>;
  snapshotForJoin(documentId: string): {
    state: Uint8Array;
    sizeStatus: DocumentSizeStatus | null;
    epoch: string;
    persistedRevision: number;
  };
  applyUpdate(documentId: string, update: Uint8Array): DocumentUpdateResult;
  evictIfEmpty(documentId: string): Promise<void>;
  discard(documentId: string): void;
  flushAll(): Promise<{ succeeded: string[]; failed: string[] }>;
}

export type DocumentUpdateResult =
  | { kind: "accepted"; status: DocumentSizeStatus | null; revision: number; epoch: string }
  | { kind: "update-too-large"; status: DocumentSizeStatus }
  | { kind: "document-too-large"; status: DocumentSizeStatus }
  | { kind: "not-loaded" }
  | { kind: "invalid"; error: unknown };

export interface DocumentSizeLimits {
  maxUpdateBytes: number;
  warningBytes: number;
  maxStateBytes: number;
}

const defaultDocumentSizeLimits: DocumentSizeLimits = {
  maxUpdateBytes: DOCUMENT_MAX_UPDATE_BYTES,
  warningBytes: 8 * 1024 * 1024,
  maxStateBytes: 10 * 1024 * 1024,
};

const SAVE_DEBOUNCE_INTERVAL = 5000;
const SAVE_MAX_WAIT_INTERVAL = 30000;
const SAVE_RETRY_INTERVAL = 15000;

function sizeStatus(
  documentId: string,
  bytes: number,
  limits: DocumentSizeLimits
): DocumentSizeStatus {
  return {
    documentId,
    level: bytes >= limits.maxStateBytes ? "limit" : bytes >= limits.warningBytes ? "warning" : "ok",
    reason: "document",
    bytes,
    maxBytes: limits.maxStateBytes,
  };
}

export interface DocumentRuntimeOptions {
  repository: DocumentStateRepository;
  roomOccupancyProvider?: (documentId: string) => number;
  onDocumentSaved?: (payload: {
    documentId: string;
    title: string;
    updatedAt: Date;
    revision: number;
    epoch: string;
  }) => void;
  sizeLimits?: DocumentSizeLimits;
}

export function createDocumentRuntime(
  options: DocumentRuntimeOptions
): DocumentRuntime {
  const repository = options.repository;
  const roomOccupancyProvider = options.roomOccupancyProvider ?? (() => 0);
  const onDocumentSavedCallback = options.onDocumentSaved;
  const limits = options.sizeLimits ?? defaultDocumentSizeLimits;

  const docs = new Map<string, Y.Doc>();
  const loadedDocs = new Set<string>();
  const loadingDocs = new Map<string, Promise<void>>();
  const persistenceStates = new Map<string, PersistenceState>();
  const documentRevisions = new Map<string, number>();
  const documentEpochs = new Map<string, string>();
  /** Highest encoded revision written to PostgreSQL for the current epoch. */
  const documentPersistedRevisions = new Map<string, number>();

  function assignPersistenceEpoch(docId: string): string {
    const existing = documentEpochs.get(docId);
    if (existing !== undefined) return existing;
    const epoch = randomUUID();
    documentEpochs.set(docId, epoch);
    return epoch;
  }

  function getOrCreateDoc(docId: string): Y.Doc {
    let doc = docs.get(docId);
    if (!doc) {
      doc = new Y.Doc();
      docs.set(docId, doc);
    }
    return doc;
  }

  async function loadDocFromDB(docId: string, ydoc: Y.Doc): Promise<void> {
    const state = await repository.loadState(docId);
    if (docs.get(docId) !== ydoc) {
      throw new Error("Document load was cancelled");
    }
    if (state) {
      try {
        Y.applyUpdate(ydoc, state);
      } catch (error) {
        console.error(`Malformed Yjs document state in DB for document ${docId}:`, error);
        throw new Error("Malformed document state in database", { cause: error });
      }
    }
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
        const encodedRevision = documentRevisions.get(docId) ?? 0;
        const encodedEpoch = documentEpochs.get(docId);
        const snapshot = Y.encodeStateAsUpdate(ydoc);
        try {
          const metadata = await repository.saveState(docId, snapshot);
          // A delete can remove the row while this write is in flight. Discard
          // already cancelled the runtime, so a missing row is not a failed save.
          if (state.cancelled) continue;
          if (!metadata) throw new Error(`Document ${docId} was not saved`);
          // A replacement runtime must not inherit this snapshot's cursor.
          if (encodedEpoch !== undefined && documentEpochs.get(docId) === encodedEpoch) {
            documentPersistedRevisions.set(docId, encodedRevision);
          }
          if (encodedEpoch !== undefined) {
            try {
              onDocumentSavedCallback?.({
                documentId: docId,
                title: metadata.title,
                updatedAt: metadata.updatedAt,
                revision: encodedRevision,
                epoch: encodedEpoch,
              });
            } catch (error) {
              console.error(`Failed to notify clients that ${docId} was saved:`, error);
            }
          }
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

    void runPersistence(docId, ydoc, state).then(
      () => {
        if (state.cancelled || docs.get(docId) !== ydoc) return;
        if (roomOccupancyProvider(docId) > 0) return;
        return evictIfEmpty(docId);
      },
      (error) => {
        if (state.cancelled) return;
        console.error(`Failed to save doc ${docId}; retrying:`, error);
        scheduleRetry(docId, ydoc, state);
      }
    );
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
        if (docs.get(docId) !== ydoc) {
          throw new Error("Document load was cancelled");
        }
        loadedDocs.add(docId);
        assignPersistenceEpoch(docId);
      })
      .finally(() => {
        if (loadingDocs.get(docId) === loadPromise) loadingDocs.delete(docId);
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
    documentRevisions.delete(documentId);
    documentEpochs.delete(documentId);
    documentPersistedRevisions.delete(documentId);
  }

  async function evictIfEmpty(documentId: string): Promise<void> {
    const currentOccupancy = roomOccupancyProvider(documentId);
    if (currentOccupancy > 0) return;

    const ydoc = docs.get(documentId);
    if (!ydoc || !loadedDocs.has(documentId)) return;

    try {
      await flushDocumentNow(documentId, ydoc);
      if (docs.get(documentId) !== ydoc) return;
      const postSaveOccupancy = roomOccupancyProvider(documentId);
      if (postSaveOccupancy > 0) return;
    } catch (error) {
      if (docs.get(documentId) !== ydoc) return;
      const state = persistenceStates.get(documentId);
      if (!state || state.cancelled) return;
      console.error(`Failed to save doc ${documentId}; keeping it in memory:`, error);
      scheduleRetry(documentId, ydoc, state);
      return;
    }

    discardRuntime(documentId);
  }

  return {
    async ensureLoaded(documentId) {
      const ydoc = getOrCreateDoc(documentId);
      try {
        await ensureDocLoaded(documentId, ydoc);
      } catch (error) {
        if (docs.get(documentId) === ydoc) discardRuntime(documentId);
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
        sizeStatus: sizeStatus(documentId, state.byteLength, limits),
        epoch: assignPersistenceEpoch(documentId),
        persistedRevision: documentPersistedRevisions.get(documentId) ?? 0,
      };
    },

    applyUpdate(documentId, update) {
      if (update.byteLength > limits.maxUpdateBytes) {
        return {
          kind: "update-too-large",
          status: {
            documentId,
            level: "limit",
            reason: "update",
            bytes: update.byteLength,
            maxBytes: limits.maxUpdateBytes,
          },
        };
      }

      const ydoc = docs.get(documentId);
      if (!ydoc || !loadedDocs.has(documentId)) return { kind: "not-loaded" };

      const candidate = new Y.Doc();
      try {
        const before = Y.encodeStateAsUpdate(ydoc);
        Y.applyUpdate(candidate, before);
        Y.applyUpdate(candidate, update);
        const after = Y.encodeStateAsUpdate(candidate);
        const previousStatus = sizeStatus(documentId, before.byteLength, limits);
        const nextStatus = sizeStatus(documentId, after.byteLength, limits);

        if (after.byteLength > limits.maxStateBytes && after.byteLength >= before.byteLength) {
          return { kind: "document-too-large", status: nextStatus };
        }

        let revision = documentRevisions.get(documentId) ?? 0;
        if (!Buffer.from(before).equals(after)) {
          Y.applyUpdate(ydoc, update);
          revision += 1;
          documentRevisions.set(documentId, revision);
          scheduleSave(documentId, ydoc);
        }
        return {
          kind: "accepted",
          status: nextStatus.level !== previousStatus.level ? nextStatus : null,
          revision,
          epoch: assignPersistenceEpoch(documentId),
        };
      } catch (error) {
        return { kind: "invalid", error };
      } finally {
        candidate.destroy();
      }
    },

    evictIfEmpty,

    discard(documentId) {
      discardRuntime(documentId);
    },

    async flushAll() {
      const docEntries = Array.from(docs.entries());
      const succeeded: string[] = [];
      const failed: string[] = [];
      if (docEntries.length === 0) return { succeeded, failed };

      const results = await Promise.all(
        docEntries.map(async ([docId, ydoc]) => {
          try {
            await flushDocumentNow(docId, ydoc);
            return { docId, status: "fulfilled" } as const;
          } catch (error) {
            return { docId, status: "rejected", error } as const;
          }
        })
      );

      results.forEach((result) => {
        const { docId } = result;
        if (result.status === "fulfilled") {
          succeeded.push(docId);
        } else {
          failed.push(docId);
          console.error(`Failed to save document ${docId} during flush:`, result.error);
        }
      });

      return { succeeded, failed };
    },
  };
}
