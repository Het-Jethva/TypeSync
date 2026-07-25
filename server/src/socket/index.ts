import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";
import { z } from "zod";
import { DocumentService } from "../services/document.service.js";
import { auth } from "../lib/auth.js";
import { config } from "../config.js";
import type {
  ClientToServerEvents,
  DocumentJoinResult,
  DocumentUpdateResult,
  Role,
  ServerToClientEvents,
} from "@typesync/shared";
import { createAwarenessManager } from "./awareness.js";
import type { SocketData, TypeSyncSocket, TypeSyncSocketServer } from "./types.js";
import { createDocumentRuntime } from "./document-runtime.js";

export type { TypeSyncSocketServer } from "./types.js";

// State maps
const socketRoles = new Map<string, Map<string, string>>();
const socketJoinGenerations = new Map<string, Map<string, number>>();
const pendingJoinCounts = new Map<string, number>();
const pendingJoinWaiters = new Set<() => void>();
let isDraining = false;
let activeAwarenessManager: ReturnType<typeof createAwarenessManager> | undefined;
let activeIo: TypeSyncSocketServer | undefined;
const documentRuntime = createDocumentRuntime({
  roomOccupancyProvider(documentId) {
    if (!activeIo) return 0;
    return activeIo.sockets.adapter.rooms.get(`doc:${documentId}`)?.size ?? 0;
  },
  onDocumentSaved({ documentId, updatedAt }) {
    if (activeIo) {
      activeIo.to(`doc:${documentId}`).emit("doc:saved", {
        documentId,
        updatedAt: updatedAt.toISOString(),
      });
    }
  },
});

function getAwarenessManager(): ReturnType<typeof createAwarenessManager> {
  if (!activeAwarenessManager) throw new Error("Awareness manager is not initialized");
  return activeAwarenessManager;
}

const SESSION_REVALIDATION_INTERVAL = 60_000;
const DOCUMENT_UPDATES_PER_SECOND = 30;
const DOCUMENT_UPDATE_BURST_SIZE = 60;
const DocumentIdSchema = z.string().uuid();
const trustedClientOrigin = new URL(config.clientUrl).origin;

// ─── Helper functions ────────────────────────────────────

export function beginSocketDrain(): void {
  isDraining = true;
}

export function waitForSocketDrain(): Promise<void> {
  if (pendingJoinCounts.size === 0) return Promise.resolve();
  return new Promise((resolve) => pendingJoinWaiters.add(resolve));
}

function resolvePendingJoinWaiters(): void {
  if (pendingJoinCounts.size > 0) return;
  for (const resolve of pendingJoinWaiters) resolve();
  pendingJoinWaiters.clear();
}

async function evictIfNoPendingJoins(
  _io: TypeSyncSocketServer,
  documentId: string
): Promise<void> {
  if ((pendingJoinCounts.get(documentId) ?? 0) > 0) return;
  await documentRuntime.evictIfEmpty(documentId);
}

function consumeDocumentUpdateToken(socket: TypeSyncSocket): boolean {
  const now = Date.now();
  const elapsedSeconds = (now - socket.data.documentUpdateLastRefill) / 1000;
  socket.data.documentUpdateTokens = Math.min(
    DOCUMENT_UPDATE_BURST_SIZE,
    socket.data.documentUpdateTokens + elapsedSeconds * DOCUMENT_UPDATES_PER_SECOND
  );
  socket.data.documentUpdateLastRefill = now;

  if (socket.data.documentUpdateTokens < 1) return false;
  socket.data.documentUpdateTokens -= 1;
  return true;
}

function originFromHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Socket.IO's first handshake is a same-origin polling GET when the client is
 * served through the Vite proxy (or any same-origin reverse proxy). Browsers
 * often omit the Origin header on those requests while still sending Referer.
 * In that case, validate Referer instead; every connection still requires
 * session authentication.
 */
function isTrustedSocketOrigin(
  origin: string | undefined,
  referer: string | undefined
): boolean {
  if (origin !== undefined) {
    return originFromHeader(origin) === trustedClientOrigin;
  }
  return originFromHeader(referer) === trustedClientOrigin;
}

