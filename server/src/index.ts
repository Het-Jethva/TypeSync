import { config } from "./config.js";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { toNodeHandler } from "better-auth/node";
import { AUTH_CLIENT_IP_HEADER, auth } from "./lib/auth.js";
import createDocumentRoutes from "./routes/documents.js";
import { DocumentAccessAuthorizer } from "./services/document-access-authorizer.js";
import { DocumentService } from "./services/document.service.js";
import { setupSocket } from "./socket/index.js";
import { CollaborativeRoomSession } from "./socket/room-session.js";
import { DrizzleDocumentStateRepository } from "./socket/repository.js";
import type { TypeSyncSocketServer } from "./socket/types.js";
import { errorHandler } from "./middleware/error.js";
import { createRateLimit } from "./middleware/rate-limit.js";
import { pool } from "./db/index.js";

const app = express();
app.disable("x-powered-by");
// Render terminates TLS at its edge proxy. Without this every request reports
// the proxy's address, so per-client rate limiting would put the whole world in
// one bucket. One hop only — the edge is the sole proxy in front of this app.
if (config.isProduction) {
  app.set("trust proxy", 1);
}
const httpServer = createServer(app);

pool.on("error", (error) => {
  console.error("Unexpected database pool error", error);
});

// ─── Middleware ───────────────────────────────────────────
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
    // Writes still preflight. Without this the browser default is 5 seconds,
    // so nearly every mutation pays a second cross-origin round trip.
    // 7200 is the ceiling Chromium honours.
    maxAge: 7200,
  })
);
app.use(express.json());

// ─── Better Auth handler ─────────────────────────────────
app.all("/api/auth/*splat", (req, _res, next) => {
  // Better Auth rejects a multi-hop X-Forwarded-For chain without a proxy
  // allowlist. Express has already resolved the client through the one Render
  // edge hop above. Overwrite this header so callers cannot choose their own IP.
  if (req.ip) {
    req.headers[AUTH_CLIENT_IP_HEADER] = req.ip;
  } else {
    delete req.headers[AUTH_CLIENT_IP_HEADER];
  }
  next();
}, toNodeHandler(auth));

// ─── Health check ────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// The frontend probes readiness every 2.5s for up to 45s during a cold start,
// so a burst of 20 covers a full wake-up cycle before the sustained rate bites.
const readinessRateLimit = createRateLimit({ requestsPerMinute: 60, burst: 20 });
const documentsRateLimit = createRateLimit({ requestsPerMinute: 120, burst: 40 });

app.get("/api/ready", readinessRateLimit, async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ status: "ready", timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Database readiness check failed", error);
    res.status(503).json({ status: "not_ready", timestamp: new Date().toISOString() });
  }
});

const socketServer: { current?: TypeSyncSocketServer } = {};
const roomSession = new CollaborativeRoomSession({
  repository: new DrizzleDocumentStateRepository(),
  getRoomOccupancy(documentId) {
    return socketServer.current?.sockets.adapter.rooms.get(`doc:${documentId}`)?.size ?? 0;
  },
  onDocumentSaved({ documentId, title, updatedAt, revision, epoch }) {
    const payload = {
      documentId,
      title,
      updatedAt: updatedAt.toISOString(),
      revision,
      epoch,
    };
    void DocumentService.listAccessUserIds(documentId)
      .then((userIds) => {
        roomSession.emitToUsers(userIds, (socket) => {
          socket.emit("doc:saved", payload);
        });
      })
      .catch((error) => {
        console.error(`Failed to notify audience that ${documentId} was saved:`, error);
      });
  },
});
const accessAuthorizer = new DocumentAccessAuthorizer(roomSession);

// ─── Socket.IO ───────────────────────────────────────────
const io = setupSocket(httpServer, roomSession, accessAuthorizer);
socketServer.current = io;

// ─── API Routes ──────────────────────────────────────────
app.use(
  "/api/documents",
  documentsRateLimit,
  createDocumentRoutes(roomSession, accessAuthorizer)
);

