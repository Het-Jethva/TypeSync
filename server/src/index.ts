import { config } from "./config.js";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import createDocumentRoutes from "./routes/documents.js";
import { setupSocket, flushAndCleanup } from "./socket/index.js";
import { errorHandler } from "./middleware/error.js";

const app = express();
const httpServer = createServer(app);

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

// ─── Socket.IO ───────────────────────────────────────────
const io = setupSocket(httpServer);

// ─── API Routes ──────────────────────────────────────────
app.use("/api/documents", createDocumentRoutes(io));

// ─── Error handler (must come after all routes) ──────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────
httpServer.listen(config.port, () => {
  console.log(`⚡ TypeSync server running on http://localhost:${config.port}`);
});

// ─── Graceful shutdown ───────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  try {
    const { failed } = await flushAndCleanup();
    httpServer.close();
    if (failed.length > 0) {
      console.error(`Graceful shutdown: failed to save ${failed.length} document(s).`);
      process.exit(1);
    } else {
      console.log('Graceful shutdown completed successfully.');
      process.exit(0);
    }
  } catch (error) {
    console.error('Fatal error during graceful shutdown:', error);
    httpServer.close();
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  try {
    const { failed } = await flushAndCleanup();
    httpServer.close();
    if (failed.length > 0) {
      console.error(`Graceful shutdown: failed to save ${failed.length} document(s).`);
      process.exit(1);
    } else {
      console.log('Graceful shutdown completed successfully.');
      process.exit(0);
    }
  } catch (error) {
    console.error('Fatal error during graceful shutdown:', error);
    httpServer.close();
    process.exit(1);
  }
});
