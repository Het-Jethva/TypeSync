import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { z } from "zod";
import type { PresenceIdentity } from "@typesync/shared";
import type { TypeSyncSocket } from "./types.js";

interface AwarenessBinding {
  clientId: number;
  clock: number;
}

interface SanitizedAwarenessUpdate {
  update: Uint8Array;
  clientId: number;
  clock: number;
  state: Record<string, unknown> | null;
  removed: boolean;
}

interface StoredAwarenessEntry {
  clock: number;
  state: Record<string, unknown>;
}

interface AwarenessManager {
  initializeSocket(socket: TypeSyncSocket): PresenceIdentity;
  consumeUpdate(
    socket: TypeSyncSocket,
    documentId: string,
    update: Uint8Array
  ): SanitizedAwarenessUpdate | null;
  snapshot(documentId: string): Uint8Array | null;
  releaseBinding(socket: TypeSyncSocket, documentId: string): void;
  forgetSocket(socketId: string): void;
  forgetDocument(documentId: string): void;
}

const socketAwarenessBindings = new Map<string, Map<string, AwarenessBinding>>();
const awarenessClientOwners = new Map<string, Map<number, string>>();
const activeAwarenessEntries = new Map<string, Map<number, StoredAwarenessEntry>>();

const MAX_AWARENESS_UPDATE_BYTES = 16 * 1024;
const AWARENESS_UPDATES_PER_SECOND = 20;
const AWARENESS_BURST_SIZE = 40;
const MAX_AWARENESS_VIOLATIONS = 5;
const PRESENCE_COLORS = [
  "#c2593f",
  "#4e655d",
  "#d99a4c",
  "#a3523f",
  "#5a6b7c",
  "#8c6f5e",
  "#9c5a6c",
  "#6b5c7b",
] as const;
const AwarenessClientIdSchema = z.number().int().nonnegative().max(0xffff_ffff);
const AwarenessClockSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const RelativePositionIdSchema = z.object({
  client: AwarenessClientIdSchema,
  clock: AwarenessClockSchema,
});
const RelativePositionSchema = z
  .object({
    type: RelativePositionIdSchema.nullable().optional(),
    tname: z.string().max(256).nullable().optional(),
    item: RelativePositionIdSchema.nullable().optional(),
    assoc: z.number().int().safe().nullable().optional(),
  })
  .passthrough();
