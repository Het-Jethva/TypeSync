import type { Editor as TiptapEditor } from "@tiptap/react";

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      ? `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${editor.getHTML()}</body></html>`
      : format === "json"
        ? JSON.stringify(editor.getJSON(), null, 2)
        : editor.getText();

  const url = URL.createObjectURL(
    new Blob([content], { type: MIME_TYPES[format] })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${toFileName(title)}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
