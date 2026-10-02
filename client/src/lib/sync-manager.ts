import * as Y from "yjs";
import {
  canEditDocument,
  DOCUMENT_MAX_UPDATE_BYTES,
  type DocumentSizeStatus,
  type DocumentUpdateResult,
  type Role,
} from "@typesync/shared";

const DOCUMENT_UPDATE_ACK_TIMEOUT_MS = 5_000;
const MAX_RETRY_DELAY_MS = 10_000;

export type SyncStatus = "offline" | "syncing" | "synced" | "failed";

export interface SyncState {
  documentSizeStatus: DocumentSizeStatus | null;
  /** Local bytes the server has not acknowledged. */
  hasPendingUpdates: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  isSyncBlocked: boolean;
  /** A failed send has a timer armed. The pill reads this instead of the error text. */
  retrying: boolean;
  /** Server-acked edits that are not in a completed PostgreSQL snapshot yet. */
  awaitingPersistence: boolean;
}

export interface CollaborativeSyncManagerOptions {
  documentId: string;
  emitUpdate: (
    documentId: string,
    update: Uint8Array,
    timeoutMs: number,
    callback: (error: Error | null, result: DocumentUpdateResult | undefined) => void
  ) => void;
  emitAwareness: (documentId: string, update: Uint8Array) => void;
  onAccessLost?: () => void;
  onJoinRequired?: () => void;
}

export class CollaborativeSyncManager {
  private documentId: string;
  private emitUpdate: CollaborativeSyncManagerOptions["emitUpdate"];
  private emitAwareness: CollaborativeSyncManagerOptions["emitAwareness"];
  private onAccessLost?: () => void;
  private onJoinRequired?: () => void;

  private state: SyncState = {
    documentSizeStatus: null,
    hasPendingUpdates: false,
    syncStatus: "offline",
    syncError: null,
    isSyncBlocked: false,
    retrying: false,
    awaitingPersistence: false,
  };

  /** Null until a join or an ack names the server runtime. */
  private persistenceEpoch: string | null = null;
  /** Revision on the latest successful ack. Persistence must catch up to this. */
  private ackedRevision = 0;
  /** Highest saved revision in `persistenceEpoch` that covered the latest ack. */
  private persistedRevision = 0;
  private acknowledgedBatches: { id: number; update: Uint8Array }[] = [];

  private listeners = new Set<(state: SyncState) => void>();

  private disposed = false;
  private joined = false;
  private nextBatchId = 1;
  private activeBatchId: number | null = null;
  private deliveryGeneration = 0;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private deliveryBlocked = false;
  /** Pauses outbound sends after `forbidden` or while the role is viewer. */
  private permissionHold = false;
  private documentRole: Role | null = null;
  private roleEpoch = 0;
  private pendingBatches: { id: number; update: Uint8Array }[] = [];

