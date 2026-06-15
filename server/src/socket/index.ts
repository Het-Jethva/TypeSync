import { Server as SocketIOServer } from "socket.io";
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
  ServerToClientEvents,
} from "@typesync/shared";

// Types
interface SocketData {
  userId: string;
  userName: string;
  userEmail: string;
}

export type TypeSyncSocketServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

// State maps
const docs = new Map<string, Y.Doc>();
const saveTimers = new Map<string, NodeJS.Timeout>();
const loadedDocs = new Set<string>();
const loadingDocs = new Map<string, Promise<void>>();
const socketRoles = new Map<string, Map<string, string>>();

const SAVE_INTERVAL = 5000;
const SAVE_RETRY_INTERVAL = 15000;
const DocumentIdSchema = z.string().uuid();

// SEC-03: Defensive size limits for collaborative updates to prevent memory exhaustion.
// Document updates might contain base64 image strings (if allowed by the editor),
// so we set a limit of 10MB to accommodate them. A separate storage-backed image upload
// flow is the better long-term solution to allow lowering this limit further.
const MAX_DOC_UPDATE_BYTES = 10 * 1024 * 1024; // 10MB

// Awareness updates only transmit lightweight metadata like cursor position, selection,
// and user info. This is usually under 1KB, so 64KB is an extremely safe limit.
const MAX_AWARENESS_UPDATE_BYTES = 64 * 1024; // 64KB

// ─── Helper functions ────────────────────────────────────

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

async function saveDocToDB(docId: string, ydoc: Y.Doc): Promise<void> {
  const state = Y.encodeStateAsUpdate(ydoc);
  await db
    .update(document)
    .set({
      yDocState: Buffer.from(state),
      updatedAt: new Date(),
    })
    .where(eq(document.id, docId));
}

function scheduleSave(docId: string, ydoc: Y.Doc): void {
  const existing = saveTimers.get(docId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    try {
      await saveDocToDB(docId, ydoc);
      saveTimers.delete(docId);
    } catch (error) {
      console.error(`Failed to save doc ${docId}; retrying:`, error);
      const retry = setTimeout(() => scheduleSave(docId, ydoc), SAVE_RETRY_INTERVAL);
      saveTimers.set(docId, retry);
    }
  }, SAVE_INTERVAL);

  saveTimers.set(docId, timer);
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

  // Clear any pending save timer
  const timer = saveTimers.get(documentId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(documentId);
  }

  // Persist before evicting
  try {
    await saveDocToDB(documentId, ydoc);
  } catch (error) {
    console.error(`Failed to save doc ${documentId}; keeping it in memory:`, error);
    scheduleSave(documentId, ydoc);
    return;
  }

  ydoc.destroy();
  docs.delete(documentId);
  loadedDocs.delete(documentId);

  console.log(`Evicted idle document ${documentId} from memory`);
}

// ─── Flush & Cleanup (BUG-05) ───────────────────────────

