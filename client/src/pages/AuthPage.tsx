import { useState, useLayoutEffect, useRef, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams, Link, Navigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { signIn, signUp, sendVerificationEmail, useSession } from "../lib/auth-client";
import { Logo } from "../components/Logo";
import { BackendReadinessStatus } from "../components/BackendReadinessStatus";
import { SessionStatus } from "../components/SessionStatus";
import { useBackendReadiness } from "../lib/backend-readiness-context";
import { errorMessage } from "../lib/error-message";
import { getAuthDestination, getAuthPath } from "@typesync/shared";

export default function AuthPage() {
  const navigate = useNavigate();
  const { mode } = useParams();
  const [searchParams] = useSearchParams();
  const destination = getAuthDestination(searchParams.get("next"));
  const signInPath = getAuthPath({ mode: "signin", destination });
  const verificationCallbackURL = new URL(signInPath, window.location.origin).href;
  const { data: session, isPending: isSessionPending, error: sessionError, refetch } = useSession();
  const { status: backendStatus } = useBackendReadiness();

  const isSignIn = mode !== "signup";
  const isBackendReady = backendStatus === "ready";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [verificationResent, setVerificationResent] = useState(false);
  const requestGeneration = useRef(0);
  const pendingEmail = verificationEmail;

  useLayoutEffect(() => {
    requestGeneration.current += 1;
    setError("");
    setName("");
    setEmail("");
    setPassword("");
    setVerificationEmail(null);
    setVerificationResent(false);
    setIsLoading(false);
    return () => {
      requestGeneration.current += 1;
    };
  }, [mode, destination]);

  const dismissVerification = () => {
    requestGeneration.current += 1;
    setVerificationEmail(null);
    setVerificationResent(false);
    setError("");
    setIsLoading(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
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

    const generation = ++requestGeneration.current;
    setIsLoading(true);

    try {
      if (isSignIn) {
        const result = await signIn.email(
          { email, password, callbackURL: new URL(destination, window.location.origin).href },
          { disableSignal: true },
        );
        if (generation !== requestGeneration.current) return;
        if (result.error) {
          if (result.error.code === "EMAIL_NOT_VERIFIED") {
            setVerificationEmail(email);
          }
          setError(result.error.message || "Invalid credentials");
          return;
        }
      } else {
        const result = await signUp.email(
          { name, email, password, callbackURL: verificationCallbackURL },
          { disableSignal: true },
        );
        if (generation !== requestGeneration.current) return;
        if (result.error) {
          setError(result.error.message || "Sign up failed");
          return;
        }
        setVerificationEmail(email);
        setPassword("");
        return;
      }

      await refetch();
      if (generation !== requestGeneration.current) return;
      navigate(destination, { replace: true });
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      setError(errorMessage(err, "Authentication failed. Please try again."));
    } finally {
      if (generation === requestGeneration.current) setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!pendingEmail || !isBackendReady || isLoading) return;
    setError("");
    setVerificationResent(false);
    const generation = ++requestGeneration.current;
    setIsLoading(true);
    try {
      const result = await sendVerificationEmail({ email: pendingEmail, callbackURL: verificationCallbackURL });
      if (generation !== requestGeneration.current) return;
      if (result.error) {
        setError(result.error.message || "Could not send verification email. Try again.");
        return;
      }
      setVerificationResent(true);
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      setError(errorMessage(err, "Could not send verification email. Try again."));
    } finally {
      if (generation === requestGeneration.current) setIsLoading(false);
    }
  };

  if (isSessionPending || (!session && sessionError)) {
    return <SessionStatus failed={Boolean(sessionError)} refetch={refetch} />;
  }

  if (session?.user.emailVerified) {
    return <Navigate to={destination} replace />;
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
              <span className="text-title font-semibold tracking-tight text-text-primary">TypeSync</span>
            </Link>

            <AnimatePresence mode="wait">
              <motion.div
                key={isSignIn ? "signin" : "signup"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <h1 className="text-display font-bold text-text-primary tracking-tight">
                  {isSignIn ? "Welcome back" : "Create your account"}
                </h1>
                <p className="text-ui text-text-muted mt-1.5">
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

          {!pendingEmail && searchParams.has("error") && (
            <p role="alert" className="mb-4 text-ui text-error">
              Verification failed. Sign in to request a fresh verification email.
            </p>
          )}
          {!pendingEmail && !searchParams.has("error") && searchParams.get("verified") === "1" && (
            <p role="status" className="mb-4 text-ui text-text-secondary">
              Email verified. Sign in to continue.
            </p>
          )}

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 px-3 py-2 rounded bg-error/5 border border-error/20 text-error text-ui"
                role="alert"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          {pendingEmail ? (
            <div className="space-y-4">
              <div role="status" className="text-ui text-text-secondary">
                <h2 className="font-semibold text-text-primary mb-2">Check your email</h2>
                <p>Open the verification link sent to {pendingEmail}, then sign in. The link expires in one hour.</p>
                {verificationResent && <p className="mt-2">Verification email sent again.</p>}
              </div>
              <button type="button" onClick={() => void handleResend()}
                disabled={isLoading || !isBackendReady}
                className="w-full btn-linear-primary py-2 text-ui">
                {isLoading ? "Sending…" : "Resend verification email"}
              </button>
              <Link to={signInPath} onClick={dismissVerification}
                className="block text-center text-ui text-accent">
                Back to sign in
              </Link>
            </div>
          ) : <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <AnimatePresence>
              {!isSignIn && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <label htmlFor="name" className="block text-micro font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-ui text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
                    placeholder="Your name"
                    disabled={isLoading}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label htmlFor="email" className="block text-micro font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-ui text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
                placeholder="you@example.com"
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-micro font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-ui text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
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
              className="w-full btn-linear-primary py-2 mt-2 flex items-center justify-center gap-2 text-ui"
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
          </form>}

          {/* Toggle */}
          <div className="mt-6 text-center text-ui text-text-muted">
            {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
            <Link
              to={getAuthPath({ mode: isSignIn ? "signup" : "signin", destination })}
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
