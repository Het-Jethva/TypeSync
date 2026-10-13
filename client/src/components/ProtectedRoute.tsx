import { useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import { getAuthDestination, getAuthPath } from "@typesync/shared";
import { useSession } from "../lib/auth-client";
import { SessionStatus } from "./SessionStatus";

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
  const { data: session, isPending, error, refetch } = useSession();
  const location = useLocation();

  useEffect(() => {
    // A failure here is not actionable: `lazy` retries the import when it
    // renders, and surfaces the error through the router's error boundary.
    void prefetch?.().catch(() => {});
  }, [prefetch]);

  if (isPending || (!session && error)) {
    return <SessionStatus failed={Boolean(error)} refetch={refetch} />;
  }

  if (!session?.user.emailVerified) {
    const destination = getAuthDestination(location.pathname + location.search + location.hash);
    return <Navigate to={getAuthPath({ mode: "signin", destination })} replace />;
  }

  return <>{children}</>;
}
