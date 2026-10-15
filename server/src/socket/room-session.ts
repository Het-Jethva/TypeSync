import {
  canEditDocument,
  type DocumentJoinErrorCode,
  type DocumentJoinResult,
  type DocumentSizeStatus,
  type DocumentUpdateResult,
  type Role,
} from "@typesync/shared";
import { createAwarenessManager } from "./awareness.js";
import { createDocumentRuntime, type DocumentRuntimeOptions } from "./document-runtime.js";
import type { SocketSessionCheck, TypeSyncSocket } from "./types.js";

const DOCUMENT_UPDATES_PER_SECOND = 30;
const DOCUMENT_UPDATE_BURST_SIZE = 60;
const MAX_PENDING_JOINS_PER_SOCKET = 8;

interface PendingJoin {
  roleOverride?: Role;
}

interface SocketJoinState {
  current: Map<string, PendingJoin>;
  inFlight: number;
}

export type SessionAccess =
  | { hasAccess: true; role: Role }
  | { hasAccess: false };

type JoinSuccess = Extract<DocumentJoinResult, { success: true }> & {
  awarenessSnapshot: Uint8Array | null;
  sizeStatus: DocumentSizeStatus | null;
};

export type CollaborativeRoomJoinResult =
  | JoinSuccess
  | Extract<DocumentJoinResult, { success: false }>;

function rejectedJoin(
  code: DocumentJoinErrorCode,
  error: string
): Extract<CollaborativeRoomJoinResult, { success: false }> {
  return { success: false, code, error };
}

function formatByteSize(bytes: number): string {
  const mebibyte = 1024 * 1024;
  if (bytes % mebibyte === 0) return `${bytes / mebibyte} MiB`;
  return `${bytes} bytes`;
}

export interface CollaborativeRoomSessionOptions extends DocumentRuntimeOptions {
  getRoomOccupancy?: (documentId: string) => number;
}

export class CollaborativeRoomSession {
  private readonly socketRoles = new Map<string, Map<string, Role>>();
  private readonly socketJoins = new Map<string, SocketJoinState>();
  private readonly sockets = new Map<string, TypeSyncSocket>();
  private readonly pendingJoinCounts = new Map<string, number>();
  private readonly pendingJoinWaiters = new Set<() => void>();
  private readonly updateTokens = new Map<string, { tokens: number; lastRefill: number }>();
  private isDraining = false;
  private readonly lifecycleListeners = new Set<(documentId: string | null) => void>();
  private readonly aiFlushListeners = new Set<() => Promise<void>>();
  private readonly documentSavedListeners = new Set<NonNullable<DocumentRuntimeOptions["onDocumentSaved"]>>();

  private readonly runtime;
  private readonly awarenessManager;
  private readonly getRoomOccupancy: (documentId: string) => number;

  constructor(options: CollaborativeRoomSessionOptions) {
    this.getRoomOccupancy = options.getRoomOccupancy ?? (() => 0);
    this.runtime = createDocumentRuntime({
      repository: options.repository,
      roomOccupancyProvider: (documentId) => this.holdCount(documentId),
      onDocumentSaved: payload => {
        const listeners = [...this.documentSavedListeners];
        if (options.onDocumentSaved) listeners.unshift(options.onDocumentSaved);
        for (const listener of listeners) {
          try { listener(payload); }
          catch (error) { console.error(`Failed to notify a document-save listener for ${payload.documentId}:`, error); }
        }
      },
      sizeLimits: options.sizeLimits,
    });
    this.awarenessManager = createAwarenessManager();
  }

  initializeSocket(socket: TypeSyncSocket): void {
    this.sockets.set(socket.id, socket);
    this.socketRoles.set(socket.id, new Map());
    this.socketJoins.set(socket.id, { current: new Map(), inFlight: 0 });
    this.updateTokens.set(socket.id, {
      tokens: DOCUMENT_UPDATE_BURST_SIZE,
      lastRefill: Date.now(),
    });

    this.awarenessManager.initializeSocket(socket);
  }

  beginDrain(): void {
    this.isDraining = true;
    for (const listener of this.lifecycleListeners) listener(null);
  }

  onAiLifecycle(listener: (documentId: string | null) => void): void {
    this.lifecycleListeners.add(listener);
  }

  onAiFlush(listener: () => Promise<void>): void {
    this.aiFlushListeners.add(listener);
  }

  onDocumentSaved(listener: NonNullable<DocumentRuntimeOptions["onDocumentSaved"]>): void {
    this.documentSavedListeners.add(listener);
  }