async function ensureSocketSession(socket: TypeSyncSocket, force = false): Promise<boolean> {
  if (
    !force &&
    Date.now() - socket.data.lastSessionValidation < SESSION_REVALIDATION_INTERVAL
  ) {
    return true;
  }

  if (socket.data.sessionValidation) {
    return socket.data.sessionValidation;
  }

  const headers = new Headers();
  headers.set("cookie", socket.data.authCookie);
  const validation = auth.api
    .getSession({ headers })
    .then((session) => session?.session.id === socket.data.sessionId)
    .catch(() => false);
  socket.data.sessionValidation = validation;

  try {
    const valid = await validation;
    if (valid) {
      socket.data.lastSessionValidation = Date.now();
      return true;
    }

    socket.emit("doc:error", { message: "Session expired" });
    socket.disconnect(true);
    return false;
  } finally {
    if (socket.data.sessionValidation === validation) {
      socket.data.sessionValidation = undefined;
    }
  }
}

export async function flushAndCleanup(): Promise<{ succeeded: string[]; failed: string[] }> {
  return documentRuntime.flushAll();
}

export async function notifyPermissionChange(
  io: TypeSyncSocketServer,
  documentId: string,
  targetUserId: string,
  role: "editor" | "viewer" | null
): Promise<void> {
  const roomName = `doc:${documentId}`;

  for (const [, socket] of io.sockets.sockets) {
    if (socket.data.userId !== targetUserId) {
      continue;
    }

    const inRoom = socket.rooms.has(roomName);

    if (role) {
      if (inRoom) {
        socketRoles.get(socket.id)?.set(documentId, role);
      }
      socket.emit("doc:permission-updated", { documentId, role });
    } else {
      if (inRoom) {
        getAwarenessManager().releaseBinding(socket, documentId);
        socket.leave(roomName);
        socketRoles.get(socket.id)?.delete(documentId);
      }
      socket.emit("doc:permission-revoked", { documentId });
    }
  }

  if (role === null && !isDraining) {
    try {
      await evictIfNoPendingJoins(io, documentId);
    } catch (error) {
      console.error(`Failed to evict document ${documentId} after permission revocation:`, error);
    }
  }
}

function advanceJoinGeneration(socketId: string, documentId: string): number {
  let generations = socketJoinGenerations.get(socketId);
  if (!generations) {
    generations = new Map();
    socketJoinGenerations.set(socketId, generations);
  }

  const generation = (generations.get(documentId) ?? 0) + 1;
  generations.set(documentId, generation);
  return generation;
}

function isCurrentJoin(socketId: string, documentId: string, generation: number): boolean {
  return socketJoinGenerations.get(socketId)?.get(documentId) === generation;
}

export function handleDocumentDeleted(
  io: TypeSyncSocketServer,
  documentId: string
): void {
  const roomName = `doc:${documentId}`;

  // Notify all active sockets in room doc:${documentId}, remove them from room, and clear socketRoles
  const roomSockets = io.sockets.adapter.rooms.get(roomName);
  if (roomSockets) {
    const socketIds = Array.from(roomSockets);
    for (const socketId of socketIds) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        getAwarenessManager().releaseBinding(socket, documentId);
        socketRoles.get(socketId)?.delete(documentId);
        socket.emit("doc:permission-revoked", { documentId });
        socket.leave(roomName);
      }
    }
  }

  documentRuntime.discard(documentId);
  getAwarenessManager().forgetDocument(documentId);
}


// ─── Socket Setup ────────────────────────────────────────

