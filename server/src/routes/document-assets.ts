import { raw, Router } from "express";
import { z } from "zod";
import { requireAuth, authenticatedUser } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { isTrustedWebOrigin } from "../lib/origin.js";
import type { DocumentAccessAuthorizer } from "../services/document-access-authorizer.js";
import { createDocumentAsset, readDocumentAsset } from "../services/document-assets.js";
import { MAX_IMAGE_BYTES } from "../services/document-image.js";

const AssetParamsSchema = z.object({ id: z.string().uuid(), assetId: z.string().uuid() });
const DocumentParamsSchema = AssetParamsSchema.omit({ assetId: true });

export default function createDocumentAssetRoutes(authorizer: DocumentAccessAuthorizer) {
  const router = Router();

  router.post("/:id/assets", requireAuth, async (req, _res, next) => {
    if (!isTrustedWebOrigin(req.get("origin"), req.get("referer"))) {
      throw new AppError(403, "Forbidden origin");
    }
    const { id } = DocumentParamsSchema.parse(req.params);
    await authorizer.requireDocumentRole(id, authenticatedUser(req).id, "editor");
    next();
  }, raw({ type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"], limit: MAX_IMAGE_BYTES }), async (req, res) => {
    const { id } = DocumentParamsSchema.parse(req.params);
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, "Choose a PNG, JPEG, or WebP image");
    const asset = await createDocumentAsset(id, req.body);
    res.status(201).json({ success: true, data: asset });
  });

  router.get("/:id/assets/:assetId", requireAuth, async (req, res) => {
    const { id, assetId } = AssetParamsSchema.parse(req.params);
    await authorizer.requireDocumentRole(id, authenticatedUser(req).id, "any");
    const asset = await readDocumentAsset(id, assetId);
    res.set({
      "Content-Type": asset.mediaType,
      "Content-Length": String(asset.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    }).send(asset.data);
  });

  return router;
}
