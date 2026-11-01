import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { documentAsset } from "../db/schema.js";
import { AppError } from "../middleware/error.js";
import { normalizeDocumentImage } from "./document-image.js";

export async function createDocumentAsset(documentId: string, input: Buffer) {
  const image = await normalizeDocumentImage(input);
  const [asset] = await db.insert(documentAsset).values({
    documentId,
    ...image,
    byteLength: image.data.byteLength,
  }).returning({
    id: documentAsset.id,
    width: documentAsset.width,
    height: documentAsset.height,
    mediaType: documentAsset.mediaType,
  });
  if (!asset) throw new AppError(500, "Could not store image");
  return asset;
}

export async function readDocumentAsset(documentId: string, assetId: string) {
  const [asset] = await db.select().from(documentAsset).where(and(
    eq(documentAsset.documentId, documentId),
    eq(documentAsset.id, assetId),
  ));
  if (!asset) throw new AppError(404, "Image not found");
  return asset;
}