export function setupSocket(httpServer: HttpServer): TypeSyncSocketServer {
  isDraining = false;
  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: {
      origin: config.clientUrl,
      credentials: true,
    },
    allowRequest: (request, callback) => {
      callback(
        null,
        isTrustedSocketOrigin(request.headers.origin, request.headers.referer)
      );
    },
  });
  const awarenessManager = createAwarenessManager();
  activeAwarenessManager = awarenessManager;
  activeIo = io;

  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const cookies = socket.handshake.headers.cookie || "";
      const headers = new Headers();
      headers.set("cookie", cookies);

      const session = await auth.api.getSession({
        headers,
      });

      if (!session) {
        return next(new Error("Unauthorized"));
      }

      socket.data.userId = session.user.id;
      socket.data.userName = session.user.name;
      socket.data.userEmail = session.user.email;
      socket.data.authCookie = cookies;
      socket.data.sessionId = session.session.id;
      socket.data.lastSessionValidation = Date.now();
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId!;
    const presence = awarenessManager.initializeSocket(socket);
    socket.data.documentUpdateTokens = DOCUMENT_UPDATE_BURST_SIZE;
    socket.data.documentUpdateLastRefill = Date.now();

    // Initialize per-socket role map
    socketRoles.set(socket.id, new Map());
    socketJoinGenerations.set(socket.id, new Map());
    const sessionValidationTimer = setInterval(() => {
      void ensureSocketSession(socket, true);
    }, SESSION_REVALIDATION_INTERVAL);
    sessionValidationTimer.unref();
    socket.data.sessionValidationTimer = sessionValidationTimer;

    socket.on("doc:join", async (
      documentId: string,
      acknowledge: (result: DocumentJoinResult) => void
    ) => {
      let parsedDocumentId: string | undefined;
      let pendingJoinTracked = false;
      const respond = typeof acknowledge === "function" ? acknowledge : () => {};
      try {
        if (isDraining) {
          respond({ success: false, error: "Server is shutting down" });
          return;
        }
        parsedDocumentId = DocumentIdSchema.parse(documentId);
        pendingJoinCounts.set(
          parsedDocumentId,
          (pendingJoinCounts.get(parsedDocumentId) ?? 0) + 1
        );
        pendingJoinTracked = true;
        const joinGeneration = advanceJoinGeneration(socket.id, parsedDocumentId);
        if (!(await ensureSocketSession(socket))) {
          respond({ success: false, error: "Session expired" });
          return;
        }
        if (
          isDraining ||
          !socket.connected ||
          !isCurrentJoin(socket.id, parsedDocumentId, joinGeneration)
        ) {
          respond({ success: false, error: "Document join was cancelled" });
          return;
        }
        const { hasAccess } = await DocumentService.getDocumentAccess(
          parsedDocumentId,
          userId
        );
        if (!hasAccess) {
          respond({ success: false, error: "Access denied" });
          return;
        }

        const roomName = `doc:${parsedDocumentId}`;

        // Load before joining so a failed DB read cannot publish an empty state.
        await documentRuntime.ensureLoaded(parsedDocumentId);

        if (!socket.connected || !isCurrentJoin(socket.id, parsedDocumentId, joinGeneration)) {
          respond({ success: false, error: "Document join was cancelled" });
          return;
        }

        // Access may have changed while the document was loading. Revalidate at
        // the final boundary before joining the room and caching the role.
        const currentAccess = await DocumentService.getDocumentAccess(parsedDocumentId, userId);
        if (!currentAccess.hasAccess) {
          respond({ success: false, error: "Access denied" });
          return;
        }

        if (!socket.connected || !isCurrentJoin(socket.id, parsedDocumentId, joinGeneration)) {
          respond({ success: false, error: "Document join was cancelled" });
          return;
        }

        const snapshot = documentRuntime.snapshotForJoin(parsedDocumentId);
        socket.join(roomName);
        socketRoles.get(socket.id)!.set(parsedDocumentId, currentAccess.role);

        respond({
          success: true,
          state: snapshot.state,
          stateVector: snapshot.stateVector,
          role: currentAccess.role as Role,
          presence,
        });

        const awarenessSnapshot = awarenessManager.snapshot(parsedDocumentId);
        if (awarenessSnapshot) {
          socket.emit("awareness:update", {
            documentId: parsedDocumentId,
            update: awarenessSnapshot,
          });
        }

        if (snapshot.sizeStatus) {
          socket.emit("doc:size-status", snapshot.sizeStatus);
        }
      } catch (error) {
        console.error(`Failed to join document ${documentId}:`, error);
        respond({ success: false, error: "Failed to load document" });
      } finally {
        if (parsedDocumentId && pendingJoinTracked) {
          const remaining = (pendingJoinCounts.get(parsedDocumentId) ?? 1) - 1;
          if (remaining > 0) {
            pendingJoinCounts.set(parsedDocumentId, remaining);
          } else {
            pendingJoinCounts.delete(parsedDocumentId);
            await documentRuntime.evictIfEmpty(parsedDocumentId);
            resolvePendingJoinWaiters();
          }
        }
      }
    });

    socket.on("doc:leave", async (documentId: string) => {
      const parsedDocumentId = DocumentIdSchema.safeParse(documentId);
      if (!parsedDocumentId.success) return;
      documentId = parsedDocumentId.data;
      advanceJoinGeneration(socket.id, documentId);
      const roomName = `doc:${documentId}`;
      awarenessManager.releaseBinding(socket, documentId);
      socket.leave(roomName);

      // Remove role entry for this doc
      socketRoles.get(socket.id)?.delete(documentId);

      // Evict from memory if room is now empty
      if (!isDraining) {
        await evictIfNoPendingJoins(io, documentId);
      }
    });

    socket.on("doc:update", async (
      documentId: string,
      update: Uint8Array,
      acknowledge: (result: DocumentUpdateResult) => void
    ) => {
      const respond = typeof acknowledge === "function" ? acknowledge : () => {};
      const parsedDocumentId = DocumentIdSchema.safeParse(documentId);
      if (!parsedDocumentId.success) {
        socket.emit("doc:error", { message: "Invalid document id" });
        respond({ success: false, code: "invalid-payload", error: "Invalid document id" });
        return;
      }
      documentId = parsedDocumentId.data;
      const roomName = `doc:${documentId}`;

      if (isDraining) {
        socket.emit("doc:error", { documentId, message: "Server is shutting down" });
        respond({ success: false, code: "server-draining", error: "Server is shutting down" });
        return;
      }
      if (!(await ensureSocketSession(socket))) {
        respond({ success: false, code: "session-expired", error: "Session expired" });
        return;
      }

      // SEC-01: Must be in the room
      if (!socket.rooms.has(roomName)) {
        socket.emit("doc:error", { documentId, message: "Not joined to this document" });
        respond({ success: false, code: "not-joined", error: "Not joined to this document" });
        return;
      }

      // SEC-02: Only explicit "owner" and "editor" roles may apply/broadcast document updates
      const role = socketRoles.get(socket.id)?.get(documentId);
      if (role !== "owner" && role !== "editor") {
        socket.emit("doc:error", { documentId, message: "Unauthorized to edit this document" });
        respond({ success: false, code: "forbidden", error: "Unauthorized to edit this document" });
        return;
      }

      if (!consumeDocumentUpdateToken(socket)) {
        respond({ success: false, code: "rate-limited", error: "Too many document updates" });
        return;
      }

      // Validate that the update payload is binary before passing it to the runtime.
      if (!(update instanceof Uint8Array)) {
        socket.emit("doc:error", { documentId, message: "Invalid document update payload type" });
        respond({ success: false, code: "invalid-payload", error: "Invalid document update payload" });
        return;
      }

      const result = documentRuntime.applyUpdate(documentId, update);
      if (result.kind === "update-too-large") {
        socket.emit("doc:size-status", result.status);
        respond({ success: false, code: "update-too-large", error: "Document update exceeds 1 MiB" });
        return;
      }
      if (result.kind === "not-loaded") {
        socket.emit("doc:error", { documentId, message: "Document is not loaded" });
        respond({ success: false, code: "document-not-loaded", error: "Document is not loaded" });
        return;
      }
      if (result.kind === "document-too-large") {
        if (result.status) socket.emit("doc:size-status", result.status);
        respond({ success: false, code: "document-too-large", error: "Document size limit reached" });
        return;
      }
      if (result.kind === "invalid") {
        console.error(`Failed to apply Yjs document update for document ${documentId}:`, result.error);
        socket.emit("doc:error", { documentId, message: "Malformed document update payload" });
        respond({ success: false, code: "invalid-payload", error: "Malformed document update payload" });
        return;
      }
      if (result.status) {
        io.to(roomName).emit("doc:size-status", result.status);
      }

      // Broadcast to all other clients in the room
      socket.to(roomName).emit("doc:update", { documentId, update });
      respond({ success: true });
    });

    socket.on("awareness:update", async (documentId: string, update: Uint8Array) => {
      const parsedDocumentId = DocumentIdSchema.safeParse(documentId);
      if (!parsedDocumentId.success) return;
      documentId = parsedDocumentId.data;
      const roomName = `doc:${documentId}`;

      if (isDraining) return;
      if (!(await ensureSocketSession(socket))) return;

      // Must be in the room
      if (!socket.rooms.has(roomName)) {
        return;
      }

      const sanitized = awarenessManager.consumeUpdate(socket, documentId, update);
      if (!sanitized) return;

      socket.to(roomName).emit("awareness:update", {
        documentId,
        update: sanitized.update,
      });
    });

    socket.on("disconnect", async () => {
      // Collect doc IDs this socket was tracking, then clean up
      const roles = socketRoles.get(socket.id);
      const docIds = roles ? [...roles.keys()] : [];
      for (const docId of docIds) {
        awarenessManager.releaseBinding(socket, docId);
      }
      awarenessManager.forgetSocket(socket.id);
      socketRoles.delete(socket.id);
      socketJoinGenerations.delete(socket.id);
      if (socket.data.sessionValidationTimer) {
        clearInterval(socket.data.sessionValidationTimer);
        socket.data.sessionValidationTimer = undefined;
      }

      // Evict any now-empty docs
      if (!isDraining) {
        for (const docId of docIds) {
          await evictIfNoPendingJoins(io, docId);
        }
      }
    });
  });

  return io;
}
