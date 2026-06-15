import { Router } from "express";
import { z } from "zod";
import { DocumentService } from "../services/document.service.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { notifyPermissionChange, handleDocumentDeleted, type TypeSyncSocketServer } from "../socket/index.js";
import {
  CreateDocumentSchema,
  UpdateDocumentSchema,
  AddCollaboratorSchema,
} from "@typesync/shared";

export default function createDocumentRoutes(io: TypeSyncSocketServer) {
  const router = Router();
  const IdParamSchema = z.string().uuid();

// All routes require authentication
router.use(requireAuth as any);

// Helper to safely get a single string param
function paramStr(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? "";
  return val ?? "";
}

function uuidParam(val: string | string[] | undefined): string {
  return IdParamSchema.parse(paramStr(val));
}

// ─── Create document ─────────────────────────────────────
router.post(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { title } = CreateDocumentSchema.parse(req.body);
    const doc = await DocumentService.createDocument(title, req.user!.id);
    res.status(201).json({ success: true, data: doc });
  })
);

// ─── List user's documents ───────────────────────────────
router.get(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const docs = await DocumentService.listUserDocuments(req.user!.id);
    res.json({ success: true, data: docs });
  })
);

// ─── Get document ────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const docId = uuidParam(req.params.id);
    const doc = await DocumentService.getDocument(docId, req.user!.id);
    res.json({ success: true, data: doc });
  })
);

// ─── Update document title ───────────────────────────────
router.patch(
  "/:id",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const docId = uuidParam(req.params.id);
    const { title } = UpdateDocumentSchema.parse(req.body);
    if (title !== undefined) {
      const updated = await DocumentService.updateDocumentTitle(docId, title, req.user!.id);
      io.to(`doc:${docId}`).emit("doc:title-updated", {
        documentId: docId,
        title: updated.title,
        updatedAt: updated.updatedAt.toISOString(),
      });
      res.json({ success: true, data: updated });
    } else {
      res.json({ success: true });
    }
  })
);

// ─── Delete document ─────────────────────────────────────
router.delete(
  "/:id",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const docId = uuidParam(req.params.id);
    await DocumentService.deleteDocument(docId, req.user!.id);
    handleDocumentDeleted(io, docId);
    res.json({ success: true });
  })
);

// ─── Add collaborator ────────────────────────────────────
router.post(
  "/:id/collaborators",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const docId = uuidParam(req.params.id);
    const { email, role } = AddCollaboratorSchema.parse(req.body);
    const collab = await DocumentService.addCollaborator(docId, email, role, req.user!.id);
    notifyPermissionChange(io, docId, collab.userId, collab.role as "editor" | "viewer");
    res.status(201).json({ success: true, data: collab });
  })
);

// ─── Remove collaborator ─────────────────────────────────
router.delete(
  "/:id/collaborators/:userId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const docId = uuidParam(req.params.id);
    const targetUserId = paramStr(req.params.userId);
    await DocumentService.removeCollaborator(docId, targetUserId, req.user!.id);
    notifyPermissionChange(io, docId, targetUserId, null);
    res.json({ success: true });
  })
);

  return router;
}
