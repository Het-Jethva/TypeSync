import {
  useBackendReadiness,
  type BackendReadinessStatus as ReadinessStatus,
} from "../lib/backend-readiness-context";

const statusContent: Record<
  ReadinessStatus,
  { title: string; description: string; color: string }
> = {
  waking: {
    title: "Getting things ready",
    description: "This takes up to a minute the first time.",
    color: "bg-accent",
  },
  ready: {
    title: "Ready",
    description: "Sign in or create an account to start writing.",
    color: "bg-success",
  },
  delayed: {
    title: "Almost there",
    description: "This is taking a little longer than usual. Still trying.",
    color: "bg-warning",
  },
  unavailable: {
    title: "Can’t connect",
    description: "Check your connection, then try again.",
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
        <p className="text-ui font-semibold leading-5 text-text-primary">
          {content.title}
        </p>
        <p className="text-ui leading-5 text-text-muted">
          {content.description}
        </p>
      </div>
      {status === "unavailable" ? (
        <button
          type="button"
          onClick={retry}
          className="btn-linear shrink-0 text-ui"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
