import { Link } from "react-router";
import { motion } from "motion/react";
import { lazy, Suspense, useState } from "react";
import { useSession } from "../lib/auth-client";
import { Logo } from "../components/Logo";
import { toggleThemeWithTransition } from "../lib/theme";
import { BackendReadinessStatus } from "../components/BackendReadinessStatus";

// The editor is the heaviest thing on the page and nothing above it depends
// on it, so the hero paints before it arrives.
const LandingEditorDemo = lazy(() =>
  import("../components/LandingEditorDemo").then((module) => ({
    default: module.LandingEditorDemo,
  }))
);

const FEATURES = [
  {
    title: "Write together, live",
    description:
      "Everyone sees the same document as it changes, with each person's cursor where they are working. No refreshing, no taking turns, no reconciling two versions afterwards.",
  },
  {
    title: "Decide who does what",
    description:
      "Invite people to edit or only to read, and change your mind whenever you like. Access updates straight away for anyone already in the document.",
  },
  {
    title: "Everything a draft needs",
    description:
      "Headings, lists, checklists, quotes, tables, code and images. Type / to insert any of them without reaching for the toolbar.",
  },
  {
    title: "Saves itself",
    description:
      "Your work is kept as you write. If your connection drops, the editor carries on and catches up when it comes back.",
  },
];

function DemoFallback() {
  return (
    <div
      className="overflow-hidden rounded-md border border-border-strong bg-bg-elevated shadow-sm"
      aria-hidden="true"
    >
      <div className="h-9 border-b border-border bg-bg-secondary/40" />
      <div className="space-y-3 px-8 py-10">
        <div className="h-5 w-1/3 animate-pulse rounded bg-bg-tertiary" />
        <div className="h-3 w-full animate-pulse rounded bg-bg-tertiary" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-bg-tertiary" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-bg-tertiary" />
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { data: session } = useSession();

  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  const toggleTheme = (event: React.MouseEvent<HTMLButtonElement>) => {
    toggleThemeWithTransition(theme, setTheme, event);
  };

  const primaryCta = session
    ? { label: "Go to dashboard", to: "/dashboard" }
    : { label: "Start writing", to: "/auth/signup" };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary selection:bg-accent-light">
      <header className="fixed top-0 inset-x-0 z-40 border-b border-border backdrop-blur-md bg-bg-primary/80">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <Logo className="w-7 h-7 shadow-[0_1px_2px_rgba(0,0,0,0.08)]" />
            <span className="text-ui font-semibold tracking-tight text-text-primary">
              TypeSync
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="touch-target w-8 h-8 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              {theme === "dark" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
                  <circle cx="12" cy="12" r="4" strokeWidth="1.5" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {!session && (
              <Link
                to="/auth/signin"
                className="text-ui text-text-secondary hover:text-text-primary transition-colors px-2 py-1.5"
              >
                Sign in
              </Link>
            )}
            <Link to={primaryCta.to} className="btn-linear-primary">
              {primaryCta.label}
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="px-6 pt-28 pb-14">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="max-w-2xl mx-auto text-center"
          >
            <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-tight leading-[1.15] mb-5">
              Write together,{" "}
              <span className="font-serif italic font-normal text-accent">
                in sync.
              </span>
            </h1>
            <p className="text-title text-text-secondary leading-relaxed max-w-lg mx-auto mb-8">
              A shared writing space for people who need to work on the same
              document at the same time.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link to={primaryCta.to} className="btn-linear-primary px-5 py-2">
                {primaryCta.label}
              </Link>
              {!session && (
                <Link to="/auth/signin" className="btn-linear px-5 py-2">
                  Sign in
                </Link>
              )}
            </div>

            <BackendReadinessStatus className="mx-auto mt-8 max-w-md" />
          </motion.div>
        </section>

        {/* Demo */}
        <section className="px-6 pb-20">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="max-w-3xl mx-auto"
          >
            <p className="mb-3 text-center text-meta font-medium uppercase tracking-wider text-text-muted">
              Try it right here
            </p>
            <Suspense fallback={<DemoFallback />}>
              <LandingEditorDemo />
            </Suspense>
            <p className="mt-3 text-center text-meta text-text-muted">
              Nothing you type here is saved or shared.
            </p>
          </motion.div>
        </section>

        {/* Features */}
        <section className="border-t border-border bg-bg-secondary/30 px-6 py-20">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-center font-serif text-3xl font-bold tracking-tight mb-3">
              Built for documents with more than one author
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-center text-ui text-text-secondary leading-relaxed">
              The awkward parts of writing with other people, handled.
            </p>

            <div className="grid gap-6 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-md border border-border-strong bg-bg-elevated p-6"
                >
                  <h3 className="text-title font-semibold tracking-tight mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-ui text-text-secondary leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="px-6 py-20 text-center">
          <h2 className="font-serif text-3xl font-bold tracking-tight mb-4">
            Start your first document
          </h2>
          <p className="mx-auto mb-8 max-w-md text-ui text-text-secondary leading-relaxed">
            Free to use. Create an account and invite whoever you are writing
            with.
          </p>
          <Link to={primaryCta.to} className="btn-linear-primary px-5 py-2">
            {primaryCta.label}
          </Link>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Logo className="w-5 h-5" />
            <span className="text-ui font-semibold tracking-tight">TypeSync</span>
          </div>
          <p className="text-meta text-text-muted">
            © {new Date().getFullYear()} TypeSync
          </p>
        </div>
      </footer>
    </div>
  );
}
