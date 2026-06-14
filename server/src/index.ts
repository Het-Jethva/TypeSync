import { config } from "./config.js";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import documentRoutes from "./routes/documents.js";
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

// ─── API Routes ──────────────────────────────────────────
app.use("/api/documents", documentRoutes);

// ─── Health check ────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Error handler (must come after all routes) ──────────
app.use(errorHandler);

// ─── Socket.IO ───────────────────────────────────────────
setupSocket(httpServer);

// ─── Start ───────────────────────────────────────────────
httpServer.listen(config.port, () => {
  console.log(`⚡ TypeSync server running on http://localhost:${config.port}`);
});

// ─── Graceful shutdown ───────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await flushAndCleanup();
  httpServer.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await flushAndCleanup();
  httpServer.close();
  process.exit(0);
});
