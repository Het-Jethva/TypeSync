import { useBackendReadiness } from "../lib/backend-readiness-context";
import { BackendReadinessStatus } from "./BackendReadinessStatus";

export function SessionStatus({
  failed,
  refetch,
}: {
  failed: boolean;
  refetch: () => Promise<void>;
}) {
  const { status, retry } = useBackendReadiness();
  const retrySession = () => {
    retry();
    void refetch();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-bg-primary px-4">
      {status !== "ready" ? (
        <BackendReadinessStatus className="w-full max-w-sm" onRetry={retrySession} />
      ) : failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 text-ui text-text-secondary">
          <p>Couldn’t check your session. Check your connection, then try again.</p>
          <button type="button" onClick={retrySession} className="btn-linear text-ui">
            Try again
          </button>
        </div>
      ) : (
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
          <div
            className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
          <span className="text-ui font-medium text-text-secondary">Checking your session…</span>
        </div>
      )}
    </div>
  );
}
