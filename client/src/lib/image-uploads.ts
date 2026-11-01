import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { z } from "zod";
import { apiBaseUrl } from "./backend-url";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AssetResponse = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mediaType: z.string(),
  }),
});

type UploadStatus =
  | { kind: "queued" }
  | { kind: "uploading"; progress: number }
  | { kind: "error"; message: string; retryable: boolean };

export type ImageUpload = {
  id: string;
  name: string;
  status: UploadStatus;
};

type UploadJob = ImageUpload & {
  batchId: string;
  file: File;
  position: number;
  replacement: ProseMirrorNode | null;
  request: XMLHttpRequest | null;
};

export function imageAssetUrl(documentId: string, assetId: string): string {
  return `${apiBaseUrl}/documents/${encodeURIComponent(documentId)}/assets/${encodeURIComponent(assetId)}`;
}

export class ImageUploads {
  private editor: Editor | null = null;
  private jobs: UploadJob[] = [];
  private listeners = new Set<() => void>();
  private snapshot: ImageUpload[] = [];
  private running = false;
  private pickers = new Set<() => void>();

  constructor(private readonly documentId: string) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  private publish() {
    this.snapshot = this.jobs.map(({ id, name, status }) => ({ id, name, status }));
    this.listeners.forEach(listener => listener());
  }

