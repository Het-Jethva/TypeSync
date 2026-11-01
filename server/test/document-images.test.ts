import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { editorSchema } from "@typesync/shared/editor-schema";
import { normalizeDocumentImage } from "../src/services/document-image.ts";

test("document images decode actual raster data and reject unsupported or malformed content", async () => {
  const input = await sharp({ create: { width: 32, height: 24, channels: 3, background: "red" } }).png().toBuffer();
  const image = await normalizeDocumentImage(input);
  assert.equal(image.width, 32);
  assert.equal(image.height, 24);
  assert.equal(image.mediaType, "image/png");
  assert.equal((await sharp(image.data).metadata()).format, "png");
  await assert.rejects(normalizeDocumentImage(Buffer.from("not an image")), { statusCode: 415 });
  await assert.rejects(normalizeDocumentImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>')), { statusCode: 415 });
  await assert.rejects(normalizeDocumentImage(Buffer.alloc(10 * 1024 * 1024 + 1)), { statusCode: 413 });
});

test("shared document schema preserves image attributes and rejects invalid dimensions", () => {
  const attrs = {
    src: "https://example.com/image.png", assetId: "123e4567-e89b-42d3-a456-426614174000",
    alt: "A red rectangle", title: null, width: 320, height: 240, alignment: "right",
  };
  const node = editorSchema.nodeFromJSON({ type: "doc", content: [{ type: "image", attrs }] });
  node.check();
  assert.deepEqual({ ...node.firstChild?.attrs }, attrs);
  assert.throws(() => editorSchema.nodeFromJSON({ type: "doc", content: [{ type: "image", attrs: { ...attrs, width: -5 } }] }).check());
  assert.throws(() => editorSchema.nodeFromJSON({ type: "doc", content: [{ type: "image", attrs: { ...attrs, alignment: "floating" } }] }).check());
  assert.throws(() => editorSchema.nodeFromJSON({ type: "doc", content: [{ type: "image", attrs: { ...attrs, src: 12 } }] }).check());
  assert.throws(() => editorSchema.nodeFromJSON({ type: "doc", content: [{ type: "image", attrs: { ...attrs, alt: { bad: true } } }] }).check());
});
