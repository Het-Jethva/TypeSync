import type { DocumentSizeStatus } from "@typesync/shared";
import type { SyncStatus } from "./sync-manager";

/**
 * Everything the interface needs to say about whether the open document is
 * safe. "Synced" means the edit was written to PostgreSQL, not merely
 * accepted into server memory. Published by the editor and reported in one
 * place, so the title and the content are never described in two different
 * vocabularies.
 */
export interface DocumentStatus {
  syncStatus: SyncStatus;
  hasPendingUpdates: boolean;
  awaitingPersistence: boolean;
  documentSizeStatus: DocumentSizeStatus | null;
  syncError: string | null;
  isSyncBlocked: boolean;
  retrying: boolean;
  /** Discards unsynced edits and reloads the server's version. */
  recover: () => void;
}

export type DocumentStatusTone = "ok" | "busy" | "warning" | "error";

export function describeDocumentStatus(
  status: DocumentStatus | null,
  isRenaming: boolean
): { tone: DocumentStatusTone; label: string; detail?: string } {
  if (!status) {
    return isRenaming
      ? { tone: "busy", label: "Saving" }
      : { tone: "ok", label: "Synced" };
  }

  const {
    syncStatus,
    hasPendingUpdates,
    awaitingPersistence,
    documentSizeStatus,
    syncError,
    isSyncBlocked,
    retrying,
  } = status;

  if (syncStatus === "failed") {
    if (isSyncBlocked) {
      return {
        tone: "error",
        label: "Sync blocked",
        detail: syncError ?? "Changes are still pending.",
      };
    }
    return {
      tone: "error",
      label: "Sync failed",
      detail: retrying ? "Retrying…" : (syncError ?? "Changes are still pending."),
    };
  }

  if (documentSizeStatus?.level === "limit") {
    return {
      tone: "error",
      label:
        documentSizeStatus.reason === "update"
          ? "Edit too large"
          : "Size limit reached",
    };
  }

  if (syncStatus === "offline") {
    return {
      tone: "warning",
      label: hasPendingUpdates ? "Offline, changes pending" : "Offline",
      detail: syncError ?? undefined,
    };
  }

  if (syncStatus === "syncing" || hasPendingUpdates || awaitingPersistence || isRenaming) {
    return { tone: "busy", label: "Saving" };
  }

  if (documentSizeStatus?.level === "warning") {
    return { tone: "warning", label: "Nearing size limit" };
  }

  return { tone: "ok", label: "Synced" };
}
