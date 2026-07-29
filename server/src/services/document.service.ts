import { and, desc, eq, ilike, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { ListDocumentsQuery } from "@typesync/shared";
import { db } from "../db/index.js";
import { document, documentCollaborator, user } from "../db/schema.js";
import { AppError } from "../middleware/error.js";

const DocumentCursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().uuid(),
}).strict();

type DocumentCursor = {
  updatedAt: Date;
  id: string;
};

function encodeDocumentCursor(cursor: DocumentCursor): string {
  return Buffer.from(JSON.stringify({
    updatedAt: cursor.updatedAt.toISOString(),
    id: cursor.id,
  })).toString("base64url");
}

function decodeDocumentCursor(cursor: string): DocumentCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid encoding");
    const parsed = DocumentCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
    return { updatedAt: new Date(parsed.updatedAt), id: parsed.id };
  } catch {
    throw new AppError(400, "Invalid document cursor");
  }
}

export class DocumentService {
  static async createDocument(title: string, ownerId: string) {
    const [storedDocument] = await db
      .insert(document)
      .values({ title: title || "Untitled", ownerId })
      .returning();
    return storedDocument;
  }

  static async listUserDocuments(userId: string, pagination: ListDocumentsQuery) {
    const cursor = pagination.cursor ? decodeDocumentCursor(pagination.cursor) : null;
    const cursorFilter = cursor
      ? or(
          lt(document.updatedAt, cursor.updatedAt),
          and(eq(document.updatedAt, cursor.updatedAt), lt(document.id, cursor.id))
        )
      : undefined;
    // Escaped so a title containing % or _ matches literally rather than
    // turning into a wildcard.
    const titleFilter = pagination.q
      ? ilike(document.title, `%${pagination.q.replace(/[\\%_]/g, "\\$&")}%`)
      : undefined;
    const queryLimit = pagination.limit + 1;

    const [ownedDocuments, sharedDocuments] = await Promise.all([
      db
        .select({
          id: document.id,
          title: document.title,
          ownerId: document.ownerId,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        })
        .from(document)
        .where(and(eq(document.ownerId, userId), cursorFilter, titleFilter))
        .orderBy(desc(document.updatedAt), desc(document.id))
        .limit(queryLimit),
      db
        .select({
          id: document.id,
          title: document.title,
          ownerId: document.ownerId,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          role: documentCollaborator.role,
        })
        .from(documentCollaborator)
        .innerJoin(document, eq(documentCollaborator.documentId, document.id))
        .where(and(eq(documentCollaborator.userId, userId), cursorFilter, titleFilter))
        .orderBy(desc(document.updatedAt), desc(document.id))
        .limit(queryLimit),
    ]);

    const combined = [
      ...ownedDocuments.map((storedDocument) => ({ ...storedDocument, role: "owner" as const })),
      ...sharedDocuments,
    ].sort((left, right) => {
      const updatedAtDifference = right.updatedAt.getTime() - left.updatedAt.getTime();
      return updatedAtDifference || right.id.localeCompare(left.id);
    });
    const items = combined.slice(0, pagination.limit);
    const lastItem = items.at(-1);
    const nextCursor = combined.length > pagination.limit && lastItem
      ? encodeDocumentCursor(lastItem)
      : null;

    return { items, nextCursor };
  }

  static async getDocument(documentId: string) {
    const [storedDocument] = await db
      .select({
        id: document.id,
        title: document.title,
        ownerId: document.ownerId,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })
      .from(document)
      .where(eq(document.id, documentId));
    if (!storedDocument) throw new AppError(404, "Document not found");
    return storedDocument;
  }

  static async listCollaborators(documentId: string) {
    const collaborators = await db
      .select({
        id: documentCollaborator.id,
        documentId: documentCollaborator.documentId,
        userId: documentCollaborator.userId,
        role: documentCollaborator.role,
        invitedAt: documentCollaborator.invitedAt,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
      })
      .from(documentCollaborator)
      .innerJoin(user, eq(documentCollaborator.userId, user.id))
      .where(eq(documentCollaborator.documentId, documentId));

    return collaborators.map((collaborator) => ({
      id: collaborator.id,
      documentId: collaborator.documentId,
      userId: collaborator.userId,
      role: collaborator.role,
      invitedAt: collaborator.invitedAt,
      user: {
        id: collaborator.userId,
        name: collaborator.userName,
        email: collaborator.userEmail,
        image: collaborator.userImage,
      },
    }));
  }

  static async updateDocumentTitle(documentId: string, title: string) {
    const [updated] = await db
      .update(document)
      .set({ title, updatedAt: new Date() })
      .where(eq(document.id, documentId))
      .returning();
    return updated;
  }

  static async deleteDocument(documentId: string): Promise<void> {
    await db.delete(document).where(eq(document.id, documentId));
  }
}
