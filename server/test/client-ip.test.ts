import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import express from "express";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";
import { RENDER_HTTP_PROXY_HOPS, resolveSocketClientIp } from "../src/lib/client-ip.ts";

test("Render HTTP and Socket.IO identify the client beyond spoofed prefixes, including after upgrades", { timeout: 10_000 }, async (t) => {
  const clientIp = "198.51.100.7";
  const httpForwarded = `203.0.113.101, ${clientIp}, 203.0.113.7, 10.0.0.1`;
  const websocketForwarded = `203.0.113.101, ${clientIp}`;
  const app = express();
  app.set("trust proxy", RENDER_HTTP_PROXY_HOPS);
  app.get("/ip", (request, response) => response.json({ ip: request.ip }));
  const server = createServer(app);
  const io = new Server(server);
  const duplicateTransportIp = Promise.withResolvers<string>();
  io.use((socket, next) => {
    socket.data.initialIp = resolveSocketClientIp(socket.request, { isProduction: true });
    if (new URL(socket.request.url ?? "", "http://localhost").searchParams.getAll("transport").length > 1) {
      duplicateTransportIp.resolve(socket.data.initialIp);
    }
    next();
  });
  io.on("connection", (socket) => {
    socket.on("ip", (acknowledge) => acknowledge({
      initialIp: socket.data.initialIp,
      ip: resolveSocketClientIp(socket.request, { isProduction: true }),
      developmentIp: resolveSocketClientIp(socket.request, { isProduction: false }),
      originalTransport: new URL(socket.request.url ?? "", "http://localhost").searchParams.get("transport"),
      transport: socket.conn.transport.name,
    }));
  });
  t.after(() => new Promise<void>((resolve) => io.close(() => resolve())));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  for (const prefix of ["203.0.113.101", "203.0.113.102"]) {
    const response = await fetch(`${url}/ip`, {
      headers: { "x-forwarded-for": httpForwarded.replace("203.0.113.101", prefix) },
    });
    assert.deepEqual(await response.json(), { ip: clientIp });
  }
  app.set("trust proxy", false);
  const development = await fetch(`${url}/ip`, { headers: { "x-forwarded-for": httpForwarded } });
  assert.deepEqual(await development.json(), { ip: "127.0.0.1" });

  const duplicateTransport = new WebSocket(
    `${url.replace("http:", "ws:")}/socket.io/?EIO=4&transport=polling&transport=websocket`,
    { headers: { "x-forwarded-for": websocketForwarded } }
  );
  t.after(() => duplicateTransport.close());
  duplicateTransport.addEventListener("error", () => duplicateTransportIp.reject(new Error("Duplicate transport connection failed")));
  duplicateTransport.addEventListener("message", (event) => {
    if (typeof event.data === "string" && event.data.startsWith("0")) duplicateTransport.send("40");
  });
  assert.equal(await duplicateTransportIp.promise, clientIp);
  duplicateTransport.close();

  for (const originalTransport of ["websocket", "polling"]) {
    const socket = connect(url, {
      autoConnect: false,
      transports: originalTransport === "websocket" ? ["websocket"] : ["polling", "websocket"],
      transportOptions: {
        polling: { extraHeaders: { "x-forwarded-for": httpForwarded } },
        websocket: { extraHeaders: { "x-forwarded-for": websocketForwarded } },
      },
      reconnection: false,
    });
    t.after(() => socket.disconnect());
    const upgraded = Promise.withResolvers<void>();
    socket.io.on("open", () => {
      if (originalTransport === "websocket") upgraded.resolve();
      else socket.io.engine.once("upgrade", () => upgraded.resolve());
    });
    const connected = new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    socket.connect();
    await connected;
    await upgraded.promise;
    assert.deepEqual(await socket.timeout(2_000).emitWithAck("ip"), {
      initialIp: clientIp,
      ip: clientIp,
      developmentIp: "127.0.0.1",
      originalTransport,
      transport: "websocket",
    });
    socket.disconnect();
  }
});
