import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { useSession } from "../lib/auth-client";
import { useState, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

// ─── Interactive Editor Sandbox ──────────────────────────
function InteractiveSandbox() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const SIMULATED_TYPING = " Collaborative writing is now seamless. You can edit this text right now, format it, or see how fast changes sync. Try typing here!";

  // Helper to update the remote cursor position from the editor's current state.
  // Must be called AFTER insertContentAt since ProseMirror flushes the DOM synchronously.
  const updateCursorPosition = (ed: ReturnType<typeof useEditor>) => {
    if (!ed || ed.isDestroyed || !cursorRef.current) return;
    try {
      // Read the end-of-text position from the *current* (post-insertion) document.
      const endPos = ed.state.doc.content.size - 1;
      // coordsAtPos forces a synchronous layout reflow, so the coordinates
      // reflect the freshly inserted character.
      const coords = ed.view.coordsAtPos(endPos);
      const containerRect = ed.view.dom.getBoundingClientRect();
      
      cursorRef.current.style.top = `${coords.bottom - containerRect.top - 18}px`;
      cursorRef.current.style.left = `${coords.left - containerRect.left}px`;
      cursorRef.current.style.opacity = '1';
    } catch {
      // Ignore if editor is offscreen or not fully rendered
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Start typing...",
      }),
    ],
    content: `<h3>Collaborative Document</h3><p>Welcome to TypeSync. This is a live interactive editor demonstration.</p>`,
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert focus:outline-none min-h-[160px] text-xs leading-relaxed text-text-primary px-4 py-3",
      },
    },
  });

  // Simulated typing effect — insert a character, read cursor coords synchronously,
  // then advance to the next character.
  useEffect(() => {
    if (!editor || editor.isDestroyed || currentCharIndex >= SIMULATED_TYPING.length) return;

    const timer = setTimeout(() => {
      if (editor.isDestroyed) return;
      const char = SIMULATED_TYPING[currentCharIndex];
      const insertPos = editor.state.doc.content.size - 1;
      editor.commands.insertContentAt(insertPos, char);

      // ProseMirror updates the DOM synchronously after dispatch, so
      // coordsAtPos will return accurate post-insertion coordinates now.
      updateCursorPosition(editor);
      setCurrentCharIndex((prev) => prev + 1);
    }, 60 + Math.random() * 80);

    return () => clearTimeout(timer);
  }, [editor, currentCharIndex]);

  const handleContainerClick = () => {
    if (editor) {
      editor.commands.focus();
    }
  };

  return (
    <div 
      onClick={handleContainerClick}
      className="relative border border-border-strong bg-bg-secondary rounded-xl overflow-hidden shadow-sm hover:border-border-accent transition-all cursor-text max-w-2xl mx-auto"
    >
      {/* Tab bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-secondary/40 select-none">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-border-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-border-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-border-strong" />
          <span className="text-[10px] text-text-secondary font-medium ml-1.5">demo_document.md</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-1">
            <span className="w-4.5 h-4.5 rounded-full bg-bg-tertiary border border-border text-[8px] font-bold text-text-primary flex items-center justify-center">Y</span>
            <span className="w-4.5 h-4.5 rounded-full bg-indigo-600 border border-border text-[8px] font-bold text-white flex items-center justify-center">S</span>
          </div>
          <span className="flex items-center gap-1 text-[10px] text-success font-medium">
            <span className="w-1 h-1 rounded-full bg-success animate-pulse" />
            Live
          </span>
        </div>
      </div>

      {/* Editor area */}
      <div className="relative p-2 min-h-[180px] bg-bg-elevated">
        <EditorContent editor={editor} />
        
        {/* Remote Collaborator Cursor */}
        <div
          ref={cursorRef}
          className={`absolute pointer-events-none flex flex-col items-start z-10 transition-all duration-75 ${
            currentCharIndex > 0 && currentCharIndex < SIMULATED_TYPING.length ? "opacity-100" : "opacity-0"
          }`}
          style={{ top: 0, left: 0 }}
        >
          <div className="h-4.5 w-[1.5px] bg-indigo-500 animate-pulse" />
          <div className="text-[8px] font-medium bg-indigo-500 text-white px-1 py-0.25 rounded-sm rounded-tl-none whitespace-nowrap shadow-sm">
            Sarah
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Feature Card ────────────────────────────────────────
function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-lg border border-border bg-bg-secondary hover:border-border-strong hover:bg-bg-hover transition-all">
      <div className="w-8 h-8 rounded-md bg-bg-tertiary border border-border-strong flex items-center justify-center text-text-primary mb-4">
        {icon}
      </div>
      <h3 className="text-xs font-semibold text-text-primary mb-1.5 tracking-tight">{title}</h3>
      <p className="text-xs text-text-secondary leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Step Item ───────────────────────────────────────────
function StepItem({
  index,
  title,
  description,
}: {
  index: string;
  title: string;
  description: string;
}) {
  return (
    <li className="flex gap-4">
      <span className="shrink-0 w-8 h-8 rounded-md bg-bg-tertiary border border-border-strong text-text-primary text-[11px] font-bold flex items-center justify-center">
        {index}
      </span>
      <div>
        <p className="text-xs font-semibold text-text-primary mt-1">{title}</p>
        <p className="text-xs text-text-secondary mt-1 leading-relaxed">{description}</p>
      </div>
    </li>
  );
}

// ─── Icons ───────────────────────────────────────────────
function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconCursor() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3zM13 13l6 6" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function IconFormat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
  );
}

