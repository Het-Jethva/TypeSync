import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
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

// State maps
const docs = new Map<string, Y.Doc>();
const saveTimers = new Map<string, NodeJS.Timeout>();
const loadedDocs = new Set<string>();
const loadingDocs = new Map<string, Promise<void>>();
const socketRoles = new Map<string, Map<string, string>>();

const SAVE_INTERVAL = 5000;

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
  try {
    const [doc] = await db
      .select({ yDocState: document.yDocState })
      .from(document)
      .where(eq(document.id, docId));

    if (doc?.yDocState) {
      Y.applyUpdate(ydoc, new Uint8Array(doc.yDocState));
    }
  } catch (error) {
    console.error(`Failed to load doc ${docId} from DB:`, error);
  }
}

async function saveDocToDB(docId: string, ydoc: Y.Doc): Promise<void> {
  try {
    const state = Y.encodeStateAsUpdate(ydoc);
    await db
      .update(document)
      .set({
        yDocState: Buffer.from(state),
        updatedAt: new Date(),
      })
      .where(eq(document.id, docId));
  } catch (error) {
    console.error(`Failed to save doc ${docId} to DB:`, error);
  }
}

function scheduleSave(docId: string, ydoc: Y.Doc): void {
  const existing = saveTimers.get(docId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    saveDocToDB(docId, ydoc);
    saveTimers.delete(docId);
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
  const loadPromise = loadDocFromDB(docId, ydoc).then(() => {
    loadedDocs.add(docId);
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
  await saveDocToDB(documentId, ydoc);

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

// ─── Socket Setup ────────────────────────────────────────

export function setupSocket(httpServer: HttpServer): SocketIOServer {
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
      const { hasAccess, role } = await DocumentService.getDocumentAccess(
        documentId,
        userId
      );
      if (!hasAccess) {
        socket.emit("doc:error", "Access denied");
        return;
      }

      const roomName = `doc:${documentId}`;
      socket.join(roomName);

      // Store the role for this socket + document
      socketRoles.get(socket.id)!.set(documentId, role);

      // Load or create Yjs doc
      const ydoc = getOrCreateDoc(documentId);
      await ensureDocLoaded(documentId, ydoc);

      // Send current state to the joining client
      const state = Y.encodeStateAsUpdate(ydoc);
      socket.emit("doc:sync", state);

      console.log(`${userEmail} joined document ${documentId} as ${role}`);
    });

    socket.on("doc:leave", async (documentId: string) => {
      const roomName = `doc:${documentId}`;
      socket.leave(roomName);

      // Remove role entry for this doc
      socketRoles.get(socket.id)?.delete(documentId);

      console.log(`${userEmail} left document ${documentId}`);

      // Evict from memory if room is now empty
      await evictIfEmpty(io, documentId);
    });

    socket.on("doc:update", (documentId: string, update: Uint8Array) => {
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

      const ydoc = docs.get(documentId);
      if (ydoc) {
        Y.applyUpdate(ydoc, new Uint8Array(update));
        scheduleSave(documentId, ydoc);
      }

      // Broadcast to all other clients in the room
      socket.to(roomName).emit("doc:update", update);
    });

    socket.on("awareness:update", (documentId: string, update: Uint8Array) => {
      const roomName = `doc:${documentId}`;

      // Must be in the room
      if (!socket.rooms.has(roomName)) {
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
