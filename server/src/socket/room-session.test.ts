import { describe, expect, it } from "vitest";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import { CollaborativeRoomSession } from "./room-session.js";
import type { DocumentStateRepository } from "./repository.js";
import type { TypeSyncSocket } from "./types.js";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

class MemoryDocumentStateRepository implements DocumentStateRepository {
  readonly states = new Map<string, Uint8Array>();
  saveDelayMs = 0;

  async loadState(documentId: string): Promise<Uint8Array | null> {
    return this.states.get(documentId) ?? null;
  }

  async saveState(documentId: string, state: Uint8Array): Promise<Date> {
    if (this.saveDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.saveDelayMs));
    }
    this.states.set(documentId, state);
    return new Date();
  }
}

function encodeAwarenessFrame(
  clientId: number,
  clock: number,
  state: Record<string, unknown> | null
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint(encoder, clientId);
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarString(encoder, JSON.stringify(state));
  return encoding.toUint8Array(encoder);
}

function createFakeSocket(params: {
  id: string;
  userId: string;
  name?: string;
}): TypeSyncSocket {
  const rooms = new Set<string>();
  const socket = {
    id: params.id,
    connected: true,
    rooms,
    data: {
      userId: params.userId,
      userName: params.name ?? params.userId,
      userEmail: `${params.userId}@example.com`,
      authCookie: "",
      sessionId: `session-${params.id}`,
      lastSessionValidation: Date.now(),
      awarenessTokens: 0,
      awarenessLastRefill: 0,
      awarenessViolations: 0,
    },
    join(room: string) {
      rooms.add(room);
    },
    leave(room: string) {
      rooms.delete(room);
    },
    emit() {
      return true;
    },
    to() {
      return {
        emit() {
          return true;
        },
      };
    },
    disconnect() {
      socket.connected = false;
    },
  };
  return socket as unknown as TypeSyncSocket;
}

function occupancyFrom(sockets: TypeSyncSocket[]) {
  return (documentId: string) =>
    sockets.filter(
      (socket) => socket.connected && socket.rooms.has(`doc:${documentId}`)
    ).length;
}

describe("CollaborativeRoomSession", () => {
  it("keeps a reconnecting join from racing the last occupant's eviction flush", async () => {
    const repository = new MemoryDocumentStateRepository();
    repository.saveDelayMs = 40;
    const sockets: TypeSyncSocket[] = [];
    const session = new CollaborativeRoomSession({
      repository,
      getRoomOccupancy: occupancyFrom(sockets),
    });

    const first = createFakeSocket({ id: "s1", userId: "user-1" });
    sockets.push(first);
    session.initializeSocket(first);
    const joined = await session.joinSession({
      socket: first,
      documentId: DOCUMENT_ID,
      authorize: async () => ({ hasAccess: true, role: "owner" }),
    });
    expect(joined.success).toBe(true);
    expect(joined.success && joined.presence.role).toBe("owner");

    first.connected = false;
    const disconnecting = session.handleDisconnect(first);

    const second = createFakeSocket({ id: "s2", userId: "user-1" });
    sockets.push(second);
    session.initializeSocket(second);
    const rejoining = session.joinSession({
      socket: second,
      documentId: DOCUMENT_ID,
      authorize: async () => ({ hasAccess: true, role: "owner" }),
    });

    const [, rejoin] = await Promise.all([disconnecting, rejoining]);
    expect(rejoin.success).toBe(true);

    const update = session.applyUpdate({
      socket: second,
      documentId: DOCUMENT_ID,
      update: Y.encodeStateAsUpdate(new Y.Doc()),
    });
    expect(update.success).toBe(true);
  });

  it("does not disconnect a socket for awareness rate limits", async () => {
    const sockets: TypeSyncSocket[] = [];
    const session = new CollaborativeRoomSession({
      repository: new MemoryDocumentStateRepository(),
      getRoomOccupancy: occupancyFrom(sockets),
    });
    const socket = createFakeSocket({ id: "s1", userId: "user-1" });
    sockets.push(socket);
    session.initializeSocket(socket);

    let disconnected = false;
    socket.disconnect = () => {
      disconnected = true;
      socket.connected = false;
    };

    const joined = await session.joinSession({
      socket,
      documentId: DOCUMENT_ID,
      authorize: async () => ({ hasAccess: true, role: "owner" }),
    });
    expect(joined.success).toBe(true);

    for (let clock = 1; clock <= 80; clock += 1) {
      session.applyAwareness({
        socket,
        documentId: DOCUMENT_ID,
        update: encodeAwarenessFrame(1, clock, { cursor: null }),
      });
    }
    expect(disconnected).toBe(false);
    expect(socket.data.awarenessViolations).toBe(0);
  });

  it("rejects document updates from viewers", async () => {
    const sockets: TypeSyncSocket[] = [];
    const session = new CollaborativeRoomSession({
      repository: new MemoryDocumentStateRepository(),
      getRoomOccupancy: occupancyFrom(sockets),
    });
    const socket = createFakeSocket({ id: "s1", userId: "user-2" });
    sockets.push(socket);
    session.initializeSocket(socket);
    await session.joinSession({
      socket,
      documentId: DOCUMENT_ID,
      authorize: async () => ({ hasAccess: true, role: "viewer" }),
    });

    const result = session.applyUpdate({
      socket,
      documentId: DOCUMENT_ID,
      update: Y.encodeStateAsUpdate(new Y.Doc()),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("forbidden");
  });

  it("isolates Y.Doc state across CollaborativeRoomSession instances", async () => {
    const firstSockets: TypeSyncSocket[] = [];
    const secondSockets: TypeSyncSocket[] = [];
    const first = new CollaborativeRoomSession({
      repository: new MemoryDocumentStateRepository(),
      getRoomOccupancy: occupancyFrom(firstSockets),
    });
    const second = new CollaborativeRoomSession({
      repository: new MemoryDocumentStateRepository(),
      getRoomOccupancy: occupancyFrom(secondSockets),
    });

    const socketA = createFakeSocket({ id: "a", userId: "user-a" });
    const socketB = createFakeSocket({ id: "b", userId: "user-b" });
    firstSockets.push(socketA);
    secondSockets.push(socketB);
    first.initializeSocket(socketA);
    second.initializeSocket(socketB);

    await first.joinSession({
      socket: socketA,
      documentId: DOCUMENT_ID,
      authorize: async () => ({ hasAccess: true, role: "owner" }),
    });
    await second.joinSession({
      socket: socketB,
      documentId: DOCUMENT_ID,
      authorize: async () => ({ hasAccess: true, role: "owner" }),
    });

    const local = new Y.Doc();
    local.getText("t").insert(0, "only-in-first");
    expect(
      first.applyUpdate({
        socket: socketA,
        documentId: DOCUMENT_ID,
        update: Y.encodeStateAsUpdate(local),
      }).success
    ).toBe(true);

    const snapshot = await second.joinSession({
      socket: socketB,
      documentId: DOCUMENT_ID,
      authorize: async () => ({ hasAccess: true, role: "owner" }),
    });
    expect(snapshot.success).toBe(true);
    if (snapshot.success) {
      const remote = new Y.Doc();
      Y.applyUpdate(remote, snapshot.state);
      expect(remote.getText("t").toString()).not.toContain("only-in-first");
    }
  });
});
