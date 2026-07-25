import type {
  DocumentJoinResult,
  DocumentSizeStatus,
  DocumentUpdateResult,
  PresenceIdentity,
  Role,
} from "@typesync/shared";
import { createAwarenessManager } from "./awareness.js";
import { createDocumentRuntime, type DocumentRuntimeOptions } from "./document-runtime.js";
import type { TypeSyncSocket } from "./types.js";

const DOCUMENT_UPDATES_PER_SECOND = 30;
const DOCUMENT_UPDATE_BURST_SIZE = 60;

export type SessionAccess =
  | { hasAccess: true; role: Role }
  | { hasAccess: false };

export type CollaborativeRoomJoinResult = DocumentJoinResult & {
  awarenessSnapshot?: Uint8Array | null;
  sizeStatus?: DocumentSizeStatus | null;
};

export interface CollaborativeRoomSessionOptions extends DocumentRuntimeOptions {
  getRoomOccupancy?: (documentId: string) => number;
}

export class CollaborativeRoomSession {
  private readonly socketRoles = new Map<string, Map<string, Role>>();
  private readonly socketJoinGenerations = new Map<string, Map<string, number>>();
  private readonly socketPresences = new Map<string, PresenceIdentity>();
  private readonly sockets = new Map<string, TypeSyncSocket>();
  private readonly pendingJoinCounts = new Map<string, number>();
  private readonly pendingJoinWaiters = new Set<() => void>();
  private readonly updateTokens = new Map<string, { tokens: number; lastRefill: number }>();
  private isDraining = false;

  private readonly runtime;
  private readonly awarenessManager;
  private readonly getRoomOccupancy: (documentId: string) => number;

  constructor(options: CollaborativeRoomSessionOptions = {}) {
    this.getRoomOccupancy = options.getRoomOccupancy ?? (() => 0);
    this.runtime = createDocumentRuntime({
      repository: options.repository,
      roomOccupancyProvider: (documentId) => this.getRoomOccupancy(documentId),
      onDocumentSaved: options.onDocumentSaved,
    });
    this.awarenessManager = createAwarenessManager();
  }

  initializeSocket(socket: TypeSyncSocket): PresenceIdentity {
    this.sockets.set(socket.id, socket);
    this.socketRoles.set(socket.id, new Map());
    this.socketJoinGenerations.set(socket.id, new Map());
    this.updateTokens.set(socket.id, {
      tokens: DOCUMENT_UPDATE_BURST_SIZE,
      lastRefill: Date.now(),
    });

    const presence = this.awarenessManager.initializeSocket(socket);
    this.socketPresences.set(socket.id, presence);
    return presence;
  }

