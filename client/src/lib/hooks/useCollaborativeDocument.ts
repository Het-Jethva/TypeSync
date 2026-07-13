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
  const resourceVersionsRef = useRef(new Map<Y.Doc, number>());

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
    let joined = false;
    let disposed = false;
    const resourceVersion = (resourceVersionsRef.current.get(ydoc) ?? 0) + 1;
    resourceVersionsRef.current.set(ydoc, resourceVersion);

    const handleUpdate = (payload: { documentId: string; update: Uint8Array }) => {
      if (payload.documentId !== documentId) return;
      Y.applyUpdate(ydoc, new Uint8Array(payload.update), "remote");
    };

    const handleAwarenessUpdate = (payload: { documentId: string; update: Uint8Array }) => {
      if (payload.documentId !== documentId) return;
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        new Uint8Array(payload.update),
        "remote"
      );
    };

    const handlePermissionRevoked = (payload: { documentId: string }) => {
      if (payload.documentId === documentId) {
        setIsConnected(false);
        onAccessLostRef.current?.();
      }
    };

    const handleDocError = (payload: { documentId?: string; message: string }) => {
      if (payload.documentId && payload.documentId !== documentId) return;
      const { message } = payload;
      console.error(`Socket document error: ${message}`);
      if (
        message === "Access denied" ||
        message === "Failed to load document" ||
        message === "Session expired"
      ) {
        setIsConnected(false);
        onAccessLostRef.current?.();
      }
    };

    const joinDocument = () => {
      joined = false;
      setIsConnected(false);
      socket.emit("doc:join", documentId, (result) => {
        if (disposed) return;
        if (!result.success) {
          if (result.error !== "Document join was cancelled") {
            handleDocError({ documentId, message: result.error });
          }
          return;
        }

        Y.applyUpdate(ydoc, new Uint8Array(result.state), "remote");
        joined = true;
        setIsConnected(true);

        // Reconcile edits made before the join completed or while offline.
        const localDelta = Y.encodeStateAsUpdate(ydoc, new Uint8Array(result.stateVector));
        if (localDelta.byteLength > 2) {
          socket.volatile.emit("doc:update", documentId, localDelta);
        }

        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          [awareness.clientID]
        );
        socket.volatile.emit("awareness:update", documentId, awarenessUpdate);
      });
    };

    const handleDisconnect = () => {
      joined = false;
      setIsConnected(false);
    };

    socket.on("doc:update", handleUpdate);
    socket.on("awareness:update", handleAwarenessUpdate);
    socket.on("doc:permission-revoked", handlePermissionRevoked);
    socket.on("doc:error", handleDocError);
    socket.on("connect", joinDocument);
    socket.on("disconnect", handleDisconnect);

    // Join the document room if socket is already connected
    if (socket.connected) {
      joinDocument();
    }

    // Listen for local changes and broadcast
    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin !== "remote" && joined && socket.connected) {
        socket.volatile.emit("doc:update", documentId, update);
      }
    };
    ydoc.on("update", updateHandler);

    // Listen for local awareness changes and broadcast
    const awarenessUpdateHandler = ({ added, updated, removed }: any, origin: any) => {
      if (origin !== "remote" && joined && socket.connected) {
        const changedClients = added.concat(updated).concat(removed);
        const update = awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          changedClients
        );
        socket.volatile.emit("awareness:update", documentId, update);
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
      disposed = true;
      if (joined && socket.connected) {
        // Destroying Awareness emits a local-state removal. Forward that frame
        // before detaching the handler and leaving the room.
        awareness.setLocalState(null);
      }
      socket.off("doc:update", handleUpdate);
      socket.off("awareness:update", handleAwarenessUpdate);
      socket.off("doc:permission-revoked", handlePermissionRevoked);
      socket.off("doc:error", handleDocError);
      socket.off("connect", joinDocument);
      socket.off("disconnect", handleDisconnect);
      ydoc.off("update", updateHandler);
      awareness.off("update", awarenessUpdateHandler);
      awareness.off("change", handleAwarenessChange);
      if (socket.connected) {
        socket.emit("doc:leave", documentId);
      }
      joined = false;

      // StrictMode immediately replays effects with the same memoized Y.Doc.
      // Defer irreversible cleanup and skip it when a newer setup owns it.
      queueMicrotask(() => {
        if (resourceVersionsRef.current.get(ydoc) === resourceVersion) {
          resourceVersionsRef.current.delete(ydoc);
          awareness.destroy();
          ydoc.destroy();
        }
      });
    };
  }, [documentId, ydoc, awareness]);

  return { ydoc, awareness, isConnected };
}
