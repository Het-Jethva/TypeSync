import type { Node } from "@tiptap/pm/model";
import { editorSchema, validateTableResources } from "@typesync/shared/editor-schema";
import { chromium } from "playwright";
import { z } from "zod";
import { AppError } from "../middleware/error.js";

const SnapshotSchema = z.object({ title: z.string().max(500), content: z.unknown() });

export function parsePdfSnapshot(input: unknown): { title: string; doc: Node } {
  const { title, content } = SnapshotSchema.parse(input);
  const pending = [{ value: content, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item) break;
    if (++count > 200_000 || item.depth > 64) throw new AppError(413, "Document is too complex to export");
    if (item.value !== null && typeof item.value === "object") {
      for (const value of Object.values(item.value)) pending.push({ value, depth: item.depth + 1 });
    }
  }
  try {
    const doc = editorSchema.nodeFromJSON(content);
    if (doc.type.name !== "doc") throw new Error("Expected document");
    doc.check();
    validateTableResources(doc);
    let imageCount = 0;
    doc.descendants(node => { if (node.type.name === "image") imageCount++; });
    if (imageCount > 50) throw new AppError(413, "PDF export supports up to 50 images");
    return { title, doc };
  } catch (error) {
    if (error instanceof AppError || error instanceof z.ZodError) throw error;
    throw new AppError(400, "Document content is invalid");
  }
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function safeLink(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? escape(url.href) : "";
  } catch { return ""; }
}

export type PdfImage = { data: Buffer; mediaType: string };
export type PdfImageLoader = (node: Node, signal: AbortSignal) => Promise<PdfImage>;

