import { Link } from "react-router-dom";
import { motion, useScroll, useTransform } from "motion/react";
import { useSession } from "../lib/auth-client";
import { useRef } from "react";

// ─── Animated Section Wrapper ────────────────────────────
function FadeUp({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Feature Card ────────────────────────────────────────
function FeatureCard({
  icon,
  title,
  description,
  accent = false,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent?: boolean;
}) {
  return (
    <motion.article
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`relative p-6 rounded-2xl border transition-colors ${
        accent
          ? "border-accent/30 bg-accent/5"
          : "border-white/[0.06] bg-white/[0.02]"
      } hover:border-white/[0.12] hover:bg-white/[0.04]`}
    >
      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-secondary leading-relaxed">
        {description}
      </p>
    </motion.article>
  );
}

// ─── Step Item ───────────────────────────────────────────
function StepItem({
  index,
  title,
  description,
  delay,
}: {
  index: string;
  title: string;
  description: string;
  delay: number;
}) {
  return (
    <FadeUp delay={delay}>
      <li className="flex gap-5">
        <span className="shrink-0 w-10 h-10 rounded-xl bg-accent/10 text-accent text-sm font-bold flex items-center justify-center">
          {index}
        </span>
        <div>
          <p className="font-semibold text-text-primary">{title}</p>
          <p className="text-sm text-text-secondary mt-1">{description}</p>
        </div>
      </li>
    </FadeUp>
  );
}

// ─── Icons ───────────────────────────────────────────────
function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
      <path d="M12 3v18M5 12h14" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconSync() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
      <path d="M4 12a8 8 0 0 1 14.93-4M20 12a8 8 0 0 1-14.93 4" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M20 4v4h-4M4 20v-4h4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
      <circle cx="9" cy="7" r="3" strokeWidth="1.5" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.5" strokeWidth="1.5" />
      <path d="M21 21v-1.5a3 3 0 0 0-2-2.83" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconCursor() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
      <path d="M5 3l14 8-6 2-2 6z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
      <path d="M4 6h10l6 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 6v6h6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconFormat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
      <path d="M6 4v16M10 4H4M10 20H4M14 12l4-8 4 8M15 10h6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────
export default function LandingPage() {
  const { data: session } = useSession();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  const primaryCta = session
    ? { label: "Go to dashboard", to: "/dashboard" }
    : { label: "Start writing", to: "/auth/signup" };

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* ─── Header ──────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-border backdrop-blur-xl bg-bg-primary/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white text-sm font-bold">
              T
            </span>
            <span className="text-lg font-bold text-text-primary">TypeSync</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
              Features
            </a>
            <a href="#workflow" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
              Workflow
            </a>
            <a href="#platform" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
              Platform
            </a>
          </nav>

          <div className="flex items-center gap-3">
            {!session && (
              <Link
                to="/auth/signin"
                className="text-sm text-text-secondary hover:text-text-primary transition-colors px-3 py-1.5"
              >
                Sign in
              </Link>
            )}
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Link
                to={primaryCta.to}
                className="text-sm font-medium bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg transition-colors"
              >
                {primaryCta.label}
              </Link>
            </motion.div>
          </div>
        </div>
      </header>

      {/* ─── Hero ────────────────────────────────────── */}
      <section ref={heroRef} className="relative pt-32 pb-20 overflow-hidden">
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
          }}
        />

        {/* Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-accent/8 rounded-full blur-[120px]" />

        <motion.div
          style={{ y: heroY, opacity: heroOpacity }}
          className="relative max-w-6xl mx-auto px-6"
        >
          <div className="max-w-3xl mx-auto text-center">
            <FadeUp>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent/20 bg-accent/5 text-accent text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Real-time collaborative editing
              </span>
            </FadeUp>

            <FadeUp delay={0.1}>
              <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6">
                Write together,{" "}
                <span className="bg-gradient-to-r from-accent via-purple-400 to-indigo-400 bg-clip-text text-transparent">
                  in sync
                </span>
              </h1>
            </FadeUp>

            <FadeUp delay={0.2}>
              <p className="text-lg text-text-secondary max-w-xl mx-auto mb-8 leading-relaxed">
                TypeSync is a collaborative document editor with live cursors,
                rich formatting, and instant sync powered by WebSockets and CRDTs.
              </p>
            </FadeUp>

            <FadeUp delay={0.3}>
              <div className="flex items-center justify-center gap-4">
                <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                  <Link
                    to={primaryCta.to}
                    className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-medium px-6 py-3 rounded-xl transition-colors text-sm"
                  >
                    {primaryCta.label}
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </Link>
                </motion.div>
                {!session && (
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                    <a
                      href="#features"
                      className="inline-flex items-center gap-2 border border-border-strong text-text-secondary hover:text-text-primary font-medium px-6 py-3 rounded-xl transition-colors text-sm"
                    >
                      Learn more
                    </a>
                  </motion.div>
                )}
              </div>
            </FadeUp>
          </div>

          {/* ─── Editor Mockup ──────────────────────── */}
          <FadeUp delay={0.4} className="mt-16 max-w-4xl mx-auto">
            <div className="relative rounded-2xl border border-border bg-bg-secondary overflow-hidden shadow-2xl shadow-black/40">
              {/* Title bar */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-bg-tertiary/50">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500/60" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <span className="w-3 h-3 rounded-full bg-green-500/60" />
                </div>
                <span className="text-xs text-text-muted ml-2">Product Brief — Sprint 12</span>
                <div className="ml-auto flex items-center gap-2">
                  <div className="flex -space-x-1.5">
                    <span className="w-5 h-5 rounded-full bg-violet-500 border-2 border-bg-tertiary text-[9px] font-bold text-white flex items-center justify-center">A</span>
                    <span className="w-5 h-5 rounded-full bg-emerald-500 border-2 border-bg-tertiary text-[9px] font-bold text-white flex items-center justify-center">N</span>
                    <span className="w-5 h-5 rounded-full bg-amber-500 border-2 border-bg-tertiary text-[9px] font-bold text-white flex items-center justify-center">R</span>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-success">
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                    Synced
                  </span>
                </div>
              </div>

              {/* Content area */}
              <div className="p-8 min-h-[280px]">
                <div className="space-y-4">
                  <div className="h-8 w-64 bg-white/[0.06] rounded-lg" />
                  <div className="h-4 w-full bg-white/[0.04] rounded" />
                  <div className="h-4 w-5/6 bg-white/[0.04] rounded" />
                  <div className="h-4 w-full bg-white/[0.04] rounded" />
                  <div className="h-4 w-3/4 bg-white/[0.04] rounded" />
                  <div className="mt-6 h-4 w-48 bg-white/[0.06] rounded-lg" />
                  <div className="h-4 w-full bg-white/[0.04] rounded" />
                  <div className="h-4 w-2/3 bg-white/[0.04] rounded relative">
                    {/* Fake cursor */}
                    <motion.span
                      className="absolute right-0 top-0 h-full w-0.5 bg-emerald-400"
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                    <span className="absolute -top-5 right-0 text-[10px] font-semibold bg-emerald-500 text-white px-1.5 py-0.5 rounded">
                      NK
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </FadeUp>
        </motion.div>
      </section>

      {/* ─── Features ────────────────────────────────── */}
      <section id="features" className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <FadeUp>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <span className="text-xs font-medium text-accent uppercase tracking-widest">Features</span>
              <h2 className="text-3xl md:text-4xl font-bold mt-3 tracking-tight">
                Everything you need to write together
              </h2>
              <p className="text-text-secondary mt-4">
                Create documents, invite collaborators, and edit in real-time with a focused, modern editor.
              </p>
            </div>
          </FadeUp>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FadeUp delay={0.05}>
              <FeatureCard
                icon={<IconEdit />}
                title="Real-time editing"
                description="Changes sync instantly via WebSockets and CRDTs. No refresh, no conflicts, no lag."
              />
            </FadeUp>
            <FadeUp delay={0.1}>
              <FeatureCard
                icon={<IconCursor />}
                title="Live cursors"
                description="See exactly where your collaborators are typing with colored cursors and selections."
                accent
              />
            </FadeUp>
            <FadeUp delay={0.15}>
              <FeatureCard
                icon={<IconUsers />}
                title="Team sharing"
                description="Invite by email with viewer or editor roles. Full control over who can access and edit."
              />
            </FadeUp>
            <FadeUp delay={0.2}>
              <FeatureCard
                icon={<IconDoc />}
                title="Document library"
                description="All your documents organized in one sidebar. Search, filter, and jump between drafts."
              />
            </FadeUp>
            <FadeUp delay={0.25}>
              <FeatureCard
                icon={<IconFormat />}
                title="Rich formatting"
                description="Headings, lists, code blocks, tables, images, tasks — powered by Tiptap and ProseMirror."
              />
            </FadeUp>
            <FadeUp delay={0.3}>
              <FeatureCard
                icon={<IconSync />}
                title="CRDT sync"
                description="Built on Yjs conflict-free data types. Edits merge automatically, even offline."
              />
            </FadeUp>
          </div>
        </div>
      </section>

      {/* ─── Workflow ────────────────────────────────── */}
      <section id="workflow" className="py-24 bg-bg-secondary/50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <FadeUp>
                <span className="text-xs font-medium text-accent uppercase tracking-widest">Workflow</span>
                <h2 className="text-3xl md:text-4xl font-bold mt-3 tracking-tight">
                  From draft to shared workspace in minutes
                </h2>
                <p className="text-text-secondary mt-4 mb-10">
                  A simple three-step flow to get your team writing together.
                </p>
              </FadeUp>

              <ol className="space-y-6">
                <StepItem index="01" title="Create a document" description="Name a new doc and start writing immediately." delay={0.1} />
                <StepItem index="02" title="Invite collaborators" description="Share by email and assign viewer or editor roles." delay={0.2} />
                <StepItem index="03" title="Edit in sync" description="Everyone sees changes live with colored cursors." delay={0.3} />
              </ol>
            </div>

            <FadeUp delay={0.2}>
              <div className="rounded-2xl border border-border bg-bg-secondary p-8">
                <h3 className="text-lg font-semibold text-text-primary mb-6">Collaboration rhythm</h3>
                <div className="space-y-4">
                  {[
                    { label: "Active editors", value: "3" },
                    { label: "Sync latency", value: "<50ms" },
                    { label: "Conflict resolution", value: "Automatic" },
                    { label: "Last update", value: "Now" },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                      <span className="text-sm text-text-secondary">{row.label}</span>
                      <span className="text-sm font-medium text-text-primary">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 pt-6 border-t border-border">
                  <p className="text-sm text-text-muted">
                    TypeSync uses Yjs CRDTs over WebSockets to keep documents consistent in real-time — no polling, no merge conflicts.
                  </p>
                </div>
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* ─── Platform ────────────────────────────────── */}
      <section id="platform" className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeUp>
              <span className="text-xs font-medium text-accent uppercase tracking-widest">Platform</span>
              <h2 className="text-3xl md:text-4xl font-bold mt-3 tracking-tight">
                Built on modern, open-source technology
              </h2>
              <p className="text-text-secondary mt-4">
                A carefully chosen stack for performance, reliability, and developer experience.
              </p>
            </FadeUp>

            <FadeUp delay={0.15}>
              <div className="space-y-4">
                {[
                  {
                    title: "Tiptap + ProseMirror",
                    desc: "A powerful, extensible rich-text editor with full formatting support.",
                  },
                  {
                    title: "Yjs CRDTs",
                    desc: "Conflict-free replicated data types for seamless real-time collaboration.",
                  },
                  {
                    title: "Socket.IO",
                    desc: "Reliable WebSocket transport with auto-reconnection and room support.",
                  },
                  {
                    title: "PostgreSQL + Drizzle",
                    desc: "Persistent storage with type-safe queries and automatic migrations.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="flex gap-4 p-4 rounded-xl border border-border bg-bg-secondary/50 hover:bg-bg-tertiary/50 transition-colors"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      className="w-5 h-5 text-accent shrink-0 mt-0.5"
                    >
                      <path d="M5 12l4 4 10-10" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div>
                      <p className="font-semibold text-text-primary text-sm">{item.title}</p>
                      <p className="text-sm text-text-secondary mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* ─── CTA ─────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <FadeUp>
            <div className="relative rounded-3xl border border-accent/20 bg-gradient-to-br from-accent/10 via-bg-secondary to-bg-secondary p-12 md:p-16 text-center overflow-hidden">
              <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-accent/5 rounded-full blur-[100px]" />
              <div className="relative">
                <span className="text-xs font-medium text-accent uppercase tracking-widest">Ready to write</span>
                <h2 className="text-3xl md:text-4xl font-bold mt-3 tracking-tight">
                  Bring your team into sync
                </h2>
                <p className="text-text-secondary mt-4 max-w-md mx-auto">
                  Create a document, share the link, and start collaborating in real-time.
                </p>
                <div className="flex items-center justify-center gap-4 mt-8">
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                    <Link
                      to={primaryCta.to}
                      className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-medium px-6 py-3 rounded-xl transition-colors text-sm"
                    >
                      {primaryCta.label}
                    </Link>
                  </motion.div>
                  {!session && (
                    <Link
                      to="/auth/signin"
                      className="text-sm text-text-secondary hover:text-text-primary transition-colors px-4 py-3"
                    >
                      Sign in
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────── */}
      <footer className="border-t border-border py-12">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="font-bold text-text-primary">TypeSync</p>
            <p className="text-xs text-text-muted mt-1">
              Real-time documents for focused teams.
            </p>
          </div>
          <div className="flex gap-6">
            <a href="#features" className="text-xs text-text-muted hover:text-text-secondary transition-colors">
              Features
            </a>
            <a href="#workflow" className="text-xs text-text-muted hover:text-text-secondary transition-colors">
              Workflow
            </a>
            <a href="#platform" className="text-xs text-text-muted hover:text-text-secondary transition-colors">
              Platform
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
