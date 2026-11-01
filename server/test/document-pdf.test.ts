import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfSnapshot, pdfHtml } from "../src/services/document-pdf.ts";
import { externalImageUrl, isPublicAddress, fetchExportImage } from "../src/services/export-image.ts";

test("PDF snapshots reject invalid documents and render text and links without executable markup", async () => {
  assert.throws(() => parsePdfSnapshot({ title: "Bad", content: { type: "paragraph" } }), { statusCode: 400 });
  assert.throws(() => parsePdfSnapshot({ title: "Bad", content: { type: "doc", content: [{ type: "unknown" }] } }), { statusCode: 400 });
  assert.throws(() => parsePdfSnapshot({ title: "Too many images", content: { type: "doc", content: Array.from({ length: 51 }, () => ({ type: "image", attrs: { src: "https://example.com/image.png" } })) } }), { statusCode: 413 });
  const { title, doc } = parsePdfSnapshot({ title: "<title>", content: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: '<script>alert("x")</script>', marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
    { type: "image", attrs: { src: "https://example.com/image.png", alt: '<img onerror="alert(1)">', width: 240, alignment: "right" } },
  ] } });
  const html = await pdfHtml(title, doc, async () => ({ data: Buffer.from("fixture"), mediaType: "image/png" }), new AbortController().signal);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;title&gt;"));
  assert.ok(html.includes('href=""'));
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(html.includes("width:240px"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("<script>"));
});

test("external PDF images reject private destinations and non-HTTP sources", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fd00::1", "224.0.0.1"]) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of ["file:///etc/passwd", "data:image/png;base64,AA", "https://user:pass@example.com/a.png", "http://example.com:3000/a.png"]) assert.throws(() => externalImageUrl(url), { statusCode: 400 });
  await assert.rejects(fetchExportImage("http://127.0.0.1/a.png", new AbortController().signal), { statusCode: 400 });
});
