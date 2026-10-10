import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { saveDocumentStateQuery } from "../db/monotonic-updated-at.js";
import { document } from "../db/schema.js";

export type SavedDocumentMetadata = Pick<typeof document.$inferSelect, "title" | "updatedAt">;

export interface DocumentStateRepository {
  loadState(documentId: string): Promise<Uint8Array | null>;
  saveState(documentId: string, state: Uint8Array): Promise<SavedDocumentMetadata | null>;
  loadAiSuggestions?(documentId: string): Promise<unknown>;
  saveAiSuggestions?(documentId: string, entries: unknown): Promise<void>;
}

export class DrizzleDocumentStateRepository implements DocumentStateRepository {
  async loadAiSuggestions(documentId: string): Promise<unknown> {
    const [row] = await db.select({ entries: document.aiSuggestions }).from(document).where(eq(document.id, documentId));
    if (!row) throw new Error("Document no longer exists");
    return row.entries;
  }

  async saveAiSuggestions(documentId: string, entries: unknown): Promise<void> {
    const rows = await db.update(document).set({ aiSuggestions: entries }).where(eq(document.id, documentId)).returning({ id: document.id });
    if (!rows.length) throw new Error("Document no longer exists");
  }
  async loadState(documentId: string): Promise<Uint8Array | null> {
    const [doc] = await db
      .select({ yDocState: document.yDocState })
      .from(document)
      .where(eq(document.id, documentId));
    return doc?.yDocState ? new Uint8Array(doc.yDocState) : null;
  }

  async saveState(documentId: string, state: Uint8Array): Promise<SavedDocumentMetadata | null> {
    const [stored] = await saveDocumentStateQuery(db, documentId, state);
    return stored ?? null;
  }
}