  aiAccess(socket: TypeSyncSocket, documentId: string, edit = false): string | null {
    if (this.isDraining) return "Server is shutting down";
    if (!socket.connected || !socket.rooms.has(`doc:${documentId}`)) return "Not joined to this document";
    const role = this.getRole(socket.id, documentId);
    if (!role || (edit && !canEditDocument(role))) return "Unauthorized to edit this document";
    return null;
  }

  snapshotForAi(documentId: string): Uint8Array {
    return this.runtime.snapshotForJoin(documentId).state;
  }

  flushDocumentForAi(documentId: string): Promise<void> {
    return this.runtime.flushDocument(documentId);
  }

  waitForDrain(): Promise<void> {
    if (this.pendingJoinCounts.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.pendingJoinWaiters.add(resolve));
  }

  private resolvePendingJoinWaiters(): void {
    if (this.pendingJoinCounts.size > 0) return;
    for (const resolve of this.pendingJoinWaiters) resolve();
    this.pendingJoinWaiters.clear();
  }

  private isCurrentJoin(socket: TypeSyncSocket, documentId: string, state: SocketJoinState, join: PendingJoin): boolean {
    return socket.connected && this.sockets.get(socket.id) === socket &&
      this.socketJoins.get(socket.id) === state && state.current.get(documentId) === join;
  }

  private consumeUpdateToken(socketId: string): boolean {
    let bucket = this.updateTokens.get(socketId);
    if (!bucket) {
      bucket = { tokens: DOCUMENT_UPDATE_BURST_SIZE, lastRefill: Date.now() };
      this.updateTokens.set(socketId, bucket);
    }

    const now = Date.now();
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      DOCUMENT_UPDATE_BURST_SIZE,
      bucket.tokens + elapsedSeconds * DOCUMENT_UPDATES_PER_SECOND
    );
    bucket.lastRefill = now;

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private getRole(socketId: string, documentId: string): Role | undefined {
    return this.socketRoles.get(socketId)?.get(documentId);
  }

  private setRole(socketId: string, documentId: string, role: Role): void {
    let roles = this.socketRoles.get(socketId);
    if (!roles) {
      roles = new Map();
      this.socketRoles.set(socketId, roles);
    }
    roles.set(documentId, role);
  }

  private clearRole(socketId: string, documentId: string): void {
    this.socketRoles.get(socketId)?.delete(documentId);
  }

  private setJoinRoleOverride(socketId: string, documentId: string, role: Role): void {
    const join = this.socketJoins.get(socketId)?.current.get(documentId);
    if (join) join.roleOverride = role;
  }

  async joinSession(params: {
    socket: TypeSyncSocket;
    documentId: string;
    checkSession: () => Promise<SocketSessionCheck>;
    authorize: () => Promise<SessionAccess>;
  }): Promise<CollaborativeRoomJoinResult> {
    const { socket, documentId, checkSession, authorize } = params;
    if (this.isDraining) {
      return rejectedJoin("server-draining", "Server is shutting down");
    }

    const joins = this.socketJoins.get(socket.id);
    if (!socket.connected || this.sockets.get(socket.id) !== socket || !joins) {
      return rejectedJoin("cancelled", "Document join was cancelled");
    }
    if (joins.inFlight >= MAX_PENDING_JOINS_PER_SOCKET) {
      return rejectedJoin("rate-limited", "Too many pending document joins");
    }
    const join: PendingJoin = {};
    joins.current.set(documentId, join);
    joins.inFlight += 1;

    this.pendingJoinCounts.set(
      documentId,
      (this.pendingJoinCounts.get(documentId) ?? 0) + 1
    );

    try {
      if (!this.isCurrentJoin(socket, documentId, joins, join)) {
        return rejectedJoin("cancelled", "Document join was cancelled");
      }

      const session = await checkSession();
      if (session === "expired") {
        return rejectedJoin("session-expired", "Session expired");
      }
      if (session === "unavailable") {
        return rejectedJoin("unavailable", "Session check unavailable");
      }
      if (!this.isCurrentJoin(socket, documentId, joins, join)) {
        return rejectedJoin("cancelled", "Document join was cancelled");
      }

      const initialAccess = await authorize();
      if (!initialAccess.hasAccess) {
        return rejectedJoin("forbidden", "Access denied");
      }
      if (!this.isCurrentJoin(socket, documentId, joins, join)) {
        return rejectedJoin("cancelled", "Document join was cancelled");
      }

      await this.runtime.ensureLoaded(documentId);

      if (!this.isCurrentJoin(socket, documentId, joins, join)) {
        return rejectedJoin("cancelled", "Document join was cancelled");
      }

      const currentAccess = await authorize();
      if (!currentAccess.hasAccess) {
        return rejectedJoin("forbidden", "Access denied");
      }

      if (!this.isCurrentJoin(socket, documentId, joins, join)) {
        return rejectedJoin("cancelled", "Document join was cancelled");
      }

      const role = join.roleOverride ?? currentAccess.role;
      const presence = this.awarenessManager.presenceFor(socket, role);

      const snapshot = this.runtime.snapshotForJoin(documentId);
      socket.join(`doc:${documentId}`);
      this.setRole(socket.id, documentId, role);

      return {
        success: true,
        state: snapshot.state,
        role,
        presence,
        epoch: snapshot.epoch,
        persistedRevision: snapshot.persistedRevision,
        currentRevision: snapshot.currentRevision,
        awarenessSnapshot: this.awarenessManager.snapshot(documentId),
        sizeStatus: snapshot.sizeStatus,
      };
    } catch (error) {
      console.error(`Failed to join document ${documentId}:`, error);
      return rejectedJoin("load-failed", "Failed to load document");
    } finally {
      if (joins.current.get(documentId) === join) joins.current.delete(documentId);
      const remaining = (this.pendingJoinCounts.get(documentId) ?? 1) - 1;
      if (remaining > 0) {
        this.pendingJoinCounts.set(documentId, remaining);
      } else {
        this.pendingJoinCounts.delete(documentId);
      }
      try {
        if (remaining === 0) await this.evictIfEmpty(documentId);
      } finally {
        joins.inFlight -= 1;
        this.resolvePendingJoinWaiters();
      }
    }
  }

