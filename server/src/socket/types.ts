import type { Server as SocketIOServer, Socket as SocketIOSocket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@typesync/shared";

export interface SocketData {
  userId: string;
  userName: string;
  userEmail: string;
  authCookie: string;
  sessionId: string;
  lastSessionValidation: number;
  sessionValidation?: Promise<boolean>;
  sessionValidationTimer?: NodeJS.Timeout;
  awarenessTokens: number;
  awarenessLastRefill: number;
  awarenessViolations: number;
}

export type TypeSyncSocket = SocketIOSocket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type TypeSyncSocketServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
