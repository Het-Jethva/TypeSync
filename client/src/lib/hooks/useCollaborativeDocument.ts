import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { getSocket } from "../socket";
import type {
  DocumentSizeStatus,
  PresenceIdentity,
  Role,
  ServerToClientEvents,
} from "@typesync/shared";
import { CollaborativeSyncManager, type SyncState } from "../sync-manager";
import { joinFailureAction } from "../join-failure";
import { presenceIdentityFromAwareness } from "../presence";

export function useCollaborativeDocument(
  documentId: string,
  onCollaboratorsChange?: (collaborators: PresenceIdentity[]) => void,
  onAccessLost?: () => void
) {
  const [syncState, setSyncState] = useState<SyncState>({
    documentSizeStatus: null,
    hasPendingUpdates: false,
    syncStatus: "offline",
    syncError: null,
    isSyncBlocked: false,
    retrying: false,
    awaitingPersistence: false,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [sessionRole, setSessionRole] = useState<Role | null>(null);

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
    setSessionRole(null);
    const resourceVersions = resourceVersionsRef.current;
    const resourceVersion = (resourceVersions.get(ydoc) ?? 0) + 1;
    resourceVersions.set(ydoc, resourceVersion);

    const syncManager = new CollaborativeSyncManager({
      documentId,
      emitUpdate(docId, update, timeoutMs, callback) {
        socket.timeout(timeoutMs).emit("doc:update", docId, update, callback);
      },
      emitAwareness(docId, update) {
        socket.volatile.emit("awareness:update", docId, update);
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
        setSessionRole(null);
        syncManager.handleAccessLost();
      }
    };

    const handlePermissionUpdated = (payload: { documentId: string; role: Role }) => {
      if (payload.documentId !== documentId) return;
      setSessionRole(payload.role);
      syncManager.setDocumentRole(payload.role);
      const current = awareness.getLocalState();
      const user = presenceIdentityFromAwareness(
        current && typeof current === "object" ? current.user : undefined
      );
      if (!user) return;
      awareness.setLocalStateField("user", { ...user, role: payload.role });
    };

    const handleDocumentSizeStatus = (payload: DocumentSizeStatus) => {
      if (payload.documentId === documentId) {
        syncManager.setDocumentSizeStatus(payload);
      }
    };

    const handleDocSaved: ServerToClientEvents["doc:saved"] = (payload) => {
      if (payload.documentId !== documentId) return;
      syncManager.notePersisted(payload.epoch, payload.revision);
    };

    let joinRetryAttempt = 0;
    let joinRetryTimer: number | undefined;
    let active = true;
    let joinGeneration = 0;

    const clearJoinRetry = () => {
      if (joinRetryTimer !== undefined) window.clearTimeout(joinRetryTimer);
      joinRetryTimer = undefined;
    };

    const scheduleJoinRetry = () => {
      const delay = Math.min(1_000 * 2 ** joinRetryAttempt, 10_000);
      joinRetryAttempt += 1;
      clearJoinRetry();
      joinRetryTimer = window.setTimeout(() => {
        joinRetryTimer = undefined;
        joinDocument();
      }, delay);
    };

    const handleDocError = (payload: { documentId?: string; message: string }) => {
      if (payload.documentId && payload.documentId !== documentId) return;
      console.error(`Socket document error: ${payload.message}`);
    };

    function joinDocument() {
      if (!active || !socket.connected) return;
      const generation = ++joinGeneration;
      clearJoinRetry();
      syncManager.cancelDeliveryAttempt();
      syncManager.setConnected(false);
      socket.timeout(10_000).emit("doc:join", documentId, (error, result) => {
        if (!active || generation !== joinGeneration) return;
        if (error) {
          scheduleJoinRetry();
          return;
        }
        if (!result.success) {
          const action = joinFailureAction(result.code);
          if (action === "access-lost") syncManager.handleAccessLost();
          if (action === "retry") scheduleJoinRetry();
          if (action === "stop") {
            syncManager.setConnected(false, { syncError: result.error });
          }
          return;
        }

        joinRetryAttempt = 0;
        syncManager.setDocumentSizeStatus(null);
        setSessionRole(result.role);
        Y.applyUpdate(ydoc, new Uint8Array(result.state), "remote");
        awareness.setLocalStateField("user", {
          ...result.presence,
          role: result.role,
        });
        syncManager.noteServerPersistence(result.epoch, result.persistedRevision);
        syncManager.setConnected(true);
        syncManager.setDocumentRole(result.role, { flush: false });
        syncManager.reconcilePendingUpdates(ydoc, new Uint8Array(result.state));

        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          [awareness.clientID]
        );
        syncManager.sendAwareness(awarenessUpdate);
      });
    }

    const handleDisconnect = () => {
      joinGeneration += 1;
      clearJoinRetry();
      joinRetryAttempt = 0;
      syncManager.cancelDeliveryAttempt();
      syncManager.setConnected(false);
    };

    socket.on("doc:update", handleUpdate);
    socket.on("awareness:update", handleAwarenessUpdate);
    socket.on("doc:permission-revoked", handlePermissionRevoked);
    socket.on("doc:permission-updated", handlePermissionUpdated);
    socket.on("doc:size-status", handleDocumentSizeStatus);
    socket.on("doc:saved", handleDocSaved);
    socket.on("doc:error", handleDocError);
    socket.on("connect", joinDocument);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) {
      joinDocument();
    }

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") {
        syncManager.enqueueDocumentUpdate(update);
      }
    };
    ydoc.on("update", updateHandler);

    const pendingAwarenessClients = new Set<number>();
    let awarenessFrame: number | null = null;

    const flushAwarenessUpdate = () => {
      awarenessFrame = null;
      const sendLocalClient = pendingAwarenessClients.has(awareness.clientID);
      pendingAwarenessClients.clear();
      if (!sendLocalClient) return;

      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [
        awareness.clientID,
      ]);
      syncManager.sendAwareness(update);
    };

    const awarenessUpdateHandler = (
      change: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      const { added, updated, removed } = change;
      if (origin === "remote") return;
      const changedClients = added.concat(updated).concat(removed);
      if (!changedClients.includes(awareness.clientID)) return;
      pendingAwarenessClients.add(awareness.clientID);
      awarenessFrame ??= window.requestAnimationFrame(flushAwarenessUpdate);
    };
    awareness.on("update", awarenessUpdateHandler);

    const handleAwarenessChange = () => {
      const states = awareness.getStates();
      const seenUserIds = new Set<string>();
      const activeUsers: PresenceIdentity[] = [];
      for (const state of states.values()) {
        const user = presenceIdentityFromAwareness(
          state && typeof state === "object" ? state.user : undefined
        );
        if (!user || seenUserIds.has(user.userId)) continue;
        seenUserIds.add(user.userId);
        activeUsers.push(user);
      }
      onCollaboratorsChangeRef.current?.(activeUsers);
    };
    awareness.on("change", handleAwarenessChange);

    return () => {
      active = false;
      joinGeneration += 1;
      syncManager.destroy();
      unsubscribe();
      socket.off("doc:update", handleUpdate);
      socket.off("awareness:update", handleAwarenessUpdate);
      socket.off("doc:permission-revoked", handlePermissionRevoked);
      socket.off("doc:permission-updated", handlePermissionUpdated);
      socket.off("doc:size-status", handleDocumentSizeStatus);
      socket.off("doc:saved", handleDocSaved);
      socket.off("doc:error", handleDocError);
      socket.off("connect", joinDocument);
      socket.off("disconnect", handleDisconnect);
      ydoc.off("update", updateHandler);
      awareness.off("update", awarenessUpdateHandler);
      awareness.off("change", handleAwarenessChange);
      if (awarenessFrame !== null) {
        window.cancelAnimationFrame(awarenessFrame);
      }
      clearJoinRetry();
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
    documentSizeStatus: syncState.documentSizeStatus,
    hasPendingUpdates: syncState.hasPendingUpdates,
    awaitingPersistence: syncState.awaitingPersistence,
    syncStatus: syncState.syncStatus,
    syncError: syncState.syncError,
    isSyncBlocked: syncState.isSyncBlocked,
    retrying: syncState.retrying,
    sessionRole,
    recover,
  };
}
