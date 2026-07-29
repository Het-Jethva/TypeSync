import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useParams, Link, Navigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { signIn, signUp, useSession } from "../lib/auth-client";
import { Logo } from "../components/Logo";
import { BackendReadinessStatus } from "../components/BackendReadinessStatus";
import { useBackendReadiness } from "../lib/backend-readiness-context";

export default function AuthPage() {
  const navigate = useNavigate();
  const { mode } = useParams();
  const { data: session, isPending: isSessionPending, refetch } = useSession();
  const { status: backendStatus } = useBackendReadiness();

  const isSignIn = mode !== "signup";
  const isBackendReady = backendStatus === "ready";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Clear errors on mode change
  useEffect(() => {
    setError("");
    setName("");
    setEmail("");
    setPassword("");
  }, [mode]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isBackendReady) {
      return;
    }

    if (!email.includes("@") || !email.includes(".")) {
      setError("Please enter a valid email address");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!isSignIn && !name.trim()) {
      setError("Please enter your name");
      return;
    }

    setIsLoading(true);

    try {
      if (isSignIn) {
        const result = await signIn.email(
          { email, password },
          { disableSignal: true },
        );
        if (result.error) {
          setError(result.error.message || "Invalid credentials");
          return;
        }
      } else {
        const result = await signUp.email(
          { name, email, password },
          { disableSignal: true },
        );
        if (result.error) {
          setError(result.error.message || "Sign up failed");
          return;
        }
      }

      await refetch();
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      setError(err.message || "Authentication failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSessionPending) {
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

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-sm"
      >
        <div className="rounded border border-border-strong bg-bg-elevated p-8 shadow-md">
          {/* Header */}
          <div className="text-center mb-8">
            <Link to="/" className="inline-flex items-center gap-2 mb-6">
              <Logo className="w-7 h-7 shadow-[0_1px_2px_rgba(0,0,0,0.08)]" />
              <span className="text-sm font-semibold tracking-tight text-text-primary">TypeSync</span>
            </Link>

            <AnimatePresence mode="wait">
              <motion.div
                key={isSignIn ? "signin" : "signup"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <h1 className="text-lg font-bold text-text-primary tracking-tight">
                  {isSignIn ? "Welcome back" : "Create your account"}
                </h1>
                <p className="text-xs text-text-muted mt-1.5">
                  {isSignIn
                    ? "Sign in to access your documents"
                    : "Get started with TypeSync for free"}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          <BackendReadinessStatus
            id="backend-readiness-status"
            className="mb-4"
          />

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 px-3 py-2 rounded bg-error/5 border border-error/20 text-error text-xs"
                role="alert"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <AnimatePresence>
              {!isSignIn && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <label htmlFor="name" className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
                    placeholder="Your name"
                    disabled={isLoading}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label htmlFor="email" className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
                placeholder="you@example.com"
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
                placeholder="••••••••"
                required
                disabled={isLoading}
                minLength={8}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !isBackendReady}
              aria-describedby="backend-readiness-status"
              className="w-full btn-linear-primary py-2 mt-2 flex items-center justify-center gap-2 text-xs"
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  <span>Processing...</span>
                </span>
              ) : !isBackendReady ? (
                backendStatus === "unavailable" ? (
                  "Server unavailable"
                ) : (
                  "Waiting for server…"
                )
              ) : isSignIn ? (
                "Sign in"
              ) : (
                "Create account"
              )}
            </button>
          </form>

          {/* Toggle */}
          <div className="mt-6 text-center text-xs text-text-muted">
            {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
            <Link
              to={isSignIn ? "/auth/signup" : "/auth/signin"}
              className="text-accent hover:text-accent-hover font-semibold transition-colors"
            >
              {isSignIn ? "Sign up" : "Sign in"}
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
