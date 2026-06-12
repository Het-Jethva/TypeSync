import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { document, documentCollaborator, user } from "../db/schema.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

// All routes require authentication
router.use(requireAuth as any);

// Helper to safely get a single string param
function paramStr(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? "";
  return val ?? "";
}

// ─── Create document ─────────────────────────────────────
router.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const { title } = req.body;
    const [doc] = await db
      .insert(document)
      .values({
        title: title || "Untitled",
        ownerId: req.user!.id,
      })
      .returning();

    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    console.error("Create document error:", error);
    res.status(500).json({ success: false, error: "Failed to create document" });
  }
});

// ─── List user's documents ───────────────────────────────
router.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get owned documents
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

    // Get shared documents
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

    const docs = [
      ...ownedDocs.map((d) => ({ ...d, role: "owner" as const })),
      ...sharedDocs,
    ];

    res.json({ success: true, data: docs });
  } catch (error) {
    console.error("List documents error:", error);
    res.status(500).json({ success: false, error: "Failed to list documents" });
  }
});

// ─── Get document ────────────────────────────────────────
router.get("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const docId = paramStr(req.params.id);

    const [doc] = await db
      .select()
      .from(document)
      .where(eq(document.id, docId));

    if (!doc) {
      res.status(404).json({ success: false, error: "Document not found" });
      return;
    }

    // Check access
    const isOwner = doc.ownerId === userId;
    if (!isOwner) {
      const collabs = await db
        .select()
        .from(documentCollaborator)
        .where(eq(documentCollaborator.documentId, docId));

      const hasAccess = collabs.some((c) => c.userId === userId);
      if (!hasAccess) {
        res.status(403).json({ success: false, error: "Access denied" });
        return;
      }
    }

    // Get collaborators
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

    res.json({
      success: true,
      data: {
        id: doc.id,
        title: doc.title,
        ownerId: doc.ownerId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        collaborators: collaborators.map((c) => ({
          id: c.id,
          documentId: c.documentId,
          userId: c.userId,
          role: c.role,
          invitedAt: c.invitedAt,
          user: {
            id: c.userId,
            name: c.userName,
            email: c.userEmail,
            image: c.userImage,
          },
        })),
        role: isOwner ? "owner" : "editor",
      },
    });
  } catch (error) {
    console.error("Get document error:", error);
    res.status(500).json({ success: false, error: "Failed to get document" });
  }
});

// ─── Update document title ───────────────────────────────
router.patch("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const docId = paramStr(req.params.id);
    const { title } = req.body;

    const [doc] = await db
      .select()
      .from(document)
      .where(eq(document.id, docId));

    if (!doc) {
      res.status(404).json({ success: false, error: "Document not found" });
      return;
    }

    // Only owner and editors can update
    const isOwner = doc.ownerId === userId;
    if (!isOwner) {
      const collabs = await db
        .select()
        .from(documentCollaborator)
        .where(eq(documentCollaborator.documentId, docId));

      const collab = collabs.find((c) => c.userId === userId);
      if (!collab || collab.role !== "editor") {
        res.status(403).json({ success: false, error: "Access denied" });
        return;
      }
    }

    const [updated] = await db
      .update(document)
      .set({ title, updatedAt: new Date() })
      .where(eq(document.id, docId))
      .returning();

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update document error:", error);
    res.status(500).json({ success: false, error: "Failed to update document" });
  }
});

// ─── Delete document ─────────────────────────────────────
router.delete("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const docId = paramStr(req.params.id);

    const [doc] = await db
      .select()
      .from(document)
      .where(eq(document.id, docId));

    if (!doc) {
      res.status(404).json({ success: false, error: "Document not found" });
      return;
    }

    if (doc.ownerId !== userId) {
      res.status(403).json({ success: false, error: "Only the owner can delete" });
      return;
    }

    await db.delete(document).where(eq(document.id, docId));
    res.json({ success: true });
  } catch (error) {
    console.error("Delete document error:", error);
    res.status(500).json({ success: false, error: "Failed to delete document" });
  }
});

// ─── Add collaborator ────────────────────────────────────
router.post("/:id/collaborators", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const docId = paramStr(req.params.id);
    const { email, role } = req.body;

    // Verify ownership
    const [doc] = await db
      .select()
      .from(document)
      .where(eq(document.id, docId));

    if (!doc || doc.ownerId !== userId) {
      res.status(403).json({ success: false, error: "Only the owner can add collaborators" });
      return;
    }

    // Find user by email
    const [targetUser] = await db
      .select()
      .from(user)
      .where(eq(user.email, email));

    if (!targetUser) {
      res.status(404).json({ success: false, error: "User not found. They need to sign up first." });
      return;
    }

    if (targetUser.id === userId) {
      res.status(400).json({ success: false, error: "Cannot add yourself as a collaborator" });
      return;
    }

    // Check if already a collaborator
    const existing = await db
      .select()
      .from(documentCollaborator)
      .where(eq(documentCollaborator.documentId, docId));

    const alreadyCollab = existing.find((c) => c.userId === targetUser.id);
    if (alreadyCollab) {
      // Update role instead
      const [updated] = await db
        .update(documentCollaborator)
        .set({ role: role || "editor" })
        .where(eq(documentCollaborator.id, alreadyCollab.id))
        .returning();

      res.json({ success: true, data: updated });
      return;
    }

    const [collab] = await db
      .insert(documentCollaborator)
      .values({
        documentId: docId,
        userId: targetUser.id,
        role: role || "editor",
      })
      .returning();

    res.status(201).json({ success: true, data: collab });
  } catch (error) {
    console.error("Add collaborator error:", error);
    res.status(500).json({ success: false, error: "Failed to add collaborator" });
  }
});

// ─── Remove collaborator ─────────────────────────────────
router.delete("/:id/collaborators/:userId", async (req: AuthenticatedRequest, res) => {
  try {
    const currentUserId = req.user!.id;
    const docId = paramStr(req.params.id);
    const targetUserId = paramStr(req.params.userId);

    const [doc] = await db
      .select()
      .from(document)
      .where(eq(document.id, docId));

    if (!doc || doc.ownerId !== currentUserId) {
      res.status(403).json({ success: false, error: "Only the owner can remove collaborators" });
      return;
    }

    await db
      .delete(documentCollaborator)
      .where(
        and(
          eq(documentCollaborator.documentId, docId),
          eq(documentCollaborator.userId, targetUserId)
        )
      );

    res.json({ success: true });
  } catch (error) {
    console.error("Remove collaborator error:", error);
    res.status(500).json({ success: false, error: "Failed to remove collaborator" });
  }
});

export default router;