  async leaveSession(socket: TypeSyncSocket, documentId: string): Promise<void> {
    if (this.sockets.get(socket.id) !== socket) return;
    const joins = this.socketJoins.get(socket.id);
    if (!joins?.current.has(documentId) && !this.getRole(socket.id, documentId) &&
      !socket.rooms.has(`doc:${documentId}`)) return;
    this.removeSocketDocumentAccess(socket, documentId);
    if (!this.isDraining) {
      await this.evictIfEmpty(documentId);
    }
  }

  applyUpdate(params: {
    socket: TypeSyncSocket;
    documentId: string;
    update: Uint8Array;
  }): DocumentUpdateResult & { sizeStatus?: DocumentSizeStatus | null } {
    const { socket, documentId, update } = params;
    if (this.isDraining) {
      return { success: false, code: "server-draining", error: "Server is shutting down" };
    }
    if (!socket.rooms.has(`doc:${documentId}`)) {
      return { success: false, code: "not-joined", error: "Not joined to this document" };
    }

    const role = this.getRole(socket.id, documentId);
    if (!canEditDocument(role ?? null)) {
      return { success: false, code: "forbidden", error: "Unauthorized to edit this document" };
    }

    if (!this.consumeUpdateToken(socket.id)) {
      return { success: false, code: "rate-limited", error: "Too many document updates" };
    }

    if (!(update instanceof Uint8Array)) {
      return { success: false, code: "invalid-payload", error: "Invalid document update payload" };
    }

    const result = this.runtime.applyUpdate(documentId, update);
    switch (result.kind) {
      case "update-too-large":
        return {
          success: false,
          code: "update-too-large",
          error: `Document update exceeds ${formatByteSize(result.status.maxBytes)}`,
          sizeStatus: result.status,
        };
      case "not-loaded":
        return { success: false, code: "document-not-loaded", error: "Document is not loaded" };
      case "document-too-large":
        return {
          success: false,
          code: "document-too-large",
          error: "Document size limit reached",
          sizeStatus: result.status,
        };
      case "invalid":
        return { success: false, code: "invalid-payload", error: "Malformed document update payload" };
      case "accepted":
        return {
          success: true,
          revision: result.revision,
          epoch: result.epoch,
          sizeStatus: result.status,
        };
      default: {
        const unreachable: never = result;
        return unreachable;
      }
    }
  }

  applyAwareness(params: {
    socket: TypeSyncSocket;
    documentId: string;
    update: Uint8Array;
  }) {
    const { socket, documentId, update } = params;
    if (this.isDraining || !socket.rooms.has(`doc:${documentId}`)) return null;
    return this.awarenessManager.consumeUpdate(
      socket,
      documentId,
      update,
      this.getRole(socket.id, documentId) ?? null
    );
  }

  private removeSocketDocumentAccess(
    socket: TypeSyncSocket,
    documentId: string
  ): void {
    const roomName = `doc:${documentId}`;
    this.socketJoins.get(socket.id)?.current.delete(documentId);
    this.awarenessManager.releaseBinding(socket, documentId);
    socket.leave(roomName);
    this.clearRole(socket.id, documentId);
  }

