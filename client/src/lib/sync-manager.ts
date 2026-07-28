import * as Y from "yjs";
import type { DocumentSizeStatus } from "@typesync/shared";

const DOCUMENT_UPDATE_ACK_TIMEOUT_MS = 5_000;
const MAX_MERGED_UPDATE_BYTES = 512 * 1024;
const MAX_RETRY_DELAY_MS = 10_000;

export type SyncStatus = "offline" | "syncing" | "synced" | "failed";

export interface SyncState {
  isConnected: boolean;
  documentSizeStatus: DocumentSizeStatus | null;
  hasPendingUpdates: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  isSyncBlocked: boolean;
}

export interface CollaborativeSyncManagerOptions {
  documentId: string;
  ydoc: Y.Doc;
  emitUpdate: (
    documentId: string,
    update: Uint8Array,
    timeoutMs: number,
    callback: (error: any, result: any) => void
  ) => void;
  emitAwareness: (documentId: string, update: Uint8Array) => void;
  onAccessLost?: () => void;
  onJoinRequired?: () => void;
}

export class CollaborativeSyncManager {
  private documentId: string;
  private ydoc: Y.Doc;
  private emitUpdate: CollaborativeSyncManagerOptions["emitUpdate"];
  private emitAwareness: CollaborativeSyncManagerOptions["emitAwareness"];
  private onAccessLost?: () => void;
  private onJoinRequired?: () => void;

  private state: SyncState = {
    isConnected: false,
    documentSizeStatus: null,
    hasPendingUpdates: false,
    syncStatus: "offline",
    syncError: null,
    isSyncBlocked: false,
  };

  private listeners = new Set<(state: SyncState) => void>();

  private disposed = false;
  private joined = false;
  private nextBatchId = 1;
  private activeBatchId: number | null = null;
  private deliveryGeneration = 0;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private deliveryBlocked = false;
  private pendingBatches: { id: number; update: Uint8Array }[] = [];

  constructor(options: CollaborativeSyncManagerOptions) {
    this.documentId = options.documentId;
    this.ydoc = options.ydoc;
    this.emitUpdate = options.emitUpdate;
    this.emitAwareness = options.emitAwareness;
    this.onAccessLost = options.onAccessLost;
    this.onJoinRequired = options.onJoinRequired;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return this.state;
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  setConnected(connected: boolean): void {
    this.joined = connected;
    this.updateState({
      isConnected: connected,
      syncStatus: this.deliveryBlocked
        ? "failed"
        : connected
          ? this.pendingBatches.length > 0
            ? "syncing"
            : "synced"
          : "offline",
      syncError: connected || this.deliveryBlocked ? this.state.syncError : null,
    });
  }

  setDocumentSizeStatus(status: DocumentSizeStatus | null): void {
    this.updateState({ documentSizeStatus: status });
  }

  handleAccessLost(): void {
    this.setConnected(false);
    this.onAccessLost?.();
  }

  sendAwareness(update: Uint8Array): void {
    if (this.disposed || !this.joined) return;
    this.emitAwareness(this.documentId, update);
  }

  enqueueDocumentUpdate(update: Uint8Array): void {
    const mergeableIndex = this.activeBatchId === null ? 0 : 1;
    const lastBatch = this.pendingBatches.at(-1);
    if (lastBatch && this.pendingBatches.length > mergeableIndex) {
      const merged = Y.mergeUpdates([lastBatch.update, update]);
      if (merged.byteLength <= MAX_MERGED_UPDATE_BYTES) {
        lastBatch.update = merged;
        this.refreshPendingState();
        this.flushPendingUpdates();
        return;
      }
    }

    this.pendingBatches.push({ id: this.nextBatchId++, update });
    this.refreshPendingState();
    this.flushPendingUpdates();
  }

  reconcilePendingUpdates(serverStateVector: Uint8Array): void {
    this.cancelDeliveryAttempt();
    if (this.deliveryBlocked) {
      this.refreshPendingState();
      return;
    }
    this.retryAttempt = 0;
    this.updateState({ syncError: null, isSyncBlocked: false });
    this.pendingBatches = [];

    const localDelta = Y.encodeStateAsUpdate(this.ydoc, serverStateVector);
    if (localDelta.byteLength > 2) {
      this.pendingBatches.push({ id: this.nextBatchId++, update: localDelta });
    }
    this.refreshPendingState();
    this.flushPendingUpdates();
  }

  flushPendingUpdates(socketConnected = true): void {
    if (
      this.disposed ||
      !this.joined ||
      !socketConnected ||
      this.deliveryBlocked ||
      this.activeBatchId !== null ||
      this.pendingBatches.length === 0
    ) {
      return;
    }

    const batch = this.pendingBatches[0];
    this.activeBatchId = batch.id;
    const generation = ++this.deliveryGeneration;
    this.updateState({ syncStatus: "syncing", syncError: null });

    this.emitUpdate(
      this.documentId,
      batch.update,
      DOCUMENT_UPDATE_ACK_TIMEOUT_MS,
      (error, result) => {
        if (
          this.disposed ||
          generation !== this.deliveryGeneration ||
          this.activeBatchId !== batch.id
        ) {
          return;
        }

        this.activeBatchId = null;
        if (error) {
          this.scheduleRetry(
            socketConnected,
            "The server did not acknowledge these changes. Retrying…"
          );
          return;
        }

        if (!result.success) {
          if (
            result.code === "server-draining" ||
            result.code === "rate-limited"
          ) {
            this.scheduleRetry(socketConnected, `${result.error}. Retrying…`);
            return;
          }
          if (
            result.code === "not-joined" ||
            result.code === "document-not-loaded"
          ) {
            this.onJoinRequired?.();
            return;
          }

          this.deliveryBlocked = true;
          this.updateState({
            syncStatus: "failed",
            syncError: result.error,
            isSyncBlocked: true,
          });
          this.refreshPendingState();
          return;
        }

        this.pendingBatches.shift();
        this.retryAttempt = 0;
        this.updateState({ syncError: null, isSyncBlocked: false });
        this.refreshPendingState();
        this.flushPendingUpdates(socketConnected);
      }
    );
  }

  cancelDeliveryAttempt(): void {
    this.deliveryGeneration += 1;
    this.activeBatchId = null;
    this.clearRetryTimer();
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private scheduleRetry(socketConnected: boolean, message: string): void {
    if (this.disposed || this.retryTimer || !this.joined || !socketConnected || this.deliveryBlocked) return;
    this.updateState({
      syncStatus: "failed",
      syncError: message,
      isSyncBlocked: false,
    });
    const delay = Math.min(1_000 * 2 ** this.retryAttempt, MAX_RETRY_DELAY_MS);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.flushPendingUpdates(socketConnected);
    }, delay);
  }

  private refreshPendingState(): void {
    if (!this.disposed) {
      const hasPendingUpdates = this.pendingBatches.length > 0;
      this.updateState({
        hasPendingUpdates,
        syncStatus: this.deliveryBlocked || this.state.syncError
          ? "failed"
          : !this.joined
            ? "offline"
            : hasPendingUpdates
              ? "syncing"
              : "synced",
      });
    }
  }

  destroy(): void {
    this.disposed = true;
    this.cancelDeliveryAttempt();
    this.listeners.clear();
  }
}
