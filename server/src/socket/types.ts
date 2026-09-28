import type { Server as SocketIOServer, Socket as SocketIOSocket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@typesync/shared";

/** Outcome of one `getSession` lookup. Cooldown is not a fourth outcome. */
export type SocketSessionCheck = "valid" | "expired" | "unavailable";

export interface SocketData {
  userId: string;
  userName: string;
  userEmail: string;
  authCookie: string;
  sessionId: string;
  /** Timestamp of the last lookup that resolved to a matching session. */
  lastSessionValidation: number;
  /**
   * After a thrown lookup, skip another `getSession` until this time.
   * Does not move `lastSessionValidation`.
   */
  sessionUnavailableUntil?: number;
  sessionValidation?: Promise<SocketSessionCheck>;
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
