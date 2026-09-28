import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { saveDocumentStateQuery } from "../db/monotonic-updated-at.js";
import { document } from "../db/schema.js";

export interface DocumentStateRepository {
  loadState(documentId: string): Promise<Uint8Array | null>;
  saveState(documentId: string, state: Uint8Array): Promise<Date | null>;
}

export class DrizzleDocumentStateRepository implements DocumentStateRepository {
  async loadState(documentId: string): Promise<Uint8Array | null> {
    const [doc] = await db
      .select({ yDocState: document.yDocState })
      .from(document)
      .where(eq(document.id, documentId));
    return doc?.yDocState ? new Uint8Array(doc.yDocState) : null;
  }

  async saveState(documentId: string, state: Uint8Array): Promise<Date | null> {
    const [stored] = await saveDocumentStateQuery(db, documentId, state);
    return stored?.updatedAt ?? null;
  }
}
