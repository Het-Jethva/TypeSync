import type { Editor as TiptapEditor } from "@tiptap/react";
import { apiBaseUrl } from "./backend-url";

export type ExportFormat = "html" | "txt" | "json";

const MIME_TYPES: Record<ExportFormat, string> = {
  html: "text/html",
  txt: "text/plain",
  json: "application/json",
};

function toFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "untitled";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function exportPdf(editor: TiptapEditor, title: string, documentId: string, signal: AbortSignal): Promise<void> {
  const snapshot = JSON.stringify({ title, content: editor.getJSON() });
  const response = await fetch(`${apiBaseUrl}/documents/${encodeURIComponent(documentId)}/pdf`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: snapshot,
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error : "PDF export failed. Try again");
  }
  const pdf = await response.blob();
  signal.throwIfAborted();
  downloadBlob(pdf, `${toFileName(title)}.pdf`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function exportHtml(editor: TiptapEditor, title: string): string {
  const html = new DOMParser().parseFromString(editor.getHTML(), "text/html");
  for (const image of html.querySelectorAll("img")) {
    const source = image.getAttribute("src");
    if (source?.startsWith("/")) image.src = new URL(source, window.location.origin).href;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${html.body.innerHTML}</body></html>`;
}

/**
 * Downloads the document in the requested format. Named after the document
 * rather than its id, since the id means nothing in a downloads folder.
 */
export function exportDocument(
  editor: TiptapEditor,
  title: string,
  format: ExportFormat
): void {
  const content =
    format === "html"
      ? exportHtml(editor, title)
      : format === "json"
        ? JSON.stringify(editor.getJSON(), null, 2)
        : editor.getText();

  downloadBlob(new Blob([content], { type: MIME_TYPES[format] }), `${toFileName(title)}.${format}`);
}
