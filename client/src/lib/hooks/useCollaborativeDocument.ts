import { useEffect, useMemo, useState, useRef } from "react";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { getSocket } from "../socket";

export function useCollaborativeDocument(
  documentId: string,
  onCollaboratorsChange?: (collaborators: { name: string; color: string }[]) => void
) {
  const [isConnected, setIsConnected] = useState(false);
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);
  const awareness = useMemo(() => new awarenessProtocol.Awareness(ydoc), [ydoc]);

  const onCollaboratorsChangeRef = useRef(onCollaboratorsChange);
  useEffect(() => {
    onCollaboratorsChangeRef.current = onCollaboratorsChange;
  }, [onCollaboratorsChange]);

  useEffect(() => {
    const socket = getSocket();

    const handleSync = (state: Uint8Array) => {
      Y.applyUpdate(ydoc, new Uint8Array(state));
      setIsConnected(true);
    };

    const handleUpdate = (update: Uint8Array) => {
      Y.applyUpdate(ydoc, new Uint8Array(update));
    };

    const handleAwarenessUpdate = (update: Uint8Array) => {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        new Uint8Array(update),
        "remote"
      );
    };

    socket.on("doc:sync", handleSync);
    socket.on("doc:update", handleUpdate);
    socket.on("awareness:update", handleAwarenessUpdate);

    // Join the document room
    socket.emit("doc:join", documentId);

    // Listen for local changes and broadcast
    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin !== "remote") {
        socket.emit("doc:update", documentId, update);
      }
    };
    ydoc.on("update", updateHandler);

    // Listen for local awareness changes and broadcast
    const awarenessUpdateHandler = ({ added, updated, removed }: any, origin: any) => {
      if (origin !== "remote") {
        const changedClients = added.concat(updated).concat(removed);
        const update = awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          changedClients
        );
        socket.emit("awareness:update", documentId, update);
      }
    };
    awareness.on("update", awarenessUpdateHandler);

    const handleAwarenessChange = () => {
      const states = awareness.getStates();
      const activeUsers = Array.from(states.values())
        .map((state: any) => state.user)
        .filter(Boolean);
      onCollaboratorsChangeRef.current?.(activeUsers);
    };
    awareness.on("change", handleAwarenessChange);

    return () => {
      socket.off("doc:sync", handleSync);
      socket.off("doc:update", handleUpdate);
      socket.off("awareness:update", handleAwarenessUpdate);
      ydoc.off("update", updateHandler);
      awareness.off("update", awarenessUpdateHandler);
      awareness.off("change", handleAwarenessChange);
      socket.emit("doc:leave", documentId);
      ydoc.destroy();
      awareness.destroy();
    };
  }, [documentId, ydoc, awareness]);

  return { ydoc, awareness, isConnected };
}