  private mapPositions = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return;
    for (const job of [...this.jobs]) {
      const mapped = transaction.mapping.mapResult(job.position, 1);
      if (mapped.deletedAcross) this.cancel(job.id);
      else job.position = mapped.pos;
    }
  };

  bind(editor: Editor) {
    this.editor = editor;
    editor.on("transaction", this.mapPositions);
    return () => {
      editor.off("transaction", this.mapPositions);
      this.editor = null;
      this.cancelAll();
    };
  }

  choose(position?: number, replacement: ProseMirrorNode | null = null) {
    const editor = this.editor;
    if (!editor?.isEditable || editor.isDestroyed) return;
    let insertionPosition = position ?? editor.state.selection.from;
    let active = true;
    const mapPosition = ({ transaction }: { transaction: Transaction }) => {
      const mapped = transaction.mapping.mapResult(insertionPosition, 1);
      insertionPosition = mapped.pos;
      if (mapped.deletedAcross) release();
    };
    const release = () => {
      active = false;
      editor.off("transaction", mapPosition);
      this.pickers.delete(release);
    };
    this.pickers.add(release);
    editor.on("transaction", mapPosition);
    chooseImageFiles(files => {
      const canInsert = active && this.editor === editor && editor.isEditable && !editor.isDestroyed;
      release();
      if (canInsert) this.insert(files, insertionPosition, replacement);
    }, replacement === null);
  }

  insert(files: readonly File[], position?: number, replacement: ProseMirrorNode | null = null) {
    const editor = this.editor;
    if (!editor?.isEditable || editor.isDestroyed) return;
    const batchId = crypto.randomUUID();
    for (const file of files) {
      const error = !IMAGE_ACCEPT.split(",").includes(file.type)
        ? "Choose a PNG, JPEG, or WebP image."
        : file.size > MAX_IMAGE_BYTES ? "Choose an image smaller than 10 MiB." : null;
      this.jobs.push({
        id: crypto.randomUUID(), batchId, name: file.name || "Pasted image", file,
        position: position ?? editor.state.selection.from, replacement,
        request: null,
        status: error ? { kind: "error", message: error, retryable: false } : { kind: "queued" },
      });
    }
    this.publish();
    void this.run();
  }

  retry(id: string) {
    const job = this.jobs.find(item => item.id === id);
    if (!job || job.file.size > MAX_IMAGE_BYTES || !IMAGE_ACCEPT.split(",").includes(job.file.type)) return;
    job.status = { kind: "queued" };
    this.publish();
    void this.run();
  }

  cancel(id: string) {
    const job = this.jobs.find(item => item.id === id);
    this.jobs = this.jobs.filter(item => item.id !== id);
    job?.request?.abort();
    this.publish();
  }

  cancelAll() {
    for (const release of [...this.pickers]) release();
    for (const job of [...this.jobs]) this.cancel(job.id);
  }

  private upload(job: UploadJob): Promise<z.infer<typeof AssetResponse>["data"]> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      job.request = request;
      request.open("POST", `${apiBaseUrl}/documents/${encodeURIComponent(this.documentId)}/assets`);
      request.withCredentials = true;
      request.setRequestHeader("Content-Type", job.file.type);
      request.timeout = 60_000;
      request.upload.onprogress = event => {
        job.status = { kind: "uploading", progress: event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0 };
        this.publish();
      };
      request.onload = () => {
        let payload: unknown;
        try { payload = JSON.parse(request.responseText); }
        catch { reject(new Error("The server returned an invalid response. Retry the upload.")); return; }
        const parsed = AssetResponse.safeParse(payload);
        if (request.status >= 200 && request.status < 300 && parsed.success) resolve(parsed.data.data);
        else {
          const error = z.object({ error: z.string() }).safeParse(payload);
          reject(new Error(error.success ? error.data.error : "Image upload failed. Retry the upload."));
        }
      };
      request.onerror = () => reject(new Error("Could not reach the server. Retry the upload."));
      request.ontimeout = () => reject(new Error("The upload timed out. Retry the upload."));
      request.onabort = () => reject(new Error("Upload cancelled."));
      request.send(job.file);
    });
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.jobs.find(item => item.status.kind === "queued");
        if (!job) break;
        const editor = this.editor;
        if (!editor?.isEditable || editor.isDestroyed) { this.cancelAll(); break; }
        job.status = { kind: "uploading", progress: 0 };
        this.publish();
        try {
          const asset = await this.upload(job);
          if (!this.jobs.includes(job) || this.editor !== editor || editor.isDestroyed || !editor.isEditable) continue;
          const attrs = {
            src: imageAssetUrl(this.documentId, asset.id), assetId: asset.id,
            alt: job.replacement?.attrs.alt ?? "", title: null,
            width: Math.min(asset.width, 640), height: asset.height, alignment: job.replacement?.attrs.alignment ?? "center",
          };
          if (job.replacement) {
            const node = editor.state.doc.nodeAt(job.position);
            if (node?.type.name === "image" && node.eq(job.replacement)) {
              this.jobs = this.jobs.filter(item => item !== job);
              editor.view.dispatch(editor.state.tr.setNodeMarkup(job.position, undefined, attrs));
            } else {
              throw new Error("The image changed during upload. Dismiss this upload and replace the image again.");
            }
          } else {
            const laterJobs = this.jobs.slice(this.jobs.indexOf(job) + 1).filter(item => item.batchId === job.batchId);
            this.jobs = this.jobs.filter(item => item !== job);
            editor.commands.insertContentAt(Math.min(job.position, editor.state.doc.content.size), { type: "image", attrs });
            editor.state.doc.descendants((node, position) => {
              if (node.type.name === "image" && node.attrs.assetId === asset.id) {
                for (const later of laterJobs) later.position = position + node.nodeSize;
              }
            });
          }
          this.publish();
        } catch (error) {
          if (this.jobs.includes(job)) {
            job.status = { kind: "error", message: error instanceof Error ? error.message : "Image upload failed. Retry the upload.", retryable: !job.replacement || editor.state.doc.nodeAt(job.position)?.eq(job.replacement) === true };
            this.publish();
          }
        }
      }
    } finally { this.running = false; }
  }
}

export function chooseImageFiles(onChoose: (files: File[]) => void, multiple = true) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = IMAGE_ACCEPT;
  input.multiple = multiple;
  input.onchange = () => onChoose(Array.from(input.files ?? []));
  input.oncancel = () => onChoose([]);
  input.click();
}
