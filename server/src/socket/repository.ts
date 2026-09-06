import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { document } from "../db/schema.js";

export interface DocumentStateRepository {
  loadState(documentId: string): Promise<Uint8Array | null>;
  saveState(documentId: string, state: Uint8Array): Promise<Date>;
}

export class DrizzleDocumentStateRepository implements DocumentStateRepository {
  async loadState(documentId: string): Promise<Uint8Array | null> {
    const [doc] = await db
      .select({ yDocState: document.yDocState })
      .from(document)
      .where(eq(document.id, documentId));
    return doc?.yDocState ? new Uint8Array(doc.yDocState) : null;
  }

  async saveState(documentId: string, state: Uint8Array): Promise<Date> {
    const updatedAt = new Date();
    await db
      .update(document)
      .set({ yDocState: Buffer.from(state), updatedAt })
      .where(eq(document.id, documentId));
    return updatedAt;
  }
}