  constructor(options: CollaborativeSyncManagerOptions) {
    this.documentId = options.documentId;
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

  setConnected(connected: boolean, options?: { syncError: string | null }): void {
    this.joined = connected;
    const hasPendingUpdates = this.pendingBatches.length > 0;
    const syncError = options
      ? options.syncError
      : connected || this.deliveryBlocked || this.permissionHold
        ? this.state.syncError
        : null;
    this.updateState({
      syncStatus: this.deriveSyncStatus(hasPendingUpdates, syncError),
      syncError,
    });
  }

  setDocumentSizeStatus(status: DocumentSizeStatus | null): void {
    this.updateState({ documentSizeStatus: status });
  }

  /**
   * Records a snapshot revision captured when that save was encoded.
   * Another runtime's epoch does not count. A revision older than the latest
   * ack is an in-flight save from before that edit and does not count.
   */
  notePersisted(epoch: string, revision: number): void {
    if (this.disposed || epoch !== this.persistenceEpoch || revision < this.ackedRevision) return;
    const nextPersisted = Math.max(this.persistedRevision, revision);
    if (nextPersisted === this.persistedRevision) return;
    this.persistedRevision = nextPersisted;
    this.acknowledgedBatches = [];
    this.refreshPendingState();
  }

  /**
   * Joined runtime's saved cursor. A new epoch drops this client's acks.
   * The server revision is not an ack: other people's saves must not look
   * like this client's, and a higher local ack stays unsynced until it catches up.
   */
  noteServerPersistence(epoch: string, serverPersistedRevision: number): void {
    if (this.disposed) return;
    if (epoch !== this.persistenceEpoch) {
      this.persistenceEpoch = epoch;
      this.ackedRevision = 0;
      this.persistedRevision = 0;
    } else if (serverPersistedRevision >= this.ackedRevision) {
      this.acknowledgedBatches = [];
    }
    this.persistedRevision = Math.max(this.persistedRevision, serverPersistedRevision);
    this.refreshPendingState();
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
      if (merged.byteLength <= DOCUMENT_MAX_UPDATE_BYTES) {
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

  /**
   * Records the role that gates outbound updates.
   * Join passes `flush: false` until pending delivery has been reconciled.
   */
  setDocumentRole(role: Role, options?: { flush?: boolean }): void {
    const dropRetryCopy = !this.deliveryBlocked && this.state.retrying;
    this.documentRole = role;
    this.roleEpoch += 1;
    const canEdit = canEditDocument(role);
    this.permissionHold = !canEdit;
    this.clearRetryTimer();

    if (!canEdit) {
      if (dropRetryCopy) {
        this.updateState({ syncError: null, isSyncBlocked: false });
      }
      this.refreshPendingState();
      return;
    }

    this.retryAttempt = 0;
    if (!this.deliveryBlocked) {
      this.updateState({ syncError: null, isSyncBlocked: false });
    }
    this.refreshPendingState();
    if (options?.flush !== false) {
      this.flushPendingUpdates();
    }
  }

  reconcilePendingUpdates(local: Y.Doc, serverState: Uint8Array): void {
    this.cancelDeliveryAttempt();
    if (this.deliveryBlocked) {
      this.refreshPendingState();
      return;
    }
    this.retryAttempt = 0;
    if (!this.permissionHold) {
      this.updateState({ syncError: null, isSyncBlocked: false });
    }
    this.pendingBatches = [...this.acknowledgedBatches, ...this.pendingBatches];
    this.acknowledgedBatches = [];
    const server = new Y.Doc();
    try {
      Y.applyUpdate(server, serverState);
      // State vectors omit deletions. Applying the delta to the joined state
      // emits only real changes, including missing remote dependencies.
      server.on("update", (update: Uint8Array) => {
        this.pendingBatches = [{ id: this.nextBatchId++, update }];
      });
      Y.applyUpdate(server, Y.encodeStateAsUpdate(local, Y.encodeStateVector(server)));
    } finally {
      server.destroy();
    }
    this.refreshPendingState();
    if (this.permissionHold) return;
    this.flushPendingUpdates();
  }

  private flushPendingUpdates(): void {
    if (
      this.disposed ||
      !this.joined ||
      this.deliveryBlocked ||
      this.permissionHold ||
      this.retryTimer !== undefined ||
      this.activeBatchId !== null ||
      this.pendingBatches.length === 0
    ) {
      return;
    }

    const batch = this.pendingBatches[0];
    if (!batch) return;
    this.activeBatchId = batch.id;
    const generation = ++this.deliveryGeneration;
    const roleEpochAtSend = this.roleEpoch;
    this.updateState({ syncStatus: "syncing", syncError: null, retrying: false });

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
        if (error || result === undefined) {
          this.scheduleRetry("The server did not acknowledge these changes. Retrying…");
          return;
        }

        if (!result.success) {
          if (
            result.code === "server-draining" ||
            result.code === "rate-limited" ||
            result.code === "unavailable"
          ) {
            this.scheduleRetry(`${result.error}. Retrying…`);
            return;
          }
          if (
            result.code === "not-joined" ||
            result.code === "document-not-loaded"
          ) {
            this.onJoinRequired?.();
            return;
          }
          // The server disconnects on a resolved expiry. Keep the batch so
          // the next join can reconcile it; a terminal block would drop it.
          if (result.code === "session-expired") {
            this.refreshPendingState();
            return;
          }
          if (result.code === "forbidden") {
            const grantedWhileInFlight =
              canEditDocument(this.documentRole) && roleEpochAtSend !== this.roleEpoch;
            if (grantedWhileInFlight) {
              this.permissionHold = false;
              this.updateState({ syncError: null, isSyncBlocked: false });
              this.refreshPendingState();
              this.flushPendingUpdates();
              return;
            }

            this.permissionHold = true;
            this.updateState({
              syncStatus: "failed",
              syncError: result.error,
              isSyncBlocked: false,
            });
            this.refreshPendingState();
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
        // Only saves from the acknowledged runtime can cover these edits.
        if (result.epoch !== this.persistenceEpoch) {
          this.persistenceEpoch = result.epoch;
          this.persistedRevision = 0;
        }
        this.ackedRevision = result.revision;
        if (this.ackedRevision > this.persistedRevision) {
          this.acknowledgedBatches.push(batch);
        }
        const acceptedUpdate =
          this.state.documentSizeStatus?.reason === "update"
            ? { documentSizeStatus: null }
            : {};
        this.updateState({ syncError: null, isSyncBlocked: false, ...acceptedUpdate });
        this.refreshPendingState();
        this.flushPendingUpdates();
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
    if (this.disposed || !this.state.retrying) return;
    this.updateState({ retrying: false });
  }

  private scheduleRetry(message: string): void {
    if (
      this.disposed ||
      this.retryTimer ||
      !this.joined ||
      this.deliveryBlocked ||
      this.permissionHold
    ) {
      return;
    }
    this.updateState({
      syncStatus: "failed",
      syncError: message,
      isSyncBlocked: false,
      retrying: true,
    });
    const delay = Math.min(1_000 * 2 ** this.retryAttempt, MAX_RETRY_DELAY_MS);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.flushPendingUpdates();
    }, delay);
  }

  private deriveSyncStatus(hasPendingUpdates: boolean, syncError = this.state.syncError): SyncStatus {
    if (this.deliveryBlocked) return "failed";
    if (!this.joined) return "offline";
    // Pending edits stay failed until the role can send them, without using
    // the retry path. "Synced" means the last ack is in a PostgreSQL snapshot.
    if (this.permissionHold && hasPendingUpdates) return "failed";
    if (syncError) return "failed";
    if (hasPendingUpdates || this.ackedRevision > this.persistedRevision) return "syncing";
    return "synced";
  }

  private refreshPendingState(): void {
    if (!this.disposed) {
      const hasPendingUpdates = this.pendingBatches.length > 0;
      this.updateState({
        hasPendingUpdates,
        syncStatus: this.deriveSyncStatus(hasPendingUpdates),
        awaitingPersistence: this.ackedRevision > this.persistedRevision,
      });
    }
  }

  destroy(): void {
    this.disposed = true;
    this.cancelDeliveryAttempt();
    this.listeners.clear();
  }
}
