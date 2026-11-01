import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { z } from "zod";
import { imageAssetUrl, type ImageUploads } from "../lib/image-uploads";

const ImageAttributes = z.object({
  src: z.string(), assetId: z.string().nullable().optional(), alt: z.string().nullable().optional(),
  width: z.number().positive().nullable().optional(), height: z.number().positive().nullable().optional(),
  alignment: z.enum(["left", "center", "right"]).default("center"),
});

type ImageSource =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error" };

const alignments: readonly ("left" | "center" | "right")[] = ["left", "center", "right"];

export function DocumentImage({
  node, editor, selected, updateAttributes, deleteNode, getPos, documentId, uploads,
}: NodeViewProps & { documentId: string; uploads: ImageUploads }) {
  const attrs = ImageAttributes.parse(node.attrs);
  const [source, setSource] = useState<ImageSource>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const resizeRef = useRef<{ x: number; width: number; max: number; preview: number | null } | null>(null);
  const subscribeEditability = useCallback((listener: () => void) => {
    editor.on("update", listener);
    return () => { editor.off("update", listener); };
  }, [editor]);
  const canEdit = useSyncExternalStore(subscribeEditability, () => editor.isEditable);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    if (!attrs.assetId) {
      setSource({ kind: "ready", url: attrs.src });
      return;
    }
    setSource({ kind: "loading" });
    void fetch(imageAssetUrl(documentId, attrs.assetId), { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Image unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSource({ kind: "ready", url: objectUrl });
      })
      .catch(() => { if (!controller.signal.aborted) setSource({ kind: "error" }); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, attrs.assetId, attrs.src, attempt]);

  const setWidth = (fraction: number) => {
    if (!editor.isEditable) return;
    const style = getComputedStyle(editor.view.dom);
    const available = editor.view.dom.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    updateAttributes({ width: Math.max(48, Math.round(available * fraction)) });
  };

  return (
    <NodeViewWrapper className={`document-image${selected ? " is-selected" : ""}`} data-alignment={attrs.alignment} contentEditable={false}>
      <div className="document-image-frame" style={{ width: previewWidth ?? attrs.width ?? "auto" }}>
        {source.kind === "ready" ? (
          <img
            ref={imageRef}
            src={source.url}
            alt={attrs.alt ?? ""}
            draggable={false}
            onClick={() => { const position = getPos(); if (typeof position === "number") editor.commands.setNodeSelection(position); }}
            onError={() => setSource({ kind: "error" })}
          />
        ) : (
          <div className="document-image-placeholder" role="status">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="24" height="24" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
              <circle cx="8" cy="8" r="1.5" strokeWidth="1.5" />
              <path d="m4 18 6-6 4 4 3-3 4 4" strokeWidth="1.5" />
            </svg>
            <span>{source.kind === "loading" ? "Loading image" : "Image could not load"}</span>
            {attrs.alt && <span className="text-text-muted">{attrs.alt}</span>}
            {source.kind === "error" && <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
          </div>
        )}
        {selected && canEdit && source.kind === "ready" && (
          <button
            type="button"
            className="image-resize-handle"
            aria-label="Resize image. Use the image width buttons for keyboard resizing."
            title="Drag to resize image"
            onPointerDown={event => {
              if (!editor.isEditable || !imageRef.current) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const style = getComputedStyle(editor.view.dom);
              resizeRef.current = { x: event.clientX, width: imageRef.current.getBoundingClientRect().width, max: editor.view.dom.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), preview: null };
            }}
            onPointerMove={event => {
              const resize = resizeRef.current;
              if (resize) {
                resize.preview = Math.round(Math.max(48, Math.min(resize.max, resize.width + event.clientX - resize.x)));
                setPreviewWidth(resize.preview);
              }
            }}
            onPointerUp={event => {
              if (!resizeRef.current) return;
              if (editor.isEditable && resizeRef.current.preview !== null) updateAttributes({ width: resizeRef.current.preview });
              resizeRef.current = null;
              setPreviewWidth(null);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { resizeRef.current = null; setPreviewWidth(null); }}
          />
        )}
      </div>
      {selected && canEdit && (
        <div className="image-controls" role="group" aria-label="Image controls">
          <div className="image-controls-row">
            <span className="image-controls-label">Width</span>
            <button type="button" onClick={() => setWidth(0.25)} aria-label="Set image width to 25 percent">25%</button>
            <button type="button" onClick={() => setWidth(0.5)} aria-label="Set image width to 50 percent">50%</button>
            <button type="button" onClick={() => setWidth(1)} aria-label="Set image width to 100 percent">100%</button>
            <span className="image-controls-label">Align</span>
            {alignments.map(alignment => (
              <button key={alignment} type="button" aria-label={`Align image ${alignment}`} aria-pressed={attrs.alignment === alignment} onClick={() => { if (editor.isEditable) updateAttributes({ alignment }); }}>{alignment[0]?.toUpperCase()}{alignment.slice(1)}</button>
            ))}
          </div>
          <label className="image-alt-label">
            <span>Alt text</span>
            <input
              key={`${attrs.assetId ?? attrs.src}-${attrs.alt ?? ""}`}
              type="text"
              defaultValue={attrs.alt ?? ""}
              placeholder="Describe the image for screen readers"
              maxLength={2000}
              onBlur={event => { if (editor.isEditable && event.target.value !== attrs.alt) updateAttributes({ alt: event.target.value }); }}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
            />
          </label>
          <div className="image-controls-row">
            <button type="button" onClick={() => { const position = getPos(); if (typeof position === "number") uploads.choose(position, node); }}>Replace image</button>
            <button type="button" className="image-remove" onClick={() => { if (editor.isEditable) deleteNode(); }}>Remove image</button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}
