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
import { isTrustedWebOrigin } from "../lib/origin.js";
import { sessionCacheHit, sessionRecheck } from "../lib/session-recheck.js";
import { DocumentAccessAuthorizer } from "../services/document-access-authorizer.js";
import { CollaborativeRoomSession } from "./room-session.js";
import type {
  SocketData,
  SocketSessionCheck,
  TypeSyncSocket,
  TypeSyncSocketServer,
} from "./types.js";

const SESSION_REVALIDATION_INTERVAL = 60_000;
/** Backoff after a thrown lookup. Not a successful validation. */
const SESSION_CHECK_UNAVAILABLE_COOLDOWN_MS = 5_000;
const SESSION_CHECK_UNAVAILABLE_ERROR = "Session check unavailable";
const DocumentIdSchema = z.string().uuid();
const MAX_SOCKET_BUFFER_BYTES = 12 * 1024 * 1024;

async function ensureSocketSession(
  socket: TypeSyncSocket,
  force = false
): Promise<SocketSessionCheck> {
  const now = Date.now();
  if (
    !force &&
    sessionCacheHit(
      now,
      socket.data.lastSessionValidation,
      SESSION_REVALIDATION_INTERVAL,
      socket.data.sessionUnavailableUntil
    )
  ) {
    return "valid";
  }

  // A lookup already running can still resolve to expiry. Do not hide that
  // behind the failure cooldown.
  if (socket.data.sessionValidation) {
    return socket.data.sessionValidation;
  }

  if (sessionRecheck(now, socket.data.sessionUnavailableUntil) === "unavailable") {
    return "unavailable";
  }

  const headers = new Headers();
  headers.set("cookie", socket.data.authCookie);
  const validation = Promise.resolve()
    .then(() => auth.api.getSession({ headers }))
    .then((session): SocketSessionCheck =>
      session?.session.id === socket.data.sessionId ? "valid" : "expired"
    )
    .catch((): SocketSessionCheck => "unavailable");
  socket.data.sessionValidation = validation;

  try {
    const status = await validation;
    if (status === "valid") {
      socket.data.lastSessionValidation = Date.now();
      socket.data.sessionUnavailableUntil = undefined;
      return "valid";
    }

    if (status === "unavailable") {
      socket.data.sessionUnavailableUntil =
        Date.now() + SESSION_CHECK_UNAVAILABLE_COOLDOWN_MS;
      return "unavailable";
    }

    socket.emit("doc:error", { message: "Session expired" });
    socket.disconnect(true);
    return "expired";
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
    maxHttpBufferSize: MAX_SOCKET_BUFFER_BYTES,
    allowRequest: (request, callback) => {
      callback(
        null,
        isTrustedWebOrigin(request.headers.origin, request.headers.referer)
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
        respond({ success: false, code: "invalid-id", error: "Invalid document id" });
        return;
      }
      const docId = parsed.data;

      const session = await ensureSocketSession(socket, true);
      if (session === "expired") {
        respond({ success: false, code: "session-expired", error: "Session expired" });
        return;
      }
      if (session === "unavailable") {
        respond({
          success: false,
          code: "unavailable",
          error: SESSION_CHECK_UNAVAILABLE_ERROR,
        });
        return;
      }

      const result = await roomSession.joinSession({
        socket,
        documentId: docId,
        authorize: () => accessAuthorizer.authorizeSocketSession(docId, socket.data.userId),
      });

      if (!result.success) {
        respond({ success: false, code: result.code, error: result.error });
        return;
      }

      respond({
        success: true,
        state: result.state,
        stateVector: result.stateVector,
        role: result.role,
        presence: result.presence,
        epoch: result.epoch,
        persistedRevision: result.persistedRevision,
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

      // Cached validation, like awareness. The join handler and the 60s
      // revalidation timer are the session boundaries; forcing a DB lookup on
      // every keystroke (up to 30/s per editor) buys nothing — per-update
      // access is still enforced below via the room role check. A thrown
      // lookup is retryable and, for a few seconds, is not repeated.
      const session = await ensureSocketSession(socket);
      if (session === "expired") {
        respond({ success: false, code: "session-expired", error: "Session expired" });
        return;
      }
      if (session === "unavailable") {
        respond({
          success: false,
          code: "unavailable",
          error: SESSION_CHECK_UNAVAILABLE_ERROR,
        });
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
      respond({ success: true, revision: result.revision, epoch: result.epoch });
    });

    socket.on("awareness:update", async (documentId: string, update: Uint8Array) => {
      const parsed = DocumentIdSchema.safeParse(documentId);
      if (!parsed.success) return;
      const docId = parsed.data;

      if ((await ensureSocketSession(socket)) !== "valid") return;

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
