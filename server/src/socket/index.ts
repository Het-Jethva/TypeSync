import { Server as SocketIOServer, Socket as SocketIOSocket } from "socket.io";
import { Server as HttpServer } from "http";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { document } from "../db/schema.js";
import { DocumentService } from "../services/document.service.js";
import { auth } from "../lib/auth.js";
import { config } from "../config.js";
import type {
  ClientToServerEvents,
  DocumentJoinResult,
  Role,
  ServerToClientEvents,
} from "@typesync/shared";

// Types
interface SocketData {
  userId: string;
  userName: string;
  userEmail: string;
  authCookie: string;
  sessionId: string;
  lastSessionValidation: number;
  sessionValidation?: Promise<boolean>;
  sessionValidationTimer?: NodeJS.Timeout;
}

type TypeSyncSocket = SocketIOSocket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type TypeSyncSocketServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

// State maps
const docs = new Map<string, Y.Doc>();
const loadedDocs = new Set<string>();
const loadingDocs = new Map<string, Promise<void>>();
const socketRoles = new Map<string, Map<string, string>>();
const socketJoinGenerations = new Map<string, Map<string, number>>();
const pendingJoinCounts = new Map<string, number>();
const pendingJoinWaiters = new Set<() => void>();
let isDraining = false;

interface PersistenceState {
  dirty: boolean;
  flushRequested: boolean;
  persisting?: Promise<void>;
  debounceTimer?: NodeJS.Timeout;
  maxWaitTimer?: NodeJS.Timeout;
  retryTimer?: NodeJS.Timeout;
  cancelled: boolean;
}

const persistenceStates = new Map<string, PersistenceState>();

const SAVE_DEBOUNCE_INTERVAL = 5000;
const SAVE_MAX_WAIT_INTERVAL = 30000;
const SAVE_RETRY_INTERVAL = 15000;
const SESSION_REVALIDATION_INTERVAL = 60_000;
const DocumentIdSchema = z.string().uuid();
const trustedClientOrigin = new URL(config.clientUrl).origin;

// SEC-03: Defensive size limits for collaborative updates to prevent memory exhaustion.
// Document updates might contain base64 image strings (if allowed by the editor),
// so we set a limit of 10MB to accommodate them. A separate storage-backed image upload
// flow is the better long-term solution to allow lowering this limit further.
const MAX_DOC_UPDATE_BYTES = 10 * 1024 * 1024; // 10MB

// Awareness updates only transmit lightweight metadata like cursor position, selection,
// and user info. This is usually under 1KB, so 64KB is an extremely safe limit.
const MAX_AWARENESS_UPDATE_BYTES = 64 * 1024; // 64KB

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

function isTrustedSocketOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === trustedClientOrigin;
  } catch {
    return false;
  }
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

function getOrCreateDoc(docId: string): Y.Doc {
  let doc = docs.get(docId);
  if (!doc) {
    doc = new Y.Doc();
    docs.set(docId, doc);
  }
  return doc;
}

async function loadDocFromDB(docId: string, ydoc: Y.Doc): Promise<void> {
  const [doc] = await db
    .select({ yDocState: document.yDocState })
    .from(document)
    .where(eq(document.id, docId));

  if (doc?.yDocState) {
    try {
      Y.applyUpdate(ydoc, new Uint8Array(doc.yDocState));
    } catch (error) {
      console.error(`Malformed Yjs document state in DB for document ${docId}:`, error);
      throw new Error("Malformed document state in database");
    }
  }
}

