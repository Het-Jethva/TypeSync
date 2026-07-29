import type { DocumentSizeStatus } from "@typesync/shared";
import type { SyncStatus } from "./sync-manager";

/**
 * Everything the interface needs to say about whether the open document is
 * safe. Published by the editor and reported in one place, so the title and
 * the content are never described in two different vocabularies.
 */
export interface DocumentStatus {
  syncStatus: SyncStatus;
  hasPendingUpdates: boolean;
  documentSizeStatus: DocumentSizeStatus | null;
  syncError: string | null;
  isSyncBlocked: boolean;
  /** Discards unsynced edits and reloads the server's version. */
  recover: () => void;
}
