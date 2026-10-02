import { useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import { getAuthDestination, getAuthPath } from "@typesync/shared";
import { useSession } from "../lib/auth-client";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Starts loading the guarded route's chunk alongside the session check.
   * Without it `lazy` cannot begin the download until `isPending` clears, so
   * the chunk queues behind a full round trip to the backend for no reason.
   */
  prefetch?: () => Promise<unknown>;
}

export function ProtectedRoute({ children, prefetch }: ProtectedRouteProps) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  useEffect(() => {
    // A failure here is not actionable: `lazy` retries the import when it
    // renders, and surfaces the error through the router's error boundary.
    void prefetch?.().catch(() => {});
  }, [prefetch]);

  if (isPending) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-3 bg-bg-primary"
        role="status"
        aria-live="polite"
      >
        <div
          className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
        <span className="text-ui font-medium text-text-secondary">
          Checking your session…
        </span>
      </div>
    );
  }

  if (!session?.user.emailVerified) {
    const destination = getAuthDestination(location.pathname + location.search + location.hash);
    return <Navigate to={getAuthPath({ mode: "signin", destination })} replace />;
  }

  return <>{children}</>;
}
