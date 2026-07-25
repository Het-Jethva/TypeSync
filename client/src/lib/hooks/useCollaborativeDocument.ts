import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { getSocket } from "../socket";
import type { PresenceIdentity } from "@typesync/shared";
import { CollaborativeSyncManager, type SyncState } from "../sync-manager";

function isPresenceIdentity(value: unknown): value is PresenceIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PresenceIdentity>;
  return (
    typeof candidate.userId === "string" && candidate.userId.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.color === "string"
  );
}

export function useCollaborativeDocument(
  documentId: string,
  onCollaboratorsChange?: (collaborators: { name: string; color: string }[]) => void,
  onAccessLost?: () => void
) {
  const [syncState, setSyncState] = useState<SyncState>({
    isConnected: false,
    documentSizeStatus: null,
    hasPendingUpdates: false,
    syncError: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  const recover = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);

  const ydoc = useMemo(() => {
    void reloadKey;
    return new Y.Doc({ guid: documentId });
  }, [documentId, reloadKey]);
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
    const resourceVersions = resourceVersionsRef.current;
    const resourceVersion = (resourceVersions.get(ydoc) ?? 0) + 1;
    resourceVersions.set(ydoc, resourceVersion);

    const syncManager = new CollaborativeSyncManager({
      documentId,
      ydoc,
      emitUpdate(docId, update, timeoutMs, callback) {
        socket.timeout(timeoutMs).emit("doc:update", docId, update, callback);
      },
      onAccessLost() {
        onAccessLostRef.current?.();
      },
      onJoinRequired() {
        joinDocument();
      },
    });

    const unsubscribe = syncManager.subscribe(setSyncState);

    const handleUpdate = (payload: { documentId: string; update: Uint8Array }) => {
      if (payload.documentId !== documentId) return;
      Y.applyUpdate(ydoc, new Uint8Array(payload.update), "remote");
    };

    const handleAwarenessUpdate = (payload: { documentId: string; update: Uint8Array }) => {
      if (payload.documentId !== documentId) return;
      try {
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          new Uint8Array(payload.update),
          "remote"
        );
      } catch (error) {
        console.error("Rejected malformed remote awareness update:", error);
      }
    };

    const handlePermissionRevoked = (payload: { documentId: string }) => {
      if (payload.documentId === documentId) {
        syncManager.handleAccessLost();
      }
    };

    const handleDocumentSizeStatus = (payload: any) => {
      if (payload.documentId === documentId) {
        syncManager.setDocumentSizeStatus(payload);
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
        syncManager.handleAccessLost();
      }
    };

    function joinDocument() {
      syncManager.cancelDeliveryAttempt();
      syncManager.setConnected(false);
      socket.emit("doc:join", documentId, (result) => {
        if (!result.success) {
          if (result.error !== "Document join was cancelled") {
            handleDocError({ documentId, message: result.error });
          }
          return;
        }

        Y.applyUpdate(ydoc, new Uint8Array(result.state), "remote");
        awareness.setLocalStateField("user", result.presence);
        syncManager.setConnected(true);

        syncManager.reconcilePendingUpdates(new Uint8Array(result.stateVector));

        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          [awareness.clientID]
        );
        socket.volatile.emit("awareness:update", documentId, awarenessUpdate);
      });
    }

    const handleDisconnect = () => {
      syncManager.cancelDeliveryAttempt();
      syncManager.setConnected(false);
    };

    socket.on("doc:update", handleUpdate);
    socket.on("awareness:update", handleAwarenessUpdate);
    socket.on("doc:permission-revoked", handlePermissionRevoked);
    socket.on("doc:size-status", handleDocumentSizeStatus);
    socket.on("doc:error", handleDocError);
    socket.on("connect", joinDocument);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) {
      joinDocument();
    }

    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin !== "remote") {
        syncManager.enqueueDocumentUpdate(update);
      }
    };
    ydoc.on("update", updateHandler);

    const awarenessUpdateHandler = ({ added, updated, removed }: any, origin: any) => {
      if (origin !== "remote" && syncState.isConnected && socket.connected) {
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
      const seenUserIds = new Set<string>();
      const activeUsers: { name: string; color: string }[] = [];
      for (const state of states.values()) {
        const user = (state as { user?: unknown }).user;
        if (!isPresenceIdentity(user) || seenUserIds.has(user.userId)) continue;
        seenUserIds.add(user.userId);
        activeUsers.push({ name: user.name, color: user.color });
      }
      onCollaboratorsChangeRef.current?.(activeUsers);
    };
    awareness.on("change", handleAwarenessChange);

    return () => {
      syncManager.destroy();
      unsubscribe();
      if (syncState.isConnected && socket.connected) {
        awareness.setLocalState(null);
      }
      socket.off("doc:update", handleUpdate);
      socket.off("awareness:update", handleAwarenessUpdate);
      socket.off("doc:permission-revoked", handlePermissionRevoked);
      socket.off("doc:size-status", handleDocumentSizeStatus);
      socket.off("doc:error", handleDocError);
      socket.off("connect", joinDocument);
      socket.off("disconnect", handleDisconnect);
      ydoc.off("update", updateHandler);
      awareness.off("update", awarenessUpdateHandler);
      awareness.off("change", handleAwarenessChange);
      if (socket.connected) {
        socket.emit("doc:leave", documentId);
      }

      queueMicrotask(() => {
        if (resourceVersions.get(ydoc) === resourceVersion) {
          resourceVersions.delete(ydoc);
          awareness.destroy();
          ydoc.destroy();
        }
      });
    };
  }, [documentId, ydoc, awareness]);

  return {
    ydoc,
    awareness,
    isConnected: syncState.isConnected,
    documentSizeStatus: syncState.documentSizeStatus,
    hasPendingUpdates: syncState.hasPendingUpdates,
    syncError: syncState.syncError,
    recover,
  };
}
