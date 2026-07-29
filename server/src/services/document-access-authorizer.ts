import { and, eq } from "drizzle-orm";
import type { Role } from "@typesync/shared";
import { db } from "../db/index.js";
import { document, documentCollaborator, user } from "../db/schema.js";
import { AppError } from "../middleware/error.js";
import {
  CollaborativeRoomSession,
  type SessionAccess,
} from "../socket/room-session.js";

type RequiredDocumentRole = "owner" | "editor" | "any";

type AccessLookup = {
  document: { id: string; ownerId: string } | null;
  role: Role | null;
};

export class DocumentAccessAuthorizer {
  private readonly accessChangeTails = new Map<string, Promise<void>>();

  constructor(private readonly roomSession: CollaborativeRoomSession) {}

  private async serializeAccessChange<T>(
    documentId: string,
    userId: string,
    change: () => Promise<T>
  ): Promise<T> {
    const key = `${documentId}:${userId}`;
    const previous = this.accessChangeTails.get(key) ?? Promise.resolve();
    const result = previous.then(change);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.accessChangeTails.set(key, tail);

    try {
      return await result;
    } finally {
      if (this.accessChangeTails.get(key) === tail) {
        this.accessChangeTails.delete(key);
      }
    }
  }

  private async lookupAccess(documentId: string, userId: string): Promise<AccessLookup> {
    const [storedDocument] = await db
      .select({ id: document.id, ownerId: document.ownerId })
      .from(document)
      .where(eq(document.id, documentId));

    if (!storedDocument) return { document: null, role: null };
    if (storedDocument.ownerId === userId) {
      return { document: storedDocument, role: "owner" };
    }

    const [collaborator] = await db
      .select({ role: documentCollaborator.role })
      .from(documentCollaborator)
      .where(
        and(
          eq(documentCollaborator.documentId, documentId),
          eq(documentCollaborator.userId, userId)
        )
      );

    return {
      document: storedDocument,
      role: collaborator ? (collaborator.role as Exclude<Role, "owner">) : null,
    };
  }

  async authorizeSocketSession(documentId: string, userId: string): Promise<SessionAccess> {
    const { role } = await this.lookupAccess(documentId, userId);
    return role ? { hasAccess: true, role } : { hasAccess: false };
  }

  async requireDocumentRole(
    documentId: string,
    userId: string,
    requiredRole: RequiredDocumentRole
  ): Promise<Role> {
    const access = await this.lookupAccess(documentId, userId);
    if (!access.document) throw new AppError(404, "Document not found");
    if (!access.role) throw new AppError(403, "Access denied");

    if (requiredRole === "owner" && access.role !== "owner") {
      throw new AppError(403, "Only the owner can perform this action");
    }
    if (requiredRole === "editor" && access.role === "viewer") {
      throw new AppError(403, "Access denied");
    }

    return access.role;
  }

  async grantAccess(
    documentId: string,
    email: string,
    role: Exclude<Role, "owner">,
    currentUserId: string
  ) {
    await this.requireDocumentRole(documentId, currentUserId, "owner");

    const [targetUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    if (!targetUser) {
      throw new AppError(
        404,
        "No TypeSync account exists for this email. Ask them to create an account, then try again."
      );
    }
    if (targetUser.id === currentUserId) {
      throw new AppError(400, "Cannot add yourself as a collaborator");
    }

    return this.serializeAccessChange(documentId, targetUser.id, async () => {
      const [collaborator] = await db
        .insert(documentCollaborator)
        .values({ documentId, userId: targetUser.id, role })
        .onConflictDoUpdate({
          target: [documentCollaborator.documentId, documentCollaborator.userId],
          set: { role },
        })
        .returning();

      this.roomSession.reconcileAccessChange(documentId, targetUser.id, role);
      return collaborator;
    });
  }

  async revokeAccess(
    documentId: string,
    targetUserId: string,
    currentUserId: string
  ): Promise<void> {
    const access = await this.lookupAccess(documentId, currentUserId);
    if (!access.document) throw new AppError(404, "Document not found");
    if (!access.role) throw new AppError(403, "Access denied");

    // Ownership lives on the document, not in the collaborator table, so
    // revoking the owner deletes nothing yet still ejects their live sockets,
    // leaving the runtime contradicting the database.
    if (targetUserId === access.document.ownerId) {
      throw new AppError(400, "Cannot revoke the document owner");
    }

    // Collaborators may give up their own access. Without this, a document
    // shared with someone stays in their list forever, because only the owner
    // could ever remove them.
    if (targetUserId !== currentUserId && access.role !== "owner") {
      throw new AppError(403, "Only the owner can perform this action");
    }

    await this.serializeAccessChange(documentId, targetUserId, async () => {
      await db
        .delete(documentCollaborator)
        .where(
          and(
            eq(documentCollaborator.documentId, documentId),
            eq(documentCollaborator.userId, targetUserId)
          )
        );

      this.roomSession.reconcileAccessChange(documentId, targetUserId, null);
    });
  }
}
