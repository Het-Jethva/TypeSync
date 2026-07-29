import type { DocumentStatus } from "../lib/document-status";

type Tone = "ok" | "busy" | "warning" | "error";

const TONE_STYLES: Record<Tone, { dot: string; text: string }> = {
  ok: { dot: "bg-success", text: "text-text-muted" },
  busy: { dot: "bg-warning animate-pulse", text: "text-text-secondary" },
  warning: { dot: "bg-warning", text: "text-warning" },
  error: { dot: "bg-error", text: "text-error" },
};

/**
 * Problems outrank progress, and progress outranks rest, so the pill always
 * reports the most consequential thing true about the document.
 */
function describe(
  status: DocumentStatus | null,
  isRenaming: boolean
): { tone: Tone; label: string; detail?: string } {
  if (!status) {
    return isRenaming
      ? { tone: "busy", label: "Saving" }
      : { tone: "ok", label: "Synced" };
  }

  const { syncStatus, hasPendingUpdates, documentSizeStatus, syncError, isSyncBlocked } =
    status;

  if (syncStatus === "failed") {
    return isSyncBlocked
      ? {
          tone: "error",
          label: "Sync blocked",
          detail: syncError ?? "Changes are still pending.",
        }
      : { tone: "error", label: "Sync failed", detail: "Retrying…" };
  }

  if (documentSizeStatus?.level === "limit") {
    return {
      tone: "error",
      label:
        documentSizeStatus.reason === "update"
          ? "Edit too large"
          : "Size limit reached",
    };
  }

  if (documentSizeStatus?.level === "warning") {
    return { tone: "warning", label: "Nearing size limit" };
  }

  if (syncStatus === "offline") {
    return {
      tone: "warning",
      label: hasPendingUpdates ? "Offline, changes pending" : "Offline",
    };
  }

  if (syncStatus === "syncing" || hasPendingUpdates || isRenaming) {
    return { tone: "busy", label: "Saving" };
  }

  return { tone: "ok", label: "Synced" };
}

interface DocumentStatusPillProps {
  status: DocumentStatus | null;
  /** A title rename in flight, reported in the same vocabulary as content. */
  isRenaming: boolean;
}

export function DocumentStatusPill({ status, isRenaming }: DocumentStatusPillProps) {
  const { tone, label, detail } = describe(status, isRenaming);
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
