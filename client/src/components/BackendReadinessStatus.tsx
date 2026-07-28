import {
  useBackendReadiness,
  type BackendReadinessStatus as ReadinessStatus,
} from "../lib/backend-readiness-context";

const statusContent: Record<
  ReadinessStatus,
  { title: string; description: string; color: string }
> = {
  waking: {
    title: "Starting the server",
    description:
      "TypeSync is waking up. This can take up to a minute on the free service.",
    color: "bg-accent",
  },
  ready: {
    title: "Server ready",
    description: "You can sign in or create an account.",
    color: "bg-success",
  },
  delayed: {
    title: "Still waking up",
    description:
      "The server is taking longer than usual. We’re retrying automatically.",
    color: "bg-warning",
  },
  unavailable: {
    title: "Server unavailable",
    description:
      "We couldn’t reach the server. Check your connection, then try again.",
    color: "bg-error",
  },
};

type BackendReadinessStatusProps = {
  className?: string;
  id?: string;
};

export function BackendReadinessStatus({
  className = "",
  id,
}: BackendReadinessStatusProps) {
  const { status, retry } = useBackendReadiness();
  const content = statusContent[status];
  const isWaiting = status === "waking" || status === "delayed";

  return (
    <div
      id={id}
      className={`flex items-start gap-2.5 rounded border border-border-strong bg-bg-secondary px-3 py-2.5 text-left ${className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        className={`mt-1.5 block h-2 w-2 shrink-0 rounded-full ${content.color} ${
          isWaiting ? "animate-pulse" : ""
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold leading-5 text-text-primary">
          {content.title}
        </p>
        <p className="text-xs leading-5 text-text-muted">
          {content.description}
        </p>
      </div>
      {status === "unavailable" ? (
        <button
          type="button"
          onClick={retry}
          className="btn-linear shrink-0 text-xs"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
