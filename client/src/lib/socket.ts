import { io, Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@typesync/shared";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL || undefined, {
      withCredentials: true,
      autoConnect: false,
      // Try WebSocket first so the connection skips the long-polling handshake
      // and its upgrade round trips. Polling stays as a fallback for networks
      // that block WebSocket outright.
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}
