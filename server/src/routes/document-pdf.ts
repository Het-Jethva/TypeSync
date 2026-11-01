import { Router } from "express";
import { z } from "zod";
import { requireAuth, authenticatedUser } from "../middleware/auth.js";
import { isTrustedWebOrigin } from "../lib/origin.js";
import { DocumentAccessAuthorizer } from "../services/document-access-authorizer.js";
import { parsePdfSnapshot, renderDocumentPdf } from "../services/document-pdf.js";
import { readDocumentAsset } from "../services/document-assets.js";
import { fetchExportImage } from "../services/export-image.js";
import { AppError } from "../middleware/error.js";

export default function createDocumentPdfRoutes(authorizer: DocumentAccessAuthorizer) {
  const router = Router();
  router.post("/:id/pdf", requireAuth, async (req, res) => {
    if (!isTrustedWebOrigin(req.get("origin"), req.get("referer"))) throw new AppError(403, "Forbidden origin");
    const documentId = z.uuid().parse(req.params.id);
    await authorizer.requireDocumentRole(documentId, authenticatedUser(req).id, "any");
    const { title, doc } = parsePdfSnapshot(req.body);
    const pdf = await renderDocumentPdf(title, doc, async (node, signal) => {
      if (typeof node.attrs.assetId === "string") return readDocumentAsset(documentId, node.attrs.assetId);
      return fetchExportImage(z.string().parse(node.attrs.src), signal);
    });
    const filename = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"`, "Cache-Control": "private, no-store" });
    res.send(pdf);
  });
  return router;
}
