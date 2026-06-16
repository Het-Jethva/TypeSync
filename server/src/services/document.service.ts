import { eq, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { document, documentCollaborator, user } from "../db/schema.js";
import { AppError } from "../middleware/error.js";
import type { Role } from "@typesync/shared";

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

  static async listUserDocuments(userId: string) {
    const ownedDocs = await db
      .select({
        id: document.id,
        title: document.title,
        ownerId: document.ownerId,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })
      .from(document)
      .where(eq(document.ownerId, userId))
      .orderBy(desc(document.updatedAt));

    const sharedDocs = await db
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
      .where(eq(documentCollaborator.userId, userId))
      .orderBy(desc(document.updatedAt));

    const combined = [
      ...ownedDocs.map((d) => ({ ...d, role: "owner" as const })),
      ...sharedDocs,
    ];

    return combined.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
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

    const access = await this.getDocumentAccess(docId, userId);
    if (!access.hasAccess) throw new AppError(403, "Access denied");

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

    return {
      ...doc,
      collaborators: collaborators.map((c) => ({
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
      })),
      role: access.role as Role,
    };
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

  static async addCollaborator(docId: string, email: string, role: string, userId: string) {
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

    const [existing] = await db
      .select({ id: documentCollaborator.id })
      .from(documentCollaborator)
      .where(and(eq(documentCollaborator.documentId, docId), eq(documentCollaborator.userId, targetUser.id)));

    if (existing) {
      const [updated] = await db
        .update(documentCollaborator)
        .set({ role: (role as "editor" | "viewer") || "editor" })
        .where(eq(documentCollaborator.id, existing.id))
        .returning();
      return updated;
    }

    const [collab] = await db
      .insert(documentCollaborator)
      .values({
        documentId: docId,
        userId: targetUser.id,
        role: (role as "editor" | "viewer") || "editor",
      })
      .returning();

    return collab;
  }

  static async removeCollaborator(docId: string, targetUserId: string, currentUserId: string) {
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
}