// ─── Error handler (must come after all routes) ──────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────
httpServer.listen(config.port, () => {
  console.log(`TypeSync server running on http://localhost:${config.port}`);
});

// ─── Graceful shutdown ───────────────────────────────────
let shuttingDown = false;
// Stop waiting for drain (including joins blocked in authorize/ensureLoaded).
// Not a deadline for the flush itself.
const SHUTDOWN_TIMEOUT_MS = 30_000;
// If the forced flush never settles, exit anyway so shutdown cannot stick.
const FORCED_FLUSH_BOUND_MS = 5_000;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  let exitCode = 0;
  let shutdownFinished = false;
  let flushSettled = false;
  let reportedFlushFailure = false;
  let documentsFlush: ReturnType<typeof roomSession.flushAll> | undefined;

  function reportFlushFailures(failed: string[]) {
    if (failed.length === 0 || reportedFlushFailure) return;
    reportedFlushFailure = true;
    console.error(`Graceful shutdown: failed to save ${failed.length} document(s).`);
  }

  // The deadline and the body below must share one flush. A second overlapping
  // flushAll would race the same documents.
  function flushDocumentsOnce() {
    documentsFlush ??= roomSession.flushAll();
    return documentsFlush;
  }

  async function forceFlushAndExit() {
    // The body already finished and cleared this timer. A callback that was
    // already queued must not turn that shutdown into exit 1.
    if (shutdownFinished) return;

    // Flush has not started, so this deadline is still inside io.close or
    // waitForDrain. Exit 1 after the flush even if every document saves.
    const drainStillPending = documentsFlush === undefined;

    const flushPromise = flushDocumentsOnce().then(
      (result) => ({ status: 'flushed' as const, result }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    );
    let resolveBound: (outcome: { status: 'timeout' }) => void = () => {};
    const bound = new Promise<{ status: 'timeout' }>((resolve) => {
      resolveBound = resolve;
    });
    const boundTimer = setTimeout(() => resolveBound({ status: 'timeout' }), FORCED_FLUSH_BOUND_MS);
    const outcome = await Promise.race([flushPromise, bound]);
    clearTimeout(boundTimer);

    if (outcome.status === 'timeout') {
      if (shutdownFinished) return;
      console.error(`Graceful shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit.`);
      console.error(
        `Graceful shutdown: forced flush did not finish within ${FORCED_FLUSH_BOUND_MS}ms.`
      );
      process.exit(1);
    }

    // Drain had already finished and the body saved and cleared the deadline
    // while this flush was in flight. Keep that exit code.
    if (shutdownFinished && !drainStillPending) return;

    console.error(`Graceful shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit.`);
    if (outcome.status === 'rejected') {
      console.error('Fatal error during forced flush:', outcome.error);
      process.exit(1);
    }
    reportFlushFailures(outcome.result.failed);
    process.exit(1);
  }

  const forcedExit = setTimeout(() => {
    void forceFlushAndExit().catch((error) => {
      console.error('Fatal error during forced shutdown:', error);
      process.exit(1);
    });
  }, SHUTDOWN_TIMEOUT_MS);
  forcedExit.unref();

  try {
    roomSession.beginDrain();
    await io.close();
    await roomSession.waitForDrain();
    const { failed } = await flushDocumentsOnce();
    flushSettled = true;
    if (failed.length > 0) {
      reportFlushFailures(failed);
      exitCode = 1;
    } else {
      console.log('Graceful shutdown completed successfully.');
    }
    await pool.end();
  } catch (error) {
    console.error('Fatal error during graceful shutdown:', error);
    exitCode = 1;
    // A deadline flush may already be using the pool. Closing it first fails that flush.
    if (!flushSettled) {
      try {
        const { failed } = await flushDocumentsOnce();
        reportFlushFailures(failed);
      } catch (flushError) {
        if (flushError !== error) {
          console.error('Failed to flush documents during shutdown:', flushError);
        }
      }
    }
    await pool.end().catch((poolError) => {
      console.error('Failed to close database pool:', poolError);
    });
  }
  shutdownFinished = true;
  clearTimeout(forcedExit);
  process.exitCode = exitCode;
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