async function saveDocToDB(docId: string, state: Uint8Array): Promise<void> {
  await db
    .update(document)
    .set({
      yDocState: Buffer.from(state),
      updatedAt: new Date(),
    })
    .where(eq(document.id, docId));
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
  if (state.persisting) {
    return state.persisting;
  }

  const operation = (async () => {
    while (state.flushRequested && !state.cancelled) {
      state.flushRequested = false;
      clearPersistenceTimers(state);
      if (!state.dirty) continue;

      state.dirty = false;
      const snapshot = Y.encodeStateAsUpdate(ydoc);
      try {
        await saveDocToDB(docId, snapshot);
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
    if (state.persisting === operation) {
      state.persisting = undefined;
    }
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
  if (!state) return;
  state.cancelled = true;
  state.flushRequested = false;
  clearPersistenceTimers(state);
  persistenceStates.delete(docId);
}

async function ensureDocLoaded(docId: string, ydoc: Y.Doc): Promise<void> {
  // Already loaded from DB
  if (loadedDocs.has(docId)) return;

  // Another client is already loading this doc — wait for it
  const existingLoad = loadingDocs.get(docId);
  if (existingLoad) {
    await existingLoad;
    return;
  }

  // First load: create a promise, store it, then load
  const loadPromise = loadDocFromDB(docId, ydoc)
    .then(() => {
      loadedDocs.add(docId);
    })
    .finally(() => {
      loadingDocs.delete(docId);
    });
  loadingDocs.set(docId, loadPromise);
  await loadPromise;
}

async function evictIfEmpty(
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
  documentId: string
): Promise<void> {
  const roomName = `doc:${documentId}`;
  const roomSize = io.sockets.adapter.rooms.get(roomName)?.size ?? 0;

  if (roomSize > 0) return;

  const ydoc = docs.get(documentId);
  if (!ydoc) return;

  // Persist before evicting
  try {
    await flushDocumentNow(documentId, ydoc);
    const postSaveRoomSize = io.sockets.adapter.rooms.get(`doc:${documentId}`)?.size ?? 0;
    if (postSaveRoomSize > 0) {
      console.log(`Aborted eviction of document ${documentId} (room active)`);
      return;
    }
  } catch (error) {
    console.error(`Failed to save doc ${documentId}; keeping it in memory:`, error);
    const state = getPersistenceState(documentId);
    scheduleRetry(documentId, ydoc, state);
    return;
  }

  discardPersistenceState(documentId);
  ydoc.destroy();
  docs.delete(documentId);
  loadedDocs.delete(documentId);

  console.log(`Evicted idle document ${documentId} from memory`);
}

// ─── Flush & Cleanup (BUG-05) ───────────────────────────

export async function flushAndCleanup(): Promise<{ succeeded: string[]; failed: string[] }> {
  const docEntries = Array.from(docs.entries());
  const succeeded: string[] = [];
  const failed: string[] = [];

  if (docEntries.length === 0) {
    return { succeeded, failed };
  }

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
}


export function notifyPermissionChange(
  io: TypeSyncSocketServer,
  documentId: string,
  targetUserId: string,
  role: "editor" | "viewer" | null
): void {
  const roomName = `doc:${documentId}`;

  for (const [, socket] of io.sockets.sockets) {
    if (socket.data.userId !== targetUserId || !socket.rooms.has(roomName)) {
      continue;
    }

    if (role) {
      socketRoles.get(socket.id)?.set(documentId, role);
      socket.emit("doc:permission-updated", { documentId, role });
    } else {
      socket.leave(roomName);
      socketRoles.get(socket.id)?.delete(documentId);
      socket.emit("doc:permission-revoked", { documentId });
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
        socketRoles.get(socketId)?.delete(documentId);
        socket.emit("doc:permission-revoked", { documentId });
        socket.leave(roomName);
      }
    }
  }

  discardPersistenceState(documentId);

  // Evict/destroy the in-memory Y.Doc state immediately
  const ydoc = docs.get(documentId);
  if (ydoc) {
    ydoc.destroy();
    docs.delete(documentId);
  }
  loadedDocs.delete(documentId);
  loadingDocs.delete(documentId);

  console.log(`Document ${documentId} deleted: sockets evicted and Y.Doc destroyed`);
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
      callback(null, isTrustedSocketOrigin(request.headers.origin));
    },
  });

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
    const userName = socket.data.userName!;
    const userEmail = socket.data.userEmail!;

    // Initialize per-socket role map
    socketRoles.set(socket.id, new Map());
    socketJoinGenerations.set(socket.id, new Map());
    const sessionValidationTimer = setInterval(() => {
      void ensureSocketSession(socket, true);
    }, SESSION_REVALIDATION_INTERVAL);
    sessionValidationTimer.unref();
    socket.data.sessionValidationTimer = sessionValidationTimer;

    console.log(`User connected: ${userEmail} (${userId})`);

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
        const ydoc = getOrCreateDoc(parsedDocumentId);
        await ensureDocLoaded(parsedDocumentId, ydoc);

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

        socket.join(roomName);
        socketRoles.get(socket.id)!.set(parsedDocumentId, currentAccess.role);

        const state = Y.encodeStateAsUpdate(ydoc);
        const stateVector = Y.encodeStateVector(ydoc);
        respond({
          success: true,
          state,
          stateVector,
          role: currentAccess.role as Role,
        });

        console.log(`${userEmail} joined document ${parsedDocumentId} as ${currentAccess.role}`);
      } catch (error) {
        console.error(`Failed to join document ${documentId}:`, error);
        if (parsedDocumentId) {
          const roomName = `doc:${parsedDocumentId}`;
          const roomSize = io.sockets.adapter.rooms.get(roomName)?.size ?? 0;
          if (roomSize === 0 && !loadedDocs.has(parsedDocumentId)) {
            const ydoc = docs.get(parsedDocumentId);
            if (ydoc) {
              ydoc.destroy();
              docs.delete(parsedDocumentId);
            }
            loadedDocs.delete(parsedDocumentId);
            loadingDocs.delete(parsedDocumentId);
            discardPersistenceState(parsedDocumentId);
          }
        }
        respond({ success: false, error: "Failed to load document" });
      } finally {
        if (parsedDocumentId && pendingJoinTracked) {
          const remaining = (pendingJoinCounts.get(parsedDocumentId) ?? 1) - 1;
          if (remaining > 0) {
            pendingJoinCounts.set(parsedDocumentId, remaining);
          } else {
            pendingJoinCounts.delete(parsedDocumentId);
            await evictIfEmpty(io, parsedDocumentId);
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
      socket.leave(roomName);

      // Remove role entry for this doc
      socketRoles.get(socket.id)?.delete(documentId);

      console.log(`${userEmail} left document ${documentId}`);

      // Evict from memory if room is now empty
      if (!isDraining) {
        await evictIfEmpty(io, documentId);
      }
    });

    socket.on("doc:update", async (documentId: string, update: Uint8Array) => {
      const parsedDocumentId = DocumentIdSchema.safeParse(documentId);
      if (!parsedDocumentId.success) {
        socket.emit("doc:error", { message: "Invalid document id" });
        return;
      }
      documentId = parsedDocumentId.data;
      const roomName = `doc:${documentId}`;

      if (isDraining) {
        socket.emit("doc:error", { documentId, message: "Server is shutting down" });
        return;
      }
      if (!(await ensureSocketSession(socket))) return;

      // SEC-01: Must be in the room
      if (!socket.rooms.has(roomName)) {
        socket.emit("doc:error", { documentId, message: "Not joined to this document" });
        return;
      }

      // SEC-02: Only explicit "owner" and "editor" roles may apply/broadcast document updates
      const role = socketRoles.get(socket.id)?.get(documentId);
      if (role !== "owner" && role !== "editor") {
        socket.emit("doc:error", { documentId, message: "Unauthorized to edit this document" });
        return;
      }

      // Validate that update payload is binary and within the size limit
      if (!(update instanceof Uint8Array)) {
        socket.emit("doc:error", { documentId, message: "Invalid document update payload type" });
        return;
      }

      if (update.byteLength > MAX_DOC_UPDATE_BYTES) {
        socket.emit("doc:error", { documentId, message: "Document update exceeds allowed size limit" });
        return;
      }

      const ydoc = docs.get(documentId);
      if (ydoc) {
        try {
          Y.applyUpdate(ydoc, new Uint8Array(update));
          scheduleSave(documentId, ydoc);
        } catch (error) {
          console.error(`Failed to apply Yjs document update for document ${documentId}:`, error);
          socket.emit("doc:error", { documentId, message: "Malformed document update payload" });
          return;
        }
      }

      // Broadcast to all other clients in the room
      socket.to(roomName).emit("doc:update", { documentId, update });
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

      // Drop/reject oversized or invalid awareness updates without broadcasting them
      if (!(update instanceof Uint8Array) || update.byteLength > MAX_AWARENESS_UPDATE_BYTES) {
        socket.emit("doc:error", { documentId, message: "Awareness update rejected" });
        return;
      }

      socket.to(roomName).emit("awareness:update", { documentId, update });
    });

    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${userEmail}`);

      // Collect doc IDs this socket was tracking, then clean up
      const roles = socketRoles.get(socket.id);
      const docIds = roles ? [...roles.keys()] : [];
      socketRoles.delete(socket.id);
      socketJoinGenerations.delete(socket.id);
      if (socket.data.sessionValidationTimer) {
        clearInterval(socket.data.sessionValidationTimer);
        socket.data.sessionValidationTimer = undefined;
      }

      // Evict any now-empty docs
      if (!isDraining) {
        for (const docId of docIds) {
          await evictIfEmpty(io, docId);
        }
      }
    });
  });

  return io;
}
