import type {
  DocumentJoinResult,
  DocumentUpdateResult,
  Role,
} from "@typesync/shared";
import { createDocumentRuntime, type DocumentRuntimeOptions } from "./document-runtime.js";
import { createAwarenessManager } from "./awareness.js";

const SESSION_REVALIDATION_INTERVAL = 60_000;
const DOCUMENT_UPDATES_PER_SECOND = 30;
const DOCUMENT_UPDATE_BURST_SIZE = 60;

export interface SocketUser {
  id: string;
  name: string;
  email: string;
}

export interface CollaborativeRoomSessionOptions extends DocumentRuntimeOptions {
  getRoomOccupancy?: (documentId: string) => number;
}

export class CollaborativeRoomSession {
  private socketRoles = new Map<string, Map<string, string>>();
  private socketJoinGenerations = new Map<string, Map<string, number>>();
  private pendingJoinCounts = new Map<string, number>();
  private pendingJoinWaiters = new Set<() => void>();
  private updateTokens = new Map<string, { tokens: number; lastRefill: number }>();
  private isDraining = false;

  private runtime;
  private awarenessManager;
  private getRoomOccupancy: (documentId: string) => number;

  constructor(options: CollaborativeRoomSessionOptions = {}) {
    this.getRoomOccupancy = options.getRoomOccupancy ?? (() => 0);
    this.runtime = createDocumentRuntime({
      repository: options.repository,
      roomOccupancyProvider: (docId) => this.getRoomOccupancy(docId),
      onDocumentSaved: options.onDocumentSaved,
    });
    this.awarenessManager = createAwarenessManager();
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

  initializeSocket(socketId: string, user: SocketUser) {
    this.socketRoles.set(socketId, new Map());
    this.socketJoinGenerations.set(socketId, new Map());
    this.updateTokens.set(socketId, {
      tokens: DOCUMENT_UPDATE_BURST_SIZE,
      lastRefill: Date.now(),
    });
    return this.awarenessManager.initializeSocket({
      id: socketId,
      data: { userId: user.id, userName: user.name, userEmail: user.email },
    } as any);
  }

  advanceJoinGeneration(socketId: string, documentId: string): number {
    let generations = this.socketJoinGenerations.get(socketId);
    if (!generations) {
      generations = new Map();
      this.socketJoinGenerations.set(socketId, generations);
    }
    const generation = (generations.get(documentId) ?? 0) + 1;
    generations.set(documentId, generation);
    return generation;
  }

  isCurrentJoin(socketId: string, documentId: string, generation: number): boolean {
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


  getRole(socketId: string, documentId: string): string | undefined {
    return this.socketRoles.get(socketId)?.get(documentId);
  }

  setRole(socketId: string, documentId: string, role: string): void {
    let roles = this.socketRoles.get(socketId);
    if (!roles) {
      roles = new Map();
      this.socketRoles.set(socketId, roles);
    }
    roles.set(documentId, role);
  }

  clearRole(socketId: string, documentId: string): void {
    this.socketRoles.get(socketId)?.delete(documentId);
  }

  async joinSession(params: {
    socketId: string;
    user: SocketUser;
    documentId: string;
    checkAccess: () => Promise<{ hasAccess: boolean; role: string }>;
    isStillConnected: () => boolean;
  }): Promise<DocumentJoinResult & { awarenessSnapshot?: Uint8Array | null; sizeStatus?: any }> {
    const { socketId, user, documentId, checkAccess, isStillConnected } = params;

    if (this.isDraining) {
      return { success: false, error: "Server is shutting down" };
    }

    this.pendingJoinCounts.set(
      documentId,
      (this.pendingJoinCounts.get(documentId) ?? 0) + 1
    );
    const joinGeneration = this.advanceJoinGeneration(socketId, documentId);

    try {
      if (!isStillConnected() || !this.isCurrentJoin(socketId, documentId, joinGeneration)) {
        return { success: false, error: "Document join was cancelled" };
      }

      const initialAccess = await checkAccess();
      if (!initialAccess.hasAccess) {
        return { success: false, error: "Access denied" };
      }

      await this.runtime.ensureLoaded(documentId);

      if (!isStillConnected() || !this.isCurrentJoin(socketId, documentId, joinGeneration)) {
        return { success: false, error: "Document join was cancelled" };
      }

      const currentAccess = await checkAccess();
      if (!currentAccess.hasAccess) {
        return { success: false, error: "Access denied" };
      }

      if (!isStillConnected() || !this.isCurrentJoin(socketId, documentId, joinGeneration)) {
        return { success: false, error: "Document join was cancelled" };
      }

      const snapshot = this.runtime.snapshotForJoin(documentId);
      this.setRole(socketId, documentId, currentAccess.role);

      const presence = {
        userId: user.id,
        name: user.name,
        color: this.awarenessManager.initializeSocket({
          id: socketId,
          data: { userId: user.id, userName: user.name, userEmail: user.email },
        } as any).color,
      };

      const awarenessSnapshot = this.awarenessManager.snapshot(documentId);

      return {
        success: true,
        state: snapshot.state,
        stateVector: snapshot.stateVector,
        role: currentAccess.role as Role,
        presence,
        awarenessSnapshot,
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

  async leaveSession(socketId: string, documentId: string): Promise<void> {
    this.advanceJoinGeneration(socketId, documentId);
    this.clearRole(socketId, documentId);
    if (!this.isDraining) {
      await this.evictIfEmpty(documentId);
    }
  }

  applyUpdate(params: {
    socketId: string;
    documentId: string;
    update: Uint8Array;
    inRoom: boolean;
  }): DocumentUpdateResult & { sizeStatus?: any } {
    const { socketId, documentId, update, inRoom } = params;

    if (this.isDraining) {
      return { success: false, code: "server-draining", error: "Server is shutting down" };
    }
    if (!inRoom) {
      return { success: false, code: "not-joined", error: "Not joined to this document" };
    }

    const role = this.getRole(socketId, documentId);
    if (role !== "owner" && role !== "editor") {
      return { success: false, code: "forbidden", error: "Unauthorized to edit this document" };
    }

    if (!this.consumeUpdateToken(socketId)) {
      return { success: false, code: "rate-limited", error: "Too many document updates" };
    }

    if (!(update instanceof Uint8Array)) {
      return { success: false, code: "invalid-payload", error: "Invalid document update payload" };
    }

    const result = this.runtime.applyUpdate(documentId, update);
    if (result.kind === "update-too-large") {
      return { success: false, code: "update-too-large", error: "Document update exceeds 1 MiB", sizeStatus: result.status };
    }
    if (result.kind === "not-loaded") {
      return { success: false, code: "document-not-loaded", error: "Document is not loaded" };
    }
    if (result.kind === "document-too-large") {
      return { success: false, code: "document-too-large", error: "Document size limit reached", sizeStatus: result.status };
    }
    if (result.kind === "invalid") {
      return { success: false, code: "invalid-payload", error: "Malformed document update payload" };
    }

    return { success: true, sizeStatus: result.status };
  }

  applyAwareness(params: {
    socket: any;
    documentId: string;
    update: Uint8Array;
    inRoom: boolean;
  }) {
    const { socket, documentId, update, inRoom } = params;
    if (this.isDraining || !inRoom) return null;
    return this.awarenessManager.consumeUpdate(socket, documentId, update);
  }

  releaseAwarenessBinding(socket: any, documentId: string) {
    this.awarenessManager.releaseBinding(socket, documentId);
  }

  hasActiveSockets(documentId: string): boolean {
    for (const docMap of this.socketRoles.values()) {
      if (docMap.has(documentId)) return true;
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
    this.runtime.discard(documentId);
    this.awarenessManager.forgetDocument(documentId);
  }

  handleDisconnect(socketId: string): string[] {
    const roles = this.socketRoles.get(socketId);
    const docIds = roles ? [...roles.keys()] : [];
    this.awarenessManager.forgetSocket(socketId);
    this.socketRoles.delete(socketId);
    this.socketJoinGenerations.delete(socketId);
    this.updateTokens.delete(socketId);
    return docIds;
  }

  async flushAll(): Promise<{ succeeded: string[]; failed: string[] }> {
    return this.runtime.flushAll();
  }
}