  reconcileAccessChange(
    documentId: string,
    userId: string,
    role: Exclude<Role, "owner"> | null
  ): void {
    const roomName = `doc:${documentId}`;

    for (const socket of this.sockets.values()) {
      if (socket.data.userId !== userId) continue;

      const inRoom = socket.rooms.has(roomName);
      if (role) {
        if (inRoom) {
          this.setRole(socket.id, documentId, role);
        }
        this.setJoinRoleOverride(socket.id, documentId, role);
        this.notifySocket(socket, () => socket.emit("doc:permission-updated", { documentId, role }));
        continue;
      }

      this.removeSocketDocumentAccess(socket, documentId);
      this.notifySocket(socket, () => socket.emit("doc:permission-revoked", { documentId }));
    }

    if (!this.isDraining) {
      void this.evictIfEmpty(documentId).catch((error) => {
        console.error(`Failed to evict document ${documentId} after permission revocation:`, error);
      });
    }
  }

  private hasActiveSockets(documentId: string): boolean {
    for (const documentRoles of this.socketRoles.values()) {
      if (documentRoles.has(documentId)) return true;
    }
    return false;
  }

  private holdCount(documentId: string): number {
    const pending = this.pendingJoinCounts.get(documentId) ?? 0;
    if (pending > 0) return pending;
    if (this.hasActiveSockets(documentId)) return 1;
    return this.getRoomOccupancy(documentId);
  }

  emitToDocument(
    documentId: string,
    emit: (socket: TypeSyncSocket) => void
  ): void {
    for (const socket of this.sockets.values()) {
      if (socket.connected && this.getRole(socket.id, documentId) &&
        socket.rooms.has(`doc:${documentId}`)) {
        this.notifySocket(socket, () => emit(socket));
      }
    }
  }

  emitToUsers(
    userIds: Iterable<string>,
    emit: (socket: TypeSyncSocket) => void
  ): void {
    const audience = new Set(userIds);
    for (const socket of this.sockets.values()) {
      if (audience.has(socket.data.userId)) this.notifySocket(socket, () => emit(socket));
    }
  }

  private notifySocket(socket: TypeSyncSocket, notify: () => void): void {
    try {
      notify();
    } catch (error) {
      console.error(`Failed to notify socket ${socket.id}:`, error);
    }
  }

  async evictIfEmpty(documentId: string): Promise<void> {
    if (this.holdCount(documentId) > 0) return;
    await this.runtime.evictIfEmpty(documentId);
  }

  handleDocumentDeleted(documentId: string, userIds: Iterable<string>): void {
    for (const listener of this.lifecycleListeners) listener(documentId);
    const audience = new Set(userIds);
    for (const socket of this.sockets.values()) {
      const shouldNotify = audience.has(socket.data.userId) || socket.rooms.has(`doc:${documentId}`);
      this.removeSocketDocumentAccess(socket, documentId);
      if (shouldNotify) {
        this.notifySocket(socket, () => socket.emit("doc:permission-revoked", { documentId }));
      }
    }

    this.runtime.discard(documentId);
    this.awarenessManager.forgetDocument(documentId);
  }

  async handleDisconnect(socket: TypeSyncSocket): Promise<void> {
    if (this.sockets.get(socket.id) !== socket) return;
    const documentIds = [...(this.socketRoles.get(socket.id)?.keys() ?? [])];
    for (const documentId of documentIds) {
      this.awarenessManager.releaseBinding(socket, documentId);
      this.clearRole(socket.id, documentId);
    }
    this.awarenessManager.forgetSocket(socket.id);
    this.socketRoles.delete(socket.id);
    this.socketJoins.delete(socket.id);
    this.sockets.delete(socket.id);
    this.updateTokens.delete(socket.id);

    if (!this.isDraining) {
      for (const documentId of documentIds) {
        await this.evictIfEmpty(documentId);
      }
    }
  }

  async flushAll(): Promise<{ succeeded: string[]; failed: string[] }> {
    const [listeners, documents] = await Promise.all([
      Promise.allSettled([...this.aiFlushListeners].map(async flush => flush())),
      this.runtime.flushAll().then(
        result => ({ kind: "fulfilled", result } as const),
        (error: unknown) => ({ kind: "rejected", error } as const),
      ),
    ]);
    const errors: unknown[] = [];
    for (const listener of listeners) {
      if (listener.status === "rejected") errors.push(listener.reason);
    }
    if (documents.kind === "rejected") {
      throw new AggregateError([...errors, documents.error], "Failed to flush AI history and documents", { cause: documents.error });
    }
    const { result } = documents;
    if (errors.length > 0) {
      if (result.failed.length > 0) {
        errors.push(new Error(`Failed to save documents: ${result.failed.join(", ")}`));
      }
      throw new AggregateError(errors, "Failed to flush AI history and documents", { cause: result });
    }
    return result;
  }
}
