import { Routes, Route, Navigate } from "react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { BackendReadinessProvider } from "./lib/backend-readiness";
import { ConfirmProvider } from "./lib/confirm";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));

// Named so it can be handed to ProtectedRoute as a prefetch. Dynamic imports
// are cached by specifier, so calling it early and letting `lazy` call it again
// resolves to the same module promise rather than a second download.
const importDashboardPage = () => import("./pages/DashboardPage");
const DashboardPage = lazy(importDashboardPage);

function LoadingFallback() {
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
        Loading TypeSync…
      </span>
    </div>
  );
}

export default function App() {
  return (
    <BackendReadinessProvider>
      <ConfirmProvider>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth/:mode" element={<AuthPage />} />
            <Route
              path="/auth"
              element={<Navigate to="/auth/signin" replace />}
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute prefetch={importDashboardPage}>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/document/:id"
              element={
                <ProtectedRoute prefetch={importDashboardPage}>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ConfirmProvider>
    </BackendReadinessProvider>
  );
}
