import { useEffect, useMemo, useState, useRef } from "react";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { getSocket } from "../socket";
import type { DocumentSizeStatus, PresenceIdentity } from "@typesync/shared";

const DOCUMENT_UPDATE_ACK_TIMEOUT_MS = 5_000;
const MAX_MERGED_UPDATE_BYTES = 512 * 1024;
const MAX_RETRY_DELAY_MS = 10_000;

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
  const [isConnected, setIsConnected] = useState(false);
  const [documentSizeStatus, setDocumentSizeStatus] = useState<DocumentSizeStatus | null>(null);
  const [hasPendingUpdates, setHasPendingUpdates] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const ydoc = useMemo(() => new Y.Doc({ guid: documentId }), [documentId]);
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
    let joined = false;
    let disposed = false;
    let nextBatchId = 1;
    let activeBatchId: number | null = null;
    let deliveryGeneration = 0;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let deliveryBlocked = false;
    let pendingBatches: { id: number; update: Uint8Array }[] = [];
    setDocumentSizeStatus(null);
    setHasPendingUpdates(false);
    setSyncError(null);
    const resourceVersion = (resourceVersions.get(ydoc) ?? 0) + 1;
    resourceVersions.set(ydoc, resourceVersion);

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
        setIsConnected(false);
        onAccessLostRef.current?.();
      }
    };

    const handleDocumentSizeStatus = (payload: DocumentSizeStatus) => {
      if (payload.documentId === documentId) {
        setDocumentSizeStatus(payload);
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

    function clearRetryTimer() {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    function cancelDeliveryAttempt() {
      deliveryGeneration += 1;
      activeBatchId = null;
      clearRetryTimer();
    }

    function refreshPendingState() {
      if (!disposed) setHasPendingUpdates(pendingBatches.length > 0);
    }

    function scheduleRetry() {
      if (disposed || retryTimer || !joined || !socket.connected || deliveryBlocked) return;
      const delay = Math.min(1_000 * 2 ** retryAttempt, MAX_RETRY_DELAY_MS);
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        flushPendingUpdates();
      }, delay);
    }

    function flushPendingUpdates() {
      if (
        disposed ||
        !joined ||
        !socket.connected ||
        deliveryBlocked ||
        activeBatchId !== null ||
        pendingBatches.length === 0
      ) {
        return;
      }

      const batch = pendingBatches[0];
      activeBatchId = batch.id;
      const generation = ++deliveryGeneration;

      socket.timeout(DOCUMENT_UPDATE_ACK_TIMEOUT_MS).emit(
        "doc:update",
        documentId,
        batch.update,
        (error, result) => {
          if (
            disposed ||
            generation !== deliveryGeneration ||
            activeBatchId !== batch.id
          ) {
            return;
          }

          activeBatchId = null;
          if (error) {
            scheduleRetry();
            return;
          }

          if (!result.success) {
            if (
              result.code === "server-draining" ||
              result.code === "rate-limited"
            ) {
              scheduleRetry();
              return;
            }
            if (
              result.code === "not-joined" ||
              result.code === "document-not-loaded"
            ) {
              joinDocument();
              return;
            }

            deliveryBlocked = true;
            setSyncError(result.error);
            refreshPendingState();
            return;
          }

          pendingBatches.shift();
          retryAttempt = 0;
          setSyncError(null);
          refreshPendingState();
          flushPendingUpdates();
        }
      );
    }

    function enqueueDocumentUpdate(update: Uint8Array) {
      const mergeableIndex = activeBatchId === null ? 0 : 1;
      const lastBatch = pendingBatches.at(-1);
      if (lastBatch && pendingBatches.length > mergeableIndex) {
        const merged = Y.mergeUpdates([lastBatch.update, update]);
        if (merged.byteLength <= MAX_MERGED_UPDATE_BYTES) {
          lastBatch.update = merged;
          refreshPendingState();
          flushPendingUpdates();
          return;
        }
      }

      pendingBatches.push({ id: nextBatchId++, update });
      refreshPendingState();
      flushPendingUpdates();
    }

    function reconcilePendingUpdates(serverStateVector: Uint8Array) {
      cancelDeliveryAttempt();
      deliveryBlocked = false;
      retryAttempt = 0;
      setSyncError(null);
      pendingBatches = [];

      const localDelta = Y.encodeStateAsUpdate(ydoc, serverStateVector);
      if (localDelta.byteLength > 2) {
        pendingBatches.push({ id: nextBatchId++, update: localDelta });
      }
      refreshPendingState();
      flushPendingUpdates();
    }

    function joinDocument() {
      cancelDeliveryAttempt();
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
        awareness.setLocalStateField("user", result.presence);
        joined = true;
        setIsConnected(true);

        // Reconcile edits made before the join completed or while offline.
        reconcilePendingUpdates(new Uint8Array(result.stateVector));

        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          [awareness.clientID]
        );
        socket.volatile.emit("awareness:update", documentId, awarenessUpdate);
      });
    }

    const handleDisconnect = () => {
      cancelDeliveryAttempt();
      joined = false;
      setIsConnected(false);
    };

    socket.on("doc:update", handleUpdate);
    socket.on("awareness:update", handleAwarenessUpdate);
    socket.on("doc:permission-revoked", handlePermissionRevoked);
    socket.on("doc:size-status", handleDocumentSizeStatus);
    socket.on("doc:error", handleDocError);
    socket.on("connect", joinDocument);
    socket.on("disconnect", handleDisconnect);

    // Join the document room if socket is already connected
    if (socket.connected) {
      joinDocument();
    }

    // Listen for local changes and broadcast
    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin !== "remote") {
        // Keep offline edits pending in memory so closing the page can be
        // guarded. A successful rejoin reconciles this queue against the
        // server state vector before delivery resumes.
        enqueueDocumentUpdate(update);
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
      disposed = true;
      cancelDeliveryAttempt();
      if (joined && socket.connected) {
        // Destroying Awareness emits a local-state removal. Forward that frame
        // before detaching the handler and leaving the room.
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
      joined = false;

      // StrictMode immediately replays effects with the same memoized Y.Doc.
      // Defer irreversible cleanup and skip it when a newer setup owns it.
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
    isConnected,
    documentSizeStatus,
    hasPendingUpdates,
    syncError,
  };
}