  beginDrain(): void {
    this.isDraining = true;
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

  private advanceJoinGeneration(socketId: string, documentId: string): number {
    let generations = this.socketJoinGenerations.get(socketId);
    if (!generations) {
      generations = new Map();
      this.socketJoinGenerations.set(socketId, generations);
    }
    const generation = (generations.get(documentId) ?? 0) + 1;
    generations.set(documentId, generation);
    return generation;
  }

  private isCurrentJoin(socketId: string, documentId: string, generation: number): boolean {
    return this.socketJoinGenerations.get(socketId)?.get(documentId) === generation;
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

  async joinSession(params: {
    socket: TypeSyncSocket;
    documentId: string;
    authorize: () => Promise<SessionAccess>;
  }): Promise<CollaborativeRoomJoinResult> {
    const { socket, documentId, authorize } = params;
    if (this.isDraining) {
      return { success: false, error: "Server is shutting down" };
    }

    this.pendingJoinCounts.set(
      documentId,
      (this.pendingJoinCounts.get(documentId) ?? 0) + 1
    );
    const joinGeneration = this.advanceJoinGeneration(socket.id, documentId);

    try {
      if (!socket.connected || !this.isCurrentJoin(socket.id, documentId, joinGeneration)) {
        return { success: false, error: "Document join was cancelled" };
      }

      const initialAccess = await authorize();
      if (!initialAccess.hasAccess) {
        return { success: false, error: "Access denied" };
      }

      await this.runtime.ensureLoaded(documentId);

      if (!socket.connected || !this.isCurrentJoin(socket.id, documentId, joinGeneration)) {
        return { success: false, error: "Document join was cancelled" };
      }

      const currentAccess = await authorize();
      if (!currentAccess.hasAccess) {
        return { success: false, error: "Access denied" };
      }

      if (!socket.connected || !this.isCurrentJoin(socket.id, documentId, joinGeneration)) {
        return { success: false, error: "Document join was cancelled" };
      }

      const presence = this.socketPresences.get(socket.id);
      if (!presence) {
        return { success: false, error: "Document join was cancelled" };
      }

      const snapshot = this.runtime.snapshotForJoin(documentId);
      socket.join(`doc:${documentId}`);
      this.setRole(socket.id, documentId, currentAccess.role);

      return {
        success: true,
        state: snapshot.state,
        stateVector: snapshot.stateVector,
        role: currentAccess.role,
        presence,
        awarenessSnapshot: this.awarenessManager.snapshot(documentId),
        sizeStatus: snapshot.sizeStatus,
      };
    } catch (error) {
      console.error(`Failed to join document ${documentId}:`, error);
      return { success: false, error: "Failed to load document" };
    } finally {
      const remaining = (this.pendingJoinCounts.get(documentId) ?? 1) - 1;
      if (remaining > 0) {
        this.pendingJoinCounts.set(documentId, remaining);
      } else {
        this.pendingJoinCounts.delete(documentId);
        await this.evictIfEmpty(documentId);
        this.resolvePendingJoinWaiters();
      }
    }
  }

  async leaveSession(socket: TypeSyncSocket, documentId: string): Promise<void> {
    this.advanceJoinGeneration(socket.id, documentId);
    this.releaseAwarenessBinding(socket, documentId);
    socket.leave(`doc:${documentId}`);
    this.clearRole(socket.id, documentId);
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
    if (role !== "owner" && role !== "editor") {
      return { success: false, code: "forbidden", error: "Unauthorized to edit this document" };
    }

    if (!this.consumeUpdateToken(socket.id)) {
      return { success: false, code: "rate-limited", error: "Too many document updates" };
    }

    if (!(update instanceof Uint8Array)) {
      return { success: false, code: "invalid-payload", error: "Invalid document update payload" };
    }

    const result = this.runtime.applyUpdate(documentId, update);
    if (result.kind === "update-too-large") {
      return {
        success: false,
        code: "update-too-large",
        error: "Document update exceeds 1 MiB",
        sizeStatus: result.status,
      };
    }
    if (result.kind === "not-loaded") {
      return { success: false, code: "document-not-loaded", error: "Document is not loaded" };
    }
    if (result.kind === "document-too-large") {
      return {
        success: false,
        code: "document-too-large",
        error: "Document size limit reached",
        sizeStatus: result.status,
      };
    }
    if (result.kind === "invalid") {
      return { success: false, code: "invalid-payload", error: "Malformed document update payload" };
    }

    return { success: true, sizeStatus: result.status };
  }

  applyAwareness(params: {
    socket: TypeSyncSocket;
    documentId: string;
    update: Uint8Array;
  }) {
    const { socket, documentId, update } = params;
    if (this.isDraining || !socket.rooms.has(`doc:${documentId}`)) return null;
    return this.awarenessManager.consumeUpdate(socket, documentId, update);
  }

  private releaseAwarenessBinding(socket: TypeSyncSocket, documentId: string): void {
    this.awarenessManager.releaseBinding(socket, documentId);
  }

  private removeSocketDocumentAccess(
    socket: TypeSyncSocket,
    documentId: string
  ): boolean {
    const roomName = `doc:${documentId}`;
    const wasInRoom = socket.rooms.has(roomName);
    if (this.socketJoinGenerations.get(socket.id)?.has(documentId)) {
      this.advanceJoinGeneration(socket.id, documentId);
    }
    this.releaseAwarenessBinding(socket, documentId);
    socket.leave(roomName);
    this.clearRole(socket.id, documentId);
    return wasInRoom;
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
        if (inRoom) this.setRole(socket.id, documentId, role);
        socket.emit("doc:permission-updated", { documentId, role });
        continue;
      }

      this.removeSocketDocumentAccess(socket, documentId);
      socket.emit("doc:permission-revoked", { documentId });
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

  async evictIfEmpty(documentId: string): Promise<void> {
    if ((this.pendingJoinCounts.get(documentId) ?? 0) > 0) return;
    if (this.hasActiveSockets(documentId)) return;
    if (this.getRoomOccupancy(documentId) > 0) return;
    await this.runtime.evictIfEmpty(documentId, 0);
  }

  handleDocumentDeleted(documentId: string): void {
    for (const socket of this.sockets.values()) {
      const wasInRoom = this.removeSocketDocumentAccess(socket, documentId);
      if (wasInRoom) {
        socket.emit("doc:permission-revoked", { documentId });
      }
    }

    this.runtime.discard(documentId);
    this.awarenessManager.forgetDocument(documentId);
  }

  async handleDisconnect(socket: TypeSyncSocket): Promise<void> {
    const documentIds = [...(this.socketRoles.get(socket.id)?.keys() ?? [])];
    for (const documentId of documentIds) {
      this.releaseAwarenessBinding(socket, documentId);
      this.clearRole(socket.id, documentId);
    }
    this.awarenessManager.forgetSocket(socket.id);
    this.socketRoles.delete(socket.id);
    this.socketJoinGenerations.delete(socket.id);
    this.socketPresences.delete(socket.id);
    this.sockets.delete(socket.id);
    this.updateTokens.delete(socket.id);

    for (const documentId of documentIds) {
      await this.evictIfEmpty(documentId);
    }
  }

  async flushAll(): Promise<{ succeeded: string[]; failed: string[] }> {
    return this.runtime.flushAll();
  }
}