const AwarenessStateSchema = z
  .object({
    cursor: z
      .object({
        anchor: RelativePositionSchema,
        head: RelativePositionSchema,
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

function presenceIdentity(socket: TypeSyncSocket): PresenceIdentity {
  let hash = 0;
  for (const char of socket.data.userId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return {
    userId: socket.data.userId,
    name: socket.data.userName,
    color: PRESENCE_COLORS[hash % PRESENCE_COLORS.length],
  };
}

function consumeAwarenessToken(socket: TypeSyncSocket): boolean {
  const now = Date.now();
  const elapsedSeconds = (now - socket.data.awarenessLastRefill) / 1000;
  socket.data.awarenessTokens = Math.min(
    AWARENESS_BURST_SIZE,
    socket.data.awarenessTokens + elapsedSeconds * AWARENESS_UPDATES_PER_SECOND
  );
  socket.data.awarenessLastRefill = now;

  if (socket.data.awarenessTokens < 1) return false;
  socket.data.awarenessTokens -= 1;
  return true;
}

function rejectAwarenessUpdate(socket: TypeSyncSocket, documentId: string): void {
  socket.data.awarenessViolations += 1;
  socket.emit("doc:error", { documentId, message: "Awareness update rejected" });
  if (socket.data.awarenessViolations >= MAX_AWARENESS_VIOLATIONS) {
    socket.disconnect(true);
  }
}

function encodeAwarenessEntries(
  entries: ReadonlyArray<readonly [number, number, Record<string, unknown> | null]>
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const [clientId, clock, state] of entries) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, JSON.stringify(state));
  }
  return encoding.toUint8Array(encoder);
}

function encodeAwarenessEntry(
  clientId: number,
  clock: number,
  state: Record<string, unknown> | null
): Uint8Array {
  return encodeAwarenessEntries([[clientId, clock, state]]);
}

function forgetAwarenessBinding(socketId: string, documentId: string): void {
  const bindings = socketAwarenessBindings.get(socketId);
  if (!bindings) return;
  const binding = bindings.get(documentId);
  if (!binding) return;

  bindings.delete(documentId);
  if (bindings.size === 0) socketAwarenessBindings.delete(socketId);

  const owners = awarenessClientOwners.get(documentId);
  if (owners?.get(binding.clientId) === socketId) {
    owners.delete(binding.clientId);
    if (owners.size === 0) awarenessClientOwners.delete(documentId);

    const entries = activeAwarenessEntries.get(documentId);
    entries?.delete(binding.clientId);
    if (entries?.size === 0) activeAwarenessEntries.delete(documentId);
  }
}

function sanitizeAwarenessUpdate(
  socket: TypeSyncSocket,
  documentId: string,
  update: Uint8Array
): SanitizedAwarenessUpdate | null {
  const decoder = decoding.createDecoder(update);
  const entryCount = decoding.readVarUint(decoder);
  if (entryCount !== 1) throw new Error("Awareness frames must contain exactly one client");

  const clientId = AwarenessClientIdSchema.parse(decoding.readVarUint(decoder));
  const clock = AwarenessClockSchema.parse(decoding.readVarUint(decoder));
  const rawState: unknown = JSON.parse(decoding.readVarString(decoder));
  if (decoding.hasContent(decoder)) throw new Error("Awareness frame has trailing data");
  const parsedState = rawState === null ? null : AwarenessStateSchema.parse(rawState);

  let bindings = socketAwarenessBindings.get(socket.id);
  if (!bindings) {
    bindings = new Map();
    socketAwarenessBindings.set(socket.id, bindings);
  }
  const existingBinding = bindings.get(documentId);

  if (existingBinding && existingBinding.clientId !== clientId) {
    throw new Error("Awareness client id changed within a document session");
  }
  if (!existingBinding && rawState === null) {
    throw new Error("Cannot remove an unregistered awareness client");
  }

  let owners = awarenessClientOwners.get(documentId);
  if (!owners) {
    owners = new Map();
    awarenessClientOwners.set(documentId, owners);
  }
  const ownerSocketId = owners.get(clientId);
  if (ownerSocketId && ownerSocketId !== socket.id) {
    throw new Error("Awareness client id is already owned by another socket");
  }

  if (existingBinding) {
    const isStale = rawState === null
      ? clock < existingBinding.clock
      : clock <= existingBinding.clock;
    if (isStale) return null;
    existingBinding.clock = clock;
  } else {
    bindings.set(documentId, { clientId, clock });
    owners.set(clientId, socket.id);
  }

  if (rawState === null) {
    const sanitized = {
      update: encodeAwarenessEntry(clientId, clock, null),
      clientId,
      clock,
      state: null,
      removed: true,
    };
    forgetAwarenessBinding(socket.id, documentId);
    return sanitized;
  }

  const state = {
    ...parsedState,
    user: presenceIdentity(socket),
  };
  return {
    update: encodeAwarenessEntry(clientId, clock, state),
    clientId,
    clock,
    state,
    removed: false,
  };
}

export function createAwarenessManager(): AwarenessManager {
  return {
    initializeSocket(socket) {
      socket.data.awarenessTokens = AWARENESS_BURST_SIZE;
      socket.data.awarenessLastRefill = Date.now();
      socket.data.awarenessViolations = 0;
      socketAwarenessBindings.set(socket.id, new Map());
      return presenceIdentity(socket);
    },

    consumeUpdate(socket, documentId, update) {
      if (!consumeAwarenessToken(socket)) {
        rejectAwarenessUpdate(socket, documentId);
        return null;
      }
      if (!(update instanceof Uint8Array) || update.byteLength > MAX_AWARENESS_UPDATE_BYTES) {
        rejectAwarenessUpdate(socket, documentId);
        return null;
      }

      try {
        const sanitized = sanitizeAwarenessUpdate(socket, documentId, update);
        if (!sanitized) return null;
        if (sanitized.state) {
          let entries = activeAwarenessEntries.get(documentId);
          if (!entries) {
            entries = new Map();
            activeAwarenessEntries.set(documentId, entries);
          }
          entries.set(sanitized.clientId, {
            clock: sanitized.clock,
            state: sanitized.state,
          });
        } else {
          const entries = activeAwarenessEntries.get(documentId);
          entries?.delete(sanitized.clientId);
          if (entries?.size === 0) activeAwarenessEntries.delete(documentId);
        }
        socket.data.awarenessViolations = Math.max(0, socket.data.awarenessViolations - 1);
        return sanitized;
      } catch {
        rejectAwarenessUpdate(socket, documentId);
        return null;
      }
    },

    snapshot(documentId) {
      const entries = activeAwarenessEntries.get(documentId);
      if (!entries?.size) return null;
      return encodeAwarenessEntries(
        Array.from(entries, ([clientId, entry]) => [
          clientId,
          entry.clock,
          entry.state,
        ] as const)
      );
    },

    releaseBinding(socket, documentId) {
      const binding = socketAwarenessBindings.get(socket.id)?.get(documentId);
      if (!binding) return;

      socket.to(`doc:${documentId}`).emit("awareness:update", {
        documentId,
        update: encodeAwarenessEntry(binding.clientId, binding.clock + 1, null),
      });
      forgetAwarenessBinding(socket.id, documentId);
    },

    forgetSocket(socketId) {
      const bindings = socketAwarenessBindings.get(socketId);
      if (!bindings) return;
      for (const documentId of Array.from(bindings.keys())) {
        forgetAwarenessBinding(socketId, documentId);
      }
    },

    forgetDocument(documentId) {
      awarenessClientOwners.delete(documentId);
      activeAwarenessEntries.delete(documentId);
    },
  };
}
