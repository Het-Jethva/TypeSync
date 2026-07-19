import { config } from "./config.js";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import createDocumentRoutes from "./routes/documents.js";
import {
  beginSocketDrain,
  setupSocket,
  flushAndCleanup,
  waitForSocketDrain,
} from "./socket/index.js";
import { errorHandler } from "./middleware/error.js";
import { pool } from "./db/index.js";

const app = express();
const httpServer = createServer(app);

pool.on("error", () => {
  console.error("Unexpected database pool error");
});

// ─── Middleware ───────────────────────────────────────────
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
  })
);
app.use(express.json());

// ─── Better Auth handler ─────────────────────────────────
app.all("/api/auth/*splat", toNodeHandler(auth));

// ─── Health check ────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/ready", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ status: "ready", timestamp: new Date().toISOString() });
  } catch {
    console.error("Database readiness check failed");
    res.status(503).json({ status: "not_ready", timestamp: new Date().toISOString() });
  }
});

// ─── Socket.IO ───────────────────────────────────────────
const io = setupSocket(httpServer);

// ─── API Routes ──────────────────────────────────────────
app.use("/api/documents", createDocumentRoutes(io));

// ─── Error handler (must come after all routes) ──────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────
httpServer.listen(config.port, () => {
  console.log(`TypeSync server running on http://localhost:${config.port}`);
});

// ─── Graceful shutdown ───────────────────────────────────
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 30_000;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  let exitCode = 0;
  const forcedExit = setTimeout(() => {
    console.error(`Graceful shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forcedExit.unref();
  try {
    beginSocketDrain();
    await io.close();
    await waitForSocketDrain();
    const { failed } = await flushAndCleanup();
    if (failed.length > 0) {
      console.error(`Graceful shutdown: failed to save ${failed.length} document(s).`);
      exitCode = 1;
    } else {
      console.log('Graceful shutdown completed successfully.');
    }
    await pool.end();
  } catch (error) {
    console.error('Fatal error during graceful shutdown:', error);
    exitCode = 1;
    await pool.end().catch((poolError) => {
      console.error('Failed to close database pool:', poolError);
    });
  }
  clearTimeout(forcedExit);
  process.exitCode = exitCode;
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
