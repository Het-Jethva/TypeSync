import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import documentRoutes from "./routes/documents.js";
import { setupSocket } from "./socket/index.js";

const app = express();
const httpServer = createServer(app);

// ─── Middleware ───────────────────────────────────────────
app.use(
  cors({
    origin: process.env.VITE_CLIENT_URL || "http://localhost:5173",
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

// ─── Socket.IO ───────────────────────────────────────────
setupSocket(httpServer);

// ─── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`⚡ TypeSync server running on http://localhost:${PORT}`);
});
