import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { document, documentCollaborator } from "../db/schema.js";
import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@typesync/shared";

// In-memory Yjs document store
const docs = new Map<string, Y.Doc>();
const saveTimers = new Map<string, NodeJS.Timeout>();

const SAVE_INTERVAL = 5000; // 5 seconds

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

async function checkDocAccess(
  userId: string,
  docId: string
): Promise<{ hasAccess: boolean; role: string }> {
  try {
    const [doc] = await db
      .select({ ownerId: document.ownerId })
      .from(document)
      .where(eq(document.id, docId));

    if (!doc) return { hasAccess: false, role: "" };
    if (doc.ownerId === userId) return { hasAccess: true, role: "owner" };

    const collabs = await db
      .select({ userId: documentCollaborator.userId, role: documentCollaborator.role })
      .from(documentCollaborator)
      .where(eq(documentCollaborator.documentId, docId));

    const collab = collabs.find((c) => c.userId === userId);
    if (collab) return { hasAccess: true, role: collab.role };

    return { hasAccess: false, role: "" };
  } catch {
    return { hasAccess: false, role: "" };
  }
}

export function setupSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      cors: {
        origin: process.env.VITE_CLIENT_URL || "http://localhost:5173",
        credentials: true,
      },
    }
  );

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

      (socket as any).userId = session.user.id;
      (socket as any).userName = session.user.name;
      (socket as any).userEmail = session.user.email;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket as any).userId as string;
    const userName = (socket as any).userName as string;
    const userEmail = (socket as any).userEmail as string;

    console.log(`User connected: ${userEmail} (${userId})`);

    socket.on("doc:join", async (documentId: string) => {
      const { hasAccess, role } = await checkDocAccess(userId, documentId);
      if (!hasAccess) {
        socket.emit("doc:error", "Access denied");
        return;
      }

      const roomName = `doc:${documentId}`;
      socket.join(roomName);

      // Load or create Yjs doc
      const ydoc = getOrCreateDoc(documentId);

      // If new doc (not loaded yet), load from DB
      if (Y.encodeStateAsUpdate(ydoc).length <= 2) {
        await loadDocFromDB(documentId, ydoc);
      }

      // Send current state to the joining client
      const state = Y.encodeStateAsUpdate(ydoc);
      socket.emit("doc:sync", state);

      console.log(`${userEmail} joined document ${documentId} as ${role}`);
    });

    socket.on("doc:leave", (documentId: string) => {
      const roomName = `doc:${documentId}`;
      socket.leave(roomName);
      console.log(`${userEmail} left document ${documentId}`);
    });

    socket.on("doc:update", (documentId: string, update: Uint8Array) => {
      const roomName = `doc:${documentId}`;
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
      socket.to(roomName).emit("awareness:update", update);
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${userEmail}`);
    });
  });

  return io;
}
