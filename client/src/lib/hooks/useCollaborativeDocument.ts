import { useEffect, useMemo, useState, useRef } from "react";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { getSocket } from "../socket";

export function useCollaborativeDocument(
  documentId: string,
  onCollaboratorsChange?: (collaborators: { name: string; color: string }[]) => void,
  onAccessLost?: () => void
) {
  const [isConnected, setIsConnected] = useState(false);
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);
  const awareness = useMemo(() => new awarenessProtocol.Awareness(ydoc), [ydoc]);

  const onCollaboratorsChangeRef = useRef(onCollaboratorsChange);
  useEffect(() => {
    onCollaboratorsChangeRef.current = onCollaboratorsChange;
  }, [onCollaboratorsChange]);

  const onAccessLostRef = useRef(onAccessLost);
  useEffect(() => {
    onAccessLostRef.current = onAccessLost;
  }, [onAccessLost]);

  useEffect(() => {
    const socket = getSocket();

    const handleSync = (state: Uint8Array) => {
      Y.applyUpdate(ydoc, new Uint8Array(state), "remote");
      setIsConnected(true);
    };

    const handleUpdate = (update: Uint8Array) => {
      Y.applyUpdate(ydoc, new Uint8Array(update), "remote");
    };

    const handleAwarenessUpdate = (update: Uint8Array) => {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        new Uint8Array(update),
        "remote"
      );
    };

    const handlePermissionRevoked = (payload: { documentId: string }) => {
      if (payload.documentId === documentId) {
        setIsConnected(false);
        onAccessLostRef.current?.();
      }
    };

    const handleDocError = (message: string) => {
      console.error(`Socket document error: ${message}`);
      if (message === "Access denied" || message === "Failed to load document") {
        setIsConnected(false);
        onAccessLostRef.current?.();
      }
    };

    const handleConnect = () => {
      socket.emit("doc:join", documentId);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    socket.on("doc:sync", handleSync);
    socket.on("doc:update", handleUpdate);
    socket.on("awareness:update", handleAwarenessUpdate);
    socket.on("doc:permission-revoked", handlePermissionRevoked);
    socket.on("doc:error", handleDocError);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    // Join the document room if socket is already connected
    if (socket.connected) {
      handleConnect();
    }

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
      socket.off("doc:permission-revoked", handlePermissionRevoked);
      socket.off("doc:error", handleDocError);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      ydoc.off("update", updateHandler);
      awareness.off("update", awarenessUpdateHandler);
      awareness.off("change", handleAwarenessChange);
      if (socket.connected) {
        socket.emit("doc:leave", documentId);
      }
      ydoc.destroy();
      awareness.destroy();
    };
  }, [documentId, ydoc, awareness]);

  return { ydoc, awareness, isConnected };
}
