import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { z } from "zod";
import type {
  ClientToServerEvents,
  DocumentJoinResult,
  DocumentUpdateResult,
  ServerToClientEvents,
} from "@typesync/shared";
import { config } from "../config.js";
import { auth } from "../lib/auth.js";
import { DocumentAccessAuthorizer } from "../services/document-access-authorizer.js";
import { CollaborativeRoomSession } from "./room-session.js";
import type { SocketData, TypeSyncSocket, TypeSyncSocketServer } from "./types.js";

export type { TypeSyncSocketServer } from "./types.js";

const SESSION_REVALIDATION_INTERVAL = 60_000;
const DocumentIdSchema = z.string().uuid();
const trustedClientOrigin = new URL(config.clientUrl).origin;

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

export function setupSocket(
  httpServer: HttpServer,
  roomSession: CollaborativeRoomSession,
  accessAuthorizer: DocumentAccessAuthorizer
): TypeSyncSocketServer {
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
    roomSession.initializeSocket(socket);

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
        socket,
        documentId: docId,
        authorize: () => accessAuthorizer.authorizeSocketSession(docId, socket.data.userId),
      });

      if (!result.success) {
        respond({ success: false, error: result.error });
        return;
      }

      respond({
        success: true,
        state: result.state,
        stateVector: result.stateVector,
        role: result.role,
        presence: result.presence,
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
      await roomSession.leaveSession(socket, parsed.data);
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

      if (!(await ensureSocketSession(socket))) {
        respond({ success: false, code: "session-expired", error: "Session expired" });
        return;
      }

      const result = roomSession.applyUpdate({ socket, documentId: docId, update });
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

      const roomName = `doc:${docId}`;
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

      if (!(await ensureSocketSession(socket))) return;

      const sanitized = roomSession.applyAwareness({ socket, documentId: docId, update });
      if (!sanitized) return;

      socket.to(`doc:${docId}`).emit("awareness:update", {
        documentId: docId,
        update: sanitized.update,
      });
    });

    socket.on("disconnect", async () => {
      if (socket.data.sessionValidationTimer) {
        clearInterval(socket.data.sessionValidationTimer);
        socket.data.sessionValidationTimer = undefined;
      }
      await roomSession.handleDisconnect(socket);
    });
  });

  return io;
}
