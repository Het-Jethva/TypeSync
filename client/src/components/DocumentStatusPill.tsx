import {
  describeDocumentStatus,
  type DocumentStatus,
  type DocumentStatusTone,
} from "../lib/document-status";

const TONE_STYLES: Record<DocumentStatusTone, { dot: string; text: string }> = {
  ok: { dot: "bg-success", text: "text-text-muted" },
  busy: { dot: "bg-warning animate-pulse", text: "text-text-secondary" },
  warning: { dot: "bg-warning", text: "text-warning" },
  error: { dot: "bg-error", text: "text-error" },
};

interface DocumentStatusPillProps {
  status: DocumentStatus | null;
  /** A title rename in flight, reported in the same vocabulary as content. */
  isRenaming: boolean;
}

export function DocumentStatusPill({ status, isRenaming }: DocumentStatusPillProps) {
  const { tone, label, detail } = describeDocumentStatus(status, isRenaming);
  const styles = TONE_STYLES[tone];

  return (
    <div className="flex items-center gap-2 min-w-0 shrink-0">
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        title={detail}
        className={`inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-micro font-medium ${styles.text}`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`}
        />
        <span className="truncate">{label}</span>
      </span>

      {status?.isSyncBlocked && (
        <button
          type="button"
          onClick={status.recover}
          className="shrink-0 text-micro font-medium text-error underline underline-offset-2 hover:text-error/80"
        >
          Discard and reload
        </button>
      )}
    </div>
  );
}
