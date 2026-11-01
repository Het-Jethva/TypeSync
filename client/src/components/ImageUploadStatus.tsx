import { useSyncExternalStore } from "react";
import type { ImageUploads } from "../lib/image-uploads";

export function ImageUploadStatus({ uploads }: { uploads: ImageUploads }) {
  const jobs = useSyncExternalStore(uploads.subscribe, uploads.getSnapshot);
  if (!jobs.length) return null;
  return (
    <div className="image-upload-status" aria-label="Image uploads" aria-live="polite">
      {jobs.map(job => (
        <div key={job.id} className="image-upload-row">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{job.name}</p>
            {job.status.kind === "error"
              ? <p className="text-error" role="alert">{job.status.message}</p>
              : <p className="text-text-muted">{job.status.kind === "queued" ? "Waiting to upload" : job.status.progress === 100 ? "Processing image" : `Uploading ${job.status.progress}%`}</p>}
          </div>
          {job.status.kind === "error" && job.status.retryable && <button type="button" onClick={() => uploads.retry(job.id)}>Retry</button>}
          <button type="button" onClick={() => uploads.cancel(job.id)}>{job.status.kind === "error" ? "Dismiss" : "Cancel"}</button>
        </div>
      ))}
    </div>
  );
}
