import { and, asc, desc, eq, gt, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import type { ListDocumentsQuery, Role } from "@typesync/shared";
import { db } from "../db/index.js";
import { documentMetadata, updateDocumentTitleQuery } from "../db/monotonic-updated-at.js";
import { document, documentCollaborator, user } from "../db/schema.js";
import { AppError } from "../middleware/error.js";
import {
  decodeDocumentCursor,
  documentCursorFor,
  encodeDocumentCursor,
  type DocumentCursor,
  type DocumentListSort,
} from "./document-cursor.js";

function documentCursorFilter(cursor: DocumentCursor): SQL | undefined {
  if (cursor.sort === "alphabetical") {
    return or(
      gt(document.title, cursor.title),
      and(eq(document.title, cursor.title), gt(document.id, cursor.id))
    );
  }

  const dateColumn = cursor.sort === "created" ? document.createdAt : document.updatedAt;
  const cursorDate = cursor.sort === "created" ? cursor.createdAt : cursor.updatedAt;
  return or(
    lt(dateColumn, cursorDate),
    and(eq(dateColumn, cursorDate), lt(document.id, cursor.id))
  );
}

function documentOrder(sort: DocumentListSort): [SQL, SQL] {
  switch (sort) {
    case "alphabetical":
      return [asc(document.title), asc(document.id)];
    case "created":
      return [desc(document.createdAt), desc(document.id)];
    case "updated":
      return [desc(document.updatedAt), desc(document.id)];
  }
}

function listedDocumentColumns(role: SQL<Role>) {
  return {
    id: document.id,
    title: document.title,
    ownerId: document.ownerId,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    role: role.as("role"),
  };
}

export class DocumentService {
  static async createDocument(title: string, ownerId: string) {
    const [storedDocument] = await db
      .insert(document)
      .values({ title, ownerId })
      .returning(documentMetadata);
    if (!storedDocument) throw new AppError(500, "Document creation failed");
    return storedDocument;
  }

  static async listUserDocuments(userId: string, pagination: ListDocumentsQuery) {
    const sort = pagination.sort;
    const cursor = pagination.cursor ? decodeDocumentCursor(pagination.cursor, sort) : null;
    const cursorFilter = cursor ? documentCursorFilter(cursor) : undefined;
    const [primaryOrder, tieBreakOrder] = documentOrder(sort);
    // Escaped so a title containing % or _ matches literally rather than
    // turning into a wildcard.
    const titleFilter = pagination.q
      ? ilike(document.title, `%${pagination.q.replace(/[\\%_]/g, "\\$&")}%`)
      : undefined;
    const queryLimit = pagination.limit + 1;
    // Both sides share a projection so Postgres can order the union. Casting
    // role to text keeps the enum and the owner literal in one column type.
    const rows = await unionAll(
      db
        .select(listedDocumentColumns(sql<Role>`'owner'::text`))
        .from(document)
        .where(and(eq(document.ownerId, userId), cursorFilter, titleFilter)),
      db
        .select(listedDocumentColumns(sql<Role>`${documentCollaborator.role}::text`))
        .from(documentCollaborator)
        .innerJoin(document, eq(documentCollaborator.documentId, document.id))
        .where(and(eq(documentCollaborator.userId, userId), cursorFilter, titleFilter)),
    ).orderBy(primaryOrder, tieBreakOrder).limit(queryLimit);

    const hasMore = rows.length > pagination.limit;
    const items = hasMore ? rows.slice(0, pagination.limit) : rows;
    const lastItem = items.at(-1);
    const nextCursor = hasMore && lastItem
      ? encodeDocumentCursor(documentCursorFor(sort, lastItem))
      : null;

    return { items, nextCursor };
  }

  static async getDocument(documentId: string) {
    const [storedDocument] = await db
      .select(documentMetadata)
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
    const [updated] = await updateDocumentTitleQuery(db, documentId, title);
    if (!updated) throw new AppError(404, "Document not found");
    return updated;
  }

  static async listAccessUserIds(documentId: string): Promise<string[]> {
    const [storedDocument] = await db
      .select({ ownerId: document.ownerId })
      .from(document)
      .where(eq(document.id, documentId));
    if (!storedDocument) return [];

    const collaborators = await db
      .select({ userId: documentCollaborator.userId })
      .from(documentCollaborator)
      .where(eq(documentCollaborator.documentId, documentId));

    return [storedDocument.ownerId, ...collaborators.map((row) => row.userId)];
  }

  static async deleteDocument(documentId: string): Promise<void> {
    await db.delete(document).where(eq(document.id, documentId));
  }
}
