import sharp from "sharp";
import { AppError } from "../middleware/error.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;

export async function normalizeDocumentImage(input: Buffer) {
  if (input.byteLength === 0 || input.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError(413, "Choose an image smaller than 10 MiB");
  }
  try {
    const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning" });
    const metadata = await image.metadata();
    if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format) || (metadata.pages ?? 1) > 1) {
      throw new AppError(415, "Choose a static PNG, JPEG, or WebP image");
    }
    const { data, info } = await image.rotate().toBuffer({ resolveWithObject: true });
    if (info.width > 10_000 || info.height > 10_000) {
      throw new AppError(413, "Image dimensions cannot exceed 10000 pixels");
    }
    if (data.byteLength > MAX_IMAGE_BYTES) {
      throw new AppError(413, "Choose an image smaller than 10 MiB");
    }
    return { data, width: info.width, height: info.height, mediaType: `image/${info.format === "jpeg" ? "jpeg" : info.format}` };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(415, "The image cannot be decoded. Choose a PNG, JPEG, or WebP image within 25 million pixels");
  }
}
