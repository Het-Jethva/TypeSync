import { eq, desc, and, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { document, documentCollaborator, user } from "../db/schema.js";
import { AppError } from "../middleware/error.js";
import type { ListDocumentsQuery, Role } from "@typesync/shared";
import { notifyPermissionChange, type TypeSyncSocketServer } from "../socket/index.js";


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
  private static async getDocumentOrThrow(
    docId: string,
    userId?: string,
    requiredRole?: 'owner' | 'editor' | 'any'
  ): Promise<{ id: string; ownerId: string }> {
    const [doc] = await db
      .select({ id: document.id, ownerId: document.ownerId })
      .from(document)
      .where(eq(document.id, docId));
    if (!doc) throw new AppError(404, "Document not found");

    if (userId && requiredRole) {
      if (requiredRole === 'owner') {
        if (doc.ownerId !== userId) throw new AppError(403, "Only the owner can perform this action");
      } else {
        const access = await DocumentService.getDocumentAccess(docId, userId);
        if (!access.hasAccess) throw new AppError(403, "Access denied");
        if (requiredRole === 'editor' && access.role === 'viewer') {
          throw new AppError(403, "Access denied");
        }
      }
    }
    return doc;
  }

  static async createDocument(title: string, ownerId: string) {
    const [doc] = await db
      .insert(document)
      .values({
        title: title || "Untitled",
        ownerId,
      })
      .returning();
    return doc;
  }

  static async listUserDocuments(userId: string, pagination: ListDocumentsQuery) {
    const cursor = pagination.cursor ? decodeDocumentCursor(pagination.cursor) : null;
    const cursorFilter = cursor
      ? or(
          lt(document.updatedAt, cursor.updatedAt),
          and(eq(document.updatedAt, cursor.updatedAt), lt(document.id, cursor.id))
        )
      : undefined;
    const queryLimit = pagination.limit + 1;

    const [ownedDocs, sharedDocs] = await Promise.all([
      db
        .select({
          id: document.id,
          title: document.title,
          ownerId: document.ownerId,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        })
        .from(document)
        .where(and(eq(document.ownerId, userId), cursorFilter))
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
        .where(and(eq(documentCollaborator.userId, userId), cursorFilter))
        .orderBy(desc(document.updatedAt), desc(document.id))
        .limit(queryLimit),
    ]);

    const combined = [
      ...ownedDocs.map((doc) => ({ ...doc, role: "owner" as const })),
      ...sharedDocs,
    ].sort((a, b) => {
      const updatedAtDifference = b.updatedAt.getTime() - a.updatedAt.getTime();
      return updatedAtDifference || b.id.localeCompare(a.id);
    });
    const items = combined.slice(0, pagination.limit);
    const lastItem = items.at(-1);
    const nextCursor = combined.length > pagination.limit && lastItem
      ? encodeDocumentCursor(lastItem)
      : null;

    return { items, nextCursor };
  }

  static async getDocumentAccess(docId: string, userId: string): Promise<{ hasAccess: boolean; role: string }> {
    const [doc] = await db
      .select({ ownerId: document.ownerId })
      .from(document)
      .where(eq(document.id, docId));

    if (!doc) return { hasAccess: false, role: "" };
    if (doc.ownerId === userId) return { hasAccess: true, role: "owner" };

    const [collab] = await db
      .select({ role: documentCollaborator.role })
      .from(documentCollaborator)
      .where(and(eq(documentCollaborator.documentId, docId), eq(documentCollaborator.userId, userId)));

    if (collab) return { hasAccess: true, role: collab.role };

    return { hasAccess: false, role: "" };
  }

  static async getDocument(docId: string, userId: string) {
    const [doc] = await db
      .select({
        id: document.id,
        title: document.title,
        ownerId: document.ownerId,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })
      .from(document)
      .where(eq(document.id, docId));
    if (!doc) throw new AppError(404, "Document not found");

    let role: string;
    if (doc.ownerId === userId) {
      role = "owner";
    } else {
      const [collab] = await db
        .select({ role: documentCollaborator.role })
        .from(documentCollaborator)
        .where(
          and(
            eq(documentCollaborator.documentId, docId),
            eq(documentCollaborator.userId, userId)
          )
        );
      if (!collab) throw new AppError(403, "Access denied");
      role = collab.role;
    }

    return {
      ...doc,
      role: role as Role,
    };
  }

  static async listCollaborators(docId: string, userId: string) {
    await this.getDocumentOrThrow(docId, userId, "owner");

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
      .where(eq(documentCollaborator.documentId, docId));

    return collaborators.map((c) => ({
      id: c.id,
      documentId: c.documentId,
      userId: c.userId,
      role: c.role as Role,
      invitedAt: c.invitedAt,
      user: {
        id: c.userId,
        name: c.userName,
        email: c.userEmail,
        image: c.userImage,
      },
    }));
  }

  static async updateDocumentTitle(docId: string, title: string, userId: string) {
    await this.getDocumentOrThrow(docId, userId, 'editor');

    const [updated] = await db
      .update(document)
      .set({ title, updatedAt: new Date() })
      .where(eq(document.id, docId))
      .returning();

    return updated;
  }

  static async deleteDocument(docId: string, userId: string) {
    await this.getDocumentOrThrow(docId, userId, 'owner');

    await db.delete(document).where(eq(document.id, docId));
  }

  private static async addCollaborator(
    docId: string,
    email: string,
    role: "editor" | "viewer",
    userId: string
  ) {
    await this.getDocumentOrThrow(docId, userId, 'owner');

    const [targetUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    if (!targetUser) {
      throw new AppError(404, "User not found. They need to sign up first.");
    }

    if (targetUser.id === userId) {
      throw new AppError(400, "Cannot add yourself as a collaborator");
    }

    const [collab] = await db
      .insert(documentCollaborator)
      .values({
        documentId: docId,
        userId: targetUser.id,
        role,
      })
      .onConflictDoUpdate({
        target: [documentCollaborator.documentId, documentCollaborator.userId],
        set: { role },
      })
      .returning();

    return collab;
  }

  private static async removeCollaborator(docId: string, targetUserId: string, currentUserId: string) {
    await this.getDocumentOrThrow(docId, currentUserId, 'owner');

    await db
      .delete(documentCollaborator)
      .where(
        and(
          eq(documentCollaborator.documentId, docId),
          eq(documentCollaborator.userId, targetUserId)
        )
      );
  }

  static async grantCollaboratorAccess(
    io: TypeSyncSocketServer,
    docId: string,
    email: string,
    role: "editor" | "viewer",
    currentUserId: string
  ) {
    const collab = await this.addCollaborator(docId, email, role, currentUserId);
    await notifyPermissionChange(io, docId, collab.userId, collab.role as "editor" | "viewer");
    return collab;
  }

  static async revokeCollaboratorAccess(
    io: TypeSyncSocketServer,
    docId: string,
    targetUserId: string,
    currentUserId: string
  ) {
    await this.removeCollaborator(docId, targetUserId, currentUserId);
    await notifyPermissionChange(io, docId, targetUserId, null);
  }
}