export async function flushAndCleanup(): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const [docId, ydoc] of docs) {
    // Cancel pending debounced saves — we'll save immediately
    const timer = saveTimers.get(docId);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(docId);
    }
    promises.push(saveDocToDB(docId, ydoc));
  }

  await Promise.all(promises);
  console.log(`Flushed ${promises.length} documents to DB`);
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

  // Clear any pending save timer
  const timer = saveTimers.get(documentId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(documentId);
  }

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

    console.log(`User connected: ${userEmail} (${userId})`);

    socket.on("doc:join", async (documentId: string) => {
      let parsedDocumentId: string | undefined;
      try {
        parsedDocumentId = DocumentIdSchema.parse(documentId);
        const { hasAccess, role } = await DocumentService.getDocumentAccess(
          parsedDocumentId,
          userId
        );
        if (!hasAccess) {
          socket.emit("doc:error", "Access denied");
          return;
        }

        const roomName = `doc:${parsedDocumentId}`;

        // Load before joining so a failed DB read cannot publish an empty state.
        const ydoc = getOrCreateDoc(parsedDocumentId);
        await ensureDocLoaded(parsedDocumentId, ydoc);

        socket.join(roomName);
        socketRoles.get(socket.id)!.set(parsedDocumentId, role);

        const state = Y.encodeStateAsUpdate(ydoc);
        socket.emit("doc:sync", state);

        console.log(`${userEmail} joined document ${parsedDocumentId} as ${role}`);
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
            const timer = saveTimers.get(parsedDocumentId);
            if (timer) {
              clearTimeout(timer);
              saveTimers.delete(parsedDocumentId);
            }
          }
        }
        socket.emit("doc:error", "Failed to load document");
      }
    });

    socket.on("doc:leave", async (documentId: string) => {
      const parsedDocumentId = DocumentIdSchema.safeParse(documentId);
      if (!parsedDocumentId.success) return;
      documentId = parsedDocumentId.data;
      const roomName = `doc:${documentId}`;
      socket.leave(roomName);

      // Remove role entry for this doc
      socketRoles.get(socket.id)?.delete(documentId);

      console.log(`${userEmail} left document ${documentId}`);

      // Evict from memory if room is now empty
      await evictIfEmpty(io, documentId);
    });

    socket.on("doc:update", (documentId: string, update: Uint8Array) => {
      const parsedDocumentId = DocumentIdSchema.safeParse(documentId);
      if (!parsedDocumentId.success) {
        socket.emit("doc:error", "Invalid document id");
        return;
      }
      documentId = parsedDocumentId.data;
      const roomName = `doc:${documentId}`;

      // SEC-01: Must be in the room
      if (!socket.rooms.has(roomName)) {
        socket.emit("doc:error", "Not joined to this document");
        return;
      }

      // SEC-02: Viewers cannot push updates
      const role = socketRoles.get(socket.id)?.get(documentId);
      if (role === "viewer") {
        socket.emit("doc:error", "Viewers cannot edit this document");
        return;
      }

      // Validate that update payload is binary and within the size limit
      if (!(update instanceof Uint8Array)) {
        socket.emit("doc:error", "Invalid document update payload type");
        return;
      }

      if (update.byteLength > MAX_DOC_UPDATE_BYTES) {
        socket.emit("doc:error", "Document update exceeds allowed size limit");
        return;
      }

      const ydoc = docs.get(documentId);
      if (ydoc) {
        try {
          Y.applyUpdate(ydoc, new Uint8Array(update));
          scheduleSave(documentId, ydoc);
        } catch (error) {
          console.error(`Failed to apply Yjs document update for document ${documentId}:`, error);
          socket.emit("doc:error", "Malformed document update payload");
          return;
        }
      }

      // Broadcast to all other clients in the room
      socket.to(roomName).emit("doc:update", update);
    });

    socket.on("awareness:update", (documentId: string, update: Uint8Array) => {
      const parsedDocumentId = DocumentIdSchema.safeParse(documentId);
      if (!parsedDocumentId.success) return;
      documentId = parsedDocumentId.data;
      const roomName = `doc:${documentId}`;

      // Must be in the room
      if (!socket.rooms.has(roomName)) {
        return;
      }

      // Drop/reject oversized or invalid awareness updates without broadcasting them
      if (!(update instanceof Uint8Array) || update.byteLength > MAX_AWARENESS_UPDATE_BYTES) {
        socket.emit("doc:error", "Awareness update rejected");
        return;
      }

      socket.to(roomName).emit("awareness:update", update);
    });

    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${userEmail}`);

      // Collect doc IDs this socket was tracking, then clean up
      const roles = socketRoles.get(socket.id);
      const docIds = roles ? [...roles.keys()] : [];
      socketRoles.delete(socket.id);

      // Evict any now-empty docs
      for (const docId of docIds) {
        await evictIfEmpty(io, docId);
      }
    });
  });

  return io;
}
