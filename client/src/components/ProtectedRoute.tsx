import { Navigate } from "react-router";
import { useSession } from "../lib/auth-client";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { data: session, isPending } = useSession();

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
        <span className="text-xs font-medium text-text-secondary">
          Checking your session…
        </span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth/signin" replace />;
  }

  return <>{children}</>;
}