export async function pdfHtml(title: string, doc: Node, loadImage: PdfImageLoader, signal: AbortSignal): Promise<string> {
  const images = new Map<Node, string>();
  const cache = new Map<string, { source: string; bytes: number }>();
  const nodes: Node[] = [];
  let imageBytes = 0;
  doc.descendants(node => { if (node.type.name === "image") nodes.push(node); });
  for (const node of nodes) {
    signal.throwIfAborted();
    const key = JSON.stringify([node.attrs.assetId, node.attrs.src]);
    let cached = cache.get(key);
    if (!cached) {
      const image = await loadImage(node, signal);
      signal.throwIfAborted();
      if (!["image/png", "image/jpeg", "image/webp"].includes(image.mediaType)) throw new AppError(415, "Unsupported PDF image");
      cached = { source: `data:${image.mediaType};base64,${image.data.toString("base64")}`, bytes: image.data.byteLength };
      cache.set(key, cached);
    }
    imageBytes += cached.bytes;
    if (imageBytes > 25 * 1024 * 1024) throw new AppError(413, "PDF images exceed 25 MiB combined");
    images.set(node, cached.source);
  }
  function render(node: Node): string {
    if (node.isText) {
      let html = escape(node.text ?? "");
      for (const mark of node.marks) {
        const tag = { bold: "strong", italic: "em", strike: "s", underline: "u", code: "code" }[mark.type.name];
        if (tag) html = `<${tag}>${html}</${tag}>`;
        if (mark.type.name === "link") html = `<a href="${safeLink(mark.attrs.href)}">${html}</a>`;
      }
      return html;
    }
    const children: string[] = [];
    if (node.type.name !== "table") node.forEach(child => children.push(render(child)));
    const body = children.join("");
    switch (node.type.name) {
      case "doc": return body;
      case "paragraph": return `<p>${body || "<br>"}</p>`;
      case "heading": {
        const level = typeof node.attrs.level === "number" ? Math.min(6, Math.max(1, node.attrs.level)) : 2;
        return `<h${level}>${body}</h${level}>`;
      }
      case "blockquote": return `<blockquote>${body}</blockquote>`;
      case "bulletList": return `<ul>${body}</ul>`;
      case "orderedList": return `<ol start="${Number(node.attrs.start) || 1}">${body}</ol>`;
      case "listItem": return `<li>${body}</li>`;
      case "taskList": return `<ul class="tasks">${body}</ul>`;
      case "taskItem": return `<li class="task"><span class="check">${node.attrs.checked ? "&#9745;" : "&#9744;"}</span><div>${body}</div></li>`;
      case "hardBreak": return "<br>";
      case "horizontalRule": return "<hr>";
      case "codeBlock": return `<pre><code>${body}</code></pre>`;
      case "table": {
        const rows: Node[] = [];
        node.forEach(row => rows.push(row));
        const first = rows[0];
        const columns: number[] = [];
        first?.forEach(cell => {
          for (let i = 0; i < cell.attrs.colspan; i++) {
            const width: unknown = cell.attrs.colwidth?.[i];
            columns.push(typeof width === "number" && width > 0 ? width : 100);
          }
        });
        const total = columns.reduce((sum, width) => sum + width, 0);
        const colgroup = columns.length ? `<colgroup>${columns.map(width => `<col style="width:${width / total * 100}%">`).join("")}</colgroup>` : "";
        const header = first && Array.from({ length: first.childCount }, (_, i) => first.child(i)).every(cell => cell.type.name === "tableHeader");
        return `<table>${colgroup}${header && first ? `<thead>${render(first)}</thead>` : ""}<tbody>${rows.slice(header ? 1 : 0).map(render).join("")}</tbody></table>`;
      }
      case "tableRow": return `<tr>${body}</tr>`;
      case "tableHeader":
      case "tableCell": {
        const tag = node.type.name === "tableHeader" ? "th" : "td";
        return `<${tag} colspan="${Number(node.attrs.colspan) || 1}" rowspan="${Number(node.attrs.rowspan) || 1}">${body}</${tag}>`;
      }
      case "image": {
        const width = typeof node.attrs.width === "number" ? `width:${node.attrs.width}px;` : "";
        const align = ["left", "right"].includes(node.attrs.alignment) ? node.attrs.alignment : "center";
        return `<div class="image" style="text-align:${align}"><img src="${images.get(node) ?? ""}" alt="${escape(typeof node.attrs.alt === "string" ? node.attrs.alt : "")}" style="${width}"></div>`;
      }
      default: throw new AppError(400, `PDF export does not support ${node.type.name}`);
    }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#171717;background:#fff;font-family:Arial,"Noto Sans","Noto Sans Devanagari",sans-serif;font-size:11pt;line-height:1.55;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{line-height:1.2;break-after:avoid;margin:1.2em 0 .5em}h1{font-size:24pt}h2{font-size:19pt}h3{font-size:15pt}p{margin:.55em 0;orphans:3;widows:3}a{color:#2457a7;text-decoration:underline}blockquote{border-left:3px solid #aaa;margin:1em 0;padding-left:1em;color:#444}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#f3f3f3;border:1px solid #ddd;padding:10px;font-size:9pt}code{font-family:"Noto Sans Mono",Consolas,monospace;font-size:.9em}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:1em 0}th,td{border:1px solid #aaa;padding:6px;vertical-align:top;overflow-wrap:anywhere}th{background:#f0f0f0;text-align:left}tr{break-inside:avoid}ul,ol{padding-left:1.6em}.tasks{list-style:none;padding-left:0}.task{display:flex;gap:8px}.task>div{flex:1;min-width:0}.check{font-family:"Noto Sans Symbols 2",sans-serif}.image{margin:1em 0;break-inside:avoid}.image img{display:inline-block;max-width:100%;max-height:255mm;height:auto;object-fit:contain}hr{border:0;border-top:1px solid #bbb;margin:1.2em 0}
</style></head><body>${render(doc)}</body></html>`;
}

let exporting = false;

export async function renderDocumentPdf(title: string, doc: Node, loadImage: PdfImageLoader): Promise<Buffer> {
  if (exporting) throw new AppError(503, "Another PDF is exporting. Try again shortly");
  exporting = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => {
    rejectAbort(new Error("PDF export timed out"));
    void browser?.close().catch(() => {});
  };
  controller.signal.addEventListener("abort", abort);
  try {
    const html = await Promise.race([pdfHtml(title, doc, loadImage, controller.signal), aborted]);
    controller.signal.throwIfAborted();
    browser = await chromium.launch({ headless: true, timeout: 15_000 });
    controller.signal.throwIfAborted();
    const page = await browser.newPage({ javaScriptEnabled: false, offline: true });
    await page.route("**/*", route => route.abort());
    await page.setContent(html, { waitUntil: "load", timeout: 10_000 });
    const imagesReady = await page.evaluate(async () => {
      await document.fonts.ready;
      return (await Promise.all(Array.from(document.images, async image => {
        try { await image.decode(); return image.naturalWidth > 0; } catch { return false; }
      }))).every(Boolean);
    });
    if (!imagesReady) throw new AppError(422, "An image could not be rendered. Replace it and try again");
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, controller.signal.aborted ? "PDF export timed out. Try a smaller document" : "PDF export failed. Check images and try again");
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", abort);
    await browser?.close().catch(() => {});
    exporting = false;
  }
}
