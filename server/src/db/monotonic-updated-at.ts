import { eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { document } from "./schema.js";

export type DocumentDatabase = NodePgDatabase<typeof import("./schema.js")>;

export const documentMetadata = {
  id: document.id,
  title: document.title,
  ownerId: document.ownerId,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
} as const;

// clock_timestamp() moves during a transaction; now() is frozen at the start.
// GREATEST against the stored column stays monotonic under READ COMMITTED.
export function monotonicUpdatedAt(): SQL<Date> {
  return sql<Date>`GREATEST(${document.updatedAt}, clock_timestamp())`;
}

export function saveDocumentStateQuery(
  database: DocumentDatabase,
  documentId: string,
  state: Uint8Array,
) {
  return database
    .update(document)
    .set({ yDocState: Buffer.from(state), updatedAt: monotonicUpdatedAt() })
    .where(eq(document.id, documentId))
    .returning({ updatedAt: document.updatedAt });
}

export function updateDocumentTitleQuery(
  database: DocumentDatabase,
  documentId: string,
  title: string,
) {
  return database
    .update(document)
    .set({ title, updatedAt: monotonicUpdatedAt() })
    .where(eq(document.id, documentId))
    .returning(documentMetadata);
}