function IconSync() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

// ─── Main Landing Page Component ─────────────────────────
export default function LandingPage() {
  const { data: session } = useSession();

  const [theme, setTheme] = useState(() => {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const primaryCta = session
    ? { label: "Go to dashboard", to: "/dashboard" }
    : { label: "Start writing", to: "/auth/signup" };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary selection:bg-accent-light">
      {/* ─── Navigation Header ────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-border backdrop-blur-md bg-bg-primary/80">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-md bg-accent flex items-center justify-center text-white text-xs font-bold shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
              T
            </span>
            <span className="text-xs font-semibold tracking-tight text-text-primary">TypeSync</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-6">
            <a href="#features" className="text-xs text-text-secondary hover:text-text-primary transition-colors">
              Features
            </a>
            <a href="#workflow" className="text-xs text-text-secondary hover:text-text-primary transition-colors">
              Workflow
            </a>
            <a href="#platform" className="text-xs text-text-secondary hover:text-text-primary transition-colors">
              Platform
            </a>
          </nav>

          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
                  <circle cx="12" cy="12" r="4" strokeWidth="1.5" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
                  <path d="M12 3a9 9 0 1 0 9 9 9.75 9.75 0 0 0-.67-3.42 6.74 6.74 0 0 1-4.91-4.91A9.81 9.81 0 0 0 12 3z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {!session && (
              <Link
                to="/auth/signin"
                className="text-xs text-text-secondary hover:text-text-primary transition-colors px-2 py-1.5"
              >
                Sign in
              </Link>
            )}
            <Link to={primaryCta.to} className="btn-linear-primary text-xs">
              {primaryCta.label}
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero Section ────────────────────────────── */}
      <section className="relative pt-28 pb-16 overflow-hidden">
        <div className="relative max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="max-w-2xl mx-auto"
          >
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-text-primary leading-tight mb-4">
              Write together, in sync.
            </h1>
            <p className="text-xs text-text-secondary leading-relaxed max-w-md mx-auto mb-6">
              A real-time collaborative document editor powered by WebSockets and CRDTs. Minimalist layout, zero configuration, fast sync.
            </p>

            <div className="flex items-center justify-center gap-3 mb-12">
              <Link to={primaryCta.to} className="btn-linear-primary text-xs px-5 py-2">
                {primaryCta.label}
              </Link>
              {!session && (
                <a href="#features" className="btn-linear text-xs px-5 py-2">
                  Learn more
                </a>
              )}
            </div>
          </motion.div>

          {/* Interactive Mockup Container */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-4"
          >
            <InteractiveSandbox />
          </motion.div>
        </div>
      </section>

      {/* ─── Features Grid ───────────────────────────── */}
      <section id="features" className="py-20 border-t border-border bg-bg-secondary/20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center max-w-md mx-auto mb-12">
            <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Features</span>
            <h2 className="text-xl font-bold text-text-primary mt-2 tracking-tight">
              A layout designed for absolute clarity
            </h2>
            <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
              Experience typing and organization stripped of all unnecessary noise.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon={<IconEdit />}
              title="Real-time editing"
              description="Changes sync instantly via socket streams. High concurrency, zero conflicts, zero lag."
            />
            <FeatureCard
              icon={<IconCursor />}
              title="Live cursors"
              description="See where your collaborators are working with custom carets and selection updates."
            />
            <FeatureCard
              icon={<IconUsers />}
              title="Viewer & Editor permissions"
              description="Invite colleagues via email and control document access levels globally."
            />
            <FeatureCard
              icon={<IconDoc />}
              title="Fuzzy-searched library"
              description="Navigate your personal or shared workspace instantly with list view indexing."
            />
            <FeatureCard
              icon={<IconFormat />}
              title="Rich text nodes"
              description="Quickly draft titles, lists, custom code blocks, interactive check tasks, and tables."
            />
            <FeatureCard
              icon={<IconSync />}
              title="CRDT synchronizer"
              description="Yjs handles client state merges algorithmically. Offline changes integrate automatically."
            />
          </div>
        </div>
      </section>

      {/* ─── Workflow Section ────────────────────────── */}
      <section id="workflow" className="py-20 border-t border-border">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Workflow</span>
              <h2 className="text-xl font-bold text-text-primary mt-2 tracking-tight">
                Get teams typing in seconds
              </h2>
              <p className="text-xs text-text-secondary mt-2 mb-8 leading-relaxed">
                We designed the document flow to get your notes organized with minimal setup overhead.
              </p>

              <ol className="space-y-5">
                <StepItem index="01" title="Initialize a draft" description="Press 'New document' inside your dashboard to launch a blank canvas." />
                <StepItem index="02" title="Distribute invitation" description="Share by entering email and toggle permissions instantly." />
                <StepItem index="03" title="Type in harmony" description="Changes stream live with low-latency cursors and characters." />
              </ol>
            </div>

            <div className="rounded-lg border border-border-strong bg-bg-secondary p-6 shadow-sm">
              <h3 className="text-xs font-semibold text-text-primary mb-4 tracking-tight">Technical details</h3>
              <div className="space-y-3">
                {[
                  { label: "Active editors limit", value: "Unlimited" },
                  { label: "Sync roundtrip latency", value: "< 25ms" },
                  { label: "State updates merge", value: "Deterministic CRDT" },
                  { label: "Auth layer", value: "BetterAuth Session" },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-border last:border-0 text-xs">
                    <span className="text-text-secondary">{row.label}</span>
                    <span className="font-medium text-text-primary">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Platform Grid ───────────────────────────── */}
      <section id="platform" className="py-20 border-t border-border bg-bg-secondary/20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Platform</span>
              <h2 className="text-xl font-bold text-text-primary mt-2 tracking-tight">
                Robust, battle-tested internals
              </h2>
              <p className="text-xs text-text-secondary mt-2 leading-relaxed">
                TypeSync is engineered on high-efficiency protocols to protect your documents from dataloss and synchronization bugs.
              </p>
            </div>

            <div className="space-y-3">
              {[
                { title: "Tiptap & ProseMirror", desc: "Rigid structure for rich text AST rendering." },
                { title: "Yjs CRDTs", desc: "Conflict-free replication model for offline edits." },
                { title: "Socket.IO Transport", desc: "Persistent connection tunnel with automatic reconnection." },
                { title: "Drizzle & Postgresql", desc: "Secure relational storage and transaction processing." }
              ].map((item) => (
                <div key={item.title} className="p-4 rounded-lg border border-border bg-bg-secondary flex gap-3.5 items-start">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
                  <div>
                    <h4 className="text-xs font-semibold text-text-primary">{item.title}</h4>
                    <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Action Banner ───────────────────────────── */}
      <section className="py-20 border-t border-border">
        <div className="max-w-5xl mx-auto px-6">
          <div className="rounded-xl border border-border-strong bg-bg-secondary p-10 text-center shadow-sm relative overflow-hidden">
            <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Workspace Access</span>
            <h2 className="text-xl font-bold text-text-primary mt-2 tracking-tight">
              Start writing together
            </h2>
            <p className="text-xs text-text-secondary mt-2 max-w-sm mx-auto leading-relaxed">
              Launch a shared document in seconds. No setups required.
            </p>
            <div className="flex items-center justify-center gap-3 mt-6">
              <Link to={primaryCta.to} className="btn-linear-primary text-xs px-5 py-2">
                {primaryCta.label}
              </Link>
              {!session && (
                <Link to="/auth/signin" className="btn-linear text-xs px-5 py-2">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────── */}
      <footer className="border-t border-border py-10 bg-bg-secondary/10">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-text-primary tracking-tight">TypeSync</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              Minimal collaborative documents for teams.
            </p>
          </div>
          <div className="flex gap-4">
            <a href="#features" className="text-[11px] text-text-muted hover:text-text-secondary transition-colors">
              Features
            </a>
            <a href="#workflow" className="text-[11px] text-text-muted hover:text-text-secondary transition-colors">
              Workflow
            </a>
            <a href="#platform" className="text-[11px] text-text-muted hover:text-text-secondary transition-colors">
              Platform
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
