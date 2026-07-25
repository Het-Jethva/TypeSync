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
  ServerToClientEvents,
} from "@typesync/shared";
import type { SocketData, TypeSyncSocket, TypeSyncSocketServer } from "./types.js";
import { CollaborativeRoomSession } from "./room-session.js";

export type { TypeSyncSocketServer } from "./types.js";

const SESSION_REVALIDATION_INTERVAL = 60_000;
const DocumentIdSchema = z.string().uuid();
const trustedClientOrigin = new URL(config.clientUrl).origin;

let activeIo: TypeSyncSocketServer | undefined;
const roomSession = new CollaborativeRoomSession({
  getRoomOccupancy(documentId) {
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

export function beginSocketDrain(): void {
  roomSession.beginDrain();
}

export function waitForSocketDrain(): Promise<void> {
  return roomSession.waitForDrain();
}

export async function flushAndCleanup(): Promise<{ succeeded: string[]; failed: string[] }> {
  return roomSession.flushAll();
}

export async function notifyPermissionChange(
  io: TypeSyncSocketServer,
  documentId: string,
  targetUserId: string,
  role: "editor" | "viewer" | null
): Promise<void> {
  const roomName = `doc:${documentId}`;

  for (const [, socket] of io.sockets.sockets) {
    if (socket.data.userId !== targetUserId) continue;

    const inRoom = socket.rooms.has(roomName);

    if (role) {
      if (inRoom) {
        roomSession.setRole(socket.id, documentId, role);
      }
      socket.emit("doc:permission-updated", { documentId, role });
    } else {
      if (inRoom) {
        roomSession.releaseAwarenessBinding(socket, documentId);
        socket.leave(roomName);
        roomSession.clearRole(socket.id, documentId);
      }
      socket.emit("doc:permission-revoked", { documentId });
    }
  }

  if (role === null) {
    try {
      await roomSession.evictIfEmpty(documentId);
    } catch (error) {
      console.error(`Failed to evict document ${documentId} after permission revocation:`, error);
    }
  }
}

export function handleDocumentDeleted(
  io: TypeSyncSocketServer,
  documentId: string
): void {
  const roomName = `doc:${documentId}`;

  const roomSockets = io.sockets.adapter.rooms.get(roomName);
  if (roomSockets) {
    const socketIds = Array.from(roomSockets);
    for (const socketId of socketIds) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        roomSession.releaseAwarenessBinding(socket, documentId);
        roomSession.clearRole(socketId, documentId);
        socket.emit("doc:permission-revoked", { documentId });
        socket.leave(roomName);
      }
    }
  }

  roomSession.handleDocumentDeleted(documentId);
}

function originFromHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

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
    allowRequest: (request, callback) => {
      callback(
        null,
        isTrustedSocketOrigin(request.headers.origin, request.headers.referer)
      );
    },
  });
  activeIo = io;

  io.use(async (socket, next) => {
    try {
      const cookies = socket.handshake.headers.cookie || "";
      const headers = new Headers();
      headers.set("cookie", cookies);

      const session = await auth.api.getSession({ headers });
      if (!session) return next(new Error("Unauthorized"));

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
    const user = {
      id: socket.data.userId!,
      name: socket.data.userName!,
      email: socket.data.userEmail!,
    };
    const presence = roomSession.initializeSocket(socket.id, user);

    const sessionValidationTimer = setInterval(() => {
      void ensureSocketSession(socket, true);
    }, SESSION_REVALIDATION_INTERVAL);
    sessionValidationTimer.unref();
    socket.data.sessionValidationTimer = sessionValidationTimer;

    socket.on("doc:join", async (
      documentId: string,
      acknowledge: (result: DocumentJoinResult) => void
    ) => {
      const respond = typeof acknowledge === "function" ? acknowledge : () => {};
      const parsed = DocumentIdSchema.safeParse(documentId);
      if (!parsed.success) {
        respond({ success: false, error: "Invalid document id" });
        return;
      }
      const docId = parsed.data;

      if (!(await ensureSocketSession(socket))) {
        respond({ success: false, error: "Session expired" });
        return;
      }

      const result = await roomSession.joinSession({
        socketId: socket.id,
        user,
        documentId: docId,
        checkAccess: () => DocumentService.getDocumentAccess(docId, user.id),
        isStillConnected: () => socket.connected,
      });

      if (!result.success) {
        respond({ success: false, error: result.error });
        return;
      }

      const roomName = `doc:${docId}`;
      socket.join(roomName);

      respond({
        success: true,
        state: result.state,
        stateVector: result.stateVector,
        role: result.role,
        presence,
      });

      if (result.awarenessSnapshot) {
        socket.emit("awareness:update", {
          documentId: docId,
          update: result.awarenessSnapshot,
        });
      }

      if (result.sizeStatus) {
        socket.emit("doc:size-status", result.sizeStatus);
      }
    });

    socket.on("doc:leave", async (documentId: string) => {
      const parsed = DocumentIdSchema.safeParse(documentId);
      if (!parsed.success) return;
      const docId = parsed.data;
      const roomName = `doc:${docId}`;

      roomSession.releaseAwarenessBinding(socket, docId);
      socket.leave(roomName);
      await roomSession.leaveSession(socket.id, docId);
    });

    socket.on("doc:update", async (
      documentId: string,
      update: Uint8Array,
      acknowledge: (result: DocumentUpdateResult) => void
    ) => {
      const respond = typeof acknowledge === "function" ? acknowledge : () => {};
      const parsed = DocumentIdSchema.safeParse(documentId);
      if (!parsed.success) {
        socket.emit("doc:error", { message: "Invalid document id" });
        respond({ success: false, code: "invalid-payload", error: "Invalid document id" });
        return;
      }
      const docId = parsed.data;
      const roomName = `doc:${docId}`;

      if (!(await ensureSocketSession(socket))) {
        respond({ success: false, code: "session-expired", error: "Session expired" });
        return;
      }

      const inRoom = socket.rooms.has(roomName);
      const result = roomSession.applyUpdate({
        socketId: socket.id,
        documentId: docId,
        update,
        inRoom,
      });

      if (!result.success) {
        if (result.code !== "server-draining" && result.code !== "rate-limited") {
          socket.emit("doc:error", { documentId: docId, message: result.error });
        }
        if (result.sizeStatus) {
          socket.emit("doc:size-status", result.sizeStatus);
        }
        respond({ success: false, code: result.code, error: result.error });
        return;
      }

      if (result.sizeStatus) {
        io.to(roomName).emit("doc:size-status", result.sizeStatus);
      }

      socket.to(roomName).emit("doc:update", { documentId: docId, update });
      respond({ success: true });
    });

    socket.on("awareness:update", async (documentId: string, update: Uint8Array) => {
      const parsed = DocumentIdSchema.safeParse(documentId);
      if (!parsed.success) return;
      const docId = parsed.data;
      const roomName = `doc:${docId}`;

      if (!(await ensureSocketSession(socket))) return;

      const inRoom = socket.rooms.has(roomName);
      const sanitized = roomSession.applyAwareness({
        socket,
        documentId: docId,
        update,
        inRoom,
      });

      if (!sanitized) return;

      socket.to(roomName).emit("awareness:update", {
        documentId: docId,
        update: sanitized.update,
      });
    });

    socket.on("disconnect", async () => {
      const docIds = roomSession.handleDisconnect(socket.id);
      for (const docId of docIds) {
        roomSession.releaseAwarenessBinding(socket, docId);
      }
      if (socket.data.sessionValidationTimer) {
        clearInterval(socket.data.sessionValidationTimer);
        socket.data.sessionValidationTimer = undefined;
      }

      for (const docId of docIds) {
        await roomSession.evictIfEmpty(docId);
      }
    });
  });

  return io;
}
