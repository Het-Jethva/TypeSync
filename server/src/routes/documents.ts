import { Router } from "express";
import { z } from "zod";
import {
  AddCollaboratorSchema,
  CreateDocumentSchema,
  ListDocumentsQuerySchema,
  UpdateDocumentSchema,
} from "@typesync/shared";
import { asyncHandler } from "../middleware/error.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { DocumentAccessAuthorizer } from "../services/document-access-authorizer.js";
import { DocumentService } from "../services/document.service.js";
import { CollaborativeRoomSession } from "../socket/room-session.js";
import type { TypeSyncSocketServer } from "../socket/types.js";

export default function createDocumentRoutes(
  io: TypeSyncSocketServer,
  roomSession: CollaborativeRoomSession,
  accessAuthorizer: DocumentAccessAuthorizer
) {
  const router = Router();
  const IdParamSchema = z.string().uuid();

  router.use(requireAuth as any);

  function paramStr(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value[0] ?? "";
    return value ?? "";
  }

  function uuidParam(value: string | string[] | undefined): string {
    return IdParamSchema.parse(paramStr(value));
  }

  router.post(
    "/",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { title } = CreateDocumentSchema.parse(req.body);
      const storedDocument = await DocumentService.createDocument(title, req.user!.id);
      res.status(201).json({ success: true, data: storedDocument });
    })
  );

  router.get(
    "/",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const pagination = ListDocumentsQuerySchema.parse(req.query);
      const page = await DocumentService.listUserDocuments(req.user!.id, pagination);
      res.json({ success: true, data: page });
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const documentId = uuidParam(req.params.id);
      const role = await accessAuthorizer.requireDocumentRole(documentId, req.user!.id, "any");
      const storedDocument = await DocumentService.getDocument(documentId);
      res.json({ success: true, data: { ...storedDocument, role } });
    })
  );

  router.patch(
    "/:id",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const documentId = uuidParam(req.params.id);
      const { title } = UpdateDocumentSchema.parse(req.body);

      // Authorize before the no-op shortcut below. Behind it, a caller with no
      // access to this document receives a success response for it, and the
      // check stops covering any field later added to UpdateDocumentSchema.
      await accessAuthorizer.requireDocumentRole(documentId, req.user!.id, "editor");

      if (title === undefined) {
        res.json({ success: true });
        return;
      }

      const updated = await DocumentService.updateDocumentTitle(documentId, title);
      io.to(`doc:${documentId}`).emit("doc:title-updated", {
        documentId,
        title: updated.title,
        updatedAt: updated.updatedAt.toISOString(),
      });
      res.json({ success: true, data: updated });
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const documentId = uuidParam(req.params.id);
      await accessAuthorizer.requireDocumentRole(documentId, req.user!.id, "owner");
      await DocumentService.deleteDocument(documentId);
      roomSession.handleDocumentDeleted(documentId);
      res.json({ success: true });
    })
  );

  router.get(
    "/:id/collaborators",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const documentId = uuidParam(req.params.id);
      await accessAuthorizer.requireDocumentRole(documentId, req.user!.id, "owner");
      const collaborators = await DocumentService.listCollaborators(documentId);
      res.json({ success: true, data: collaborators });
    })
  );

  router.post(
    "/:id/collaborators",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const documentId = uuidParam(req.params.id);
      const { email, role } = AddCollaboratorSchema.parse(req.body);
      const collaborator = await accessAuthorizer.grantAccess(
        documentId,
        email,
        role,
        req.user!.id
      );
      res.status(201).json({ success: true, data: collaborator });
    })
  );

  router.delete(
    "/:id/collaborators/:userId",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const documentId = uuidParam(req.params.id);
      const targetUserId = paramStr(req.params.userId);
      await accessAuthorizer.revokeAccess(documentId, targetUserId, req.user!.id);
      res.json({ success: true });
    })
  );

  return router;
}
