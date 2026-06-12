import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { signOut, useSession } from "../lib/auth-client";
import type { Document } from "@typesync/shared";

interface SidebarProps {
  documents: (Document & { role: string })[];
  activeDocId?: string;
  isLoading: boolean;
  onCreateDocument: () => void;
  onDeleteDocument: (id: string) => void;
  onSelectDocument: (id: string) => void;
}

export function Sidebar({
  documents,
  activeDocId,
  isLoading,
  onCreateDocument,
  onDeleteDocument,
  onSelectDocument,
}: SidebarProps) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

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

  const filtered = documents.filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleContextMenu = (e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    setContextMenu({ id: docId, x: e.clientX, y: e.clientY });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="h-full flex flex-col bg-bg-secondary w-[280px]">
      {/* User section */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-bg-tertiary border border-border-strong text-text-primary flex items-center justify-center text-xs font-semibold shrink-0">
            {session?.user?.name?.charAt(0).toUpperCase() || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-text-primary truncate">
              {session?.user?.name || "User"}
            </p>
            <p className="text-[10px] text-text-muted truncate mt-0.5">
              {session?.user?.email}
            </p>
          </div>
        </div>
      </div>

      {/* New document button */}
      <div className="p-3">
        <button
          onClick={onCreateDocument}
          className="w-full flex items-center justify-center gap-2 btn-linear-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5">
            <path d="M12 5v14M5 12h14" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span className="text-xs">New document</span>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search documents..."
          className="w-full bg-bg-primary border border-border rounded-md px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-all"
        />
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-2">
        {isLoading ? (
          <div className="p-4 flex justify-center">
            <div className="w-5 h-5 border-2 border-border-strong border-t-accent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[11px] text-text-muted text-center py-8"
          >
            {search ? "No documents found" : "No documents yet"}
          </motion.p>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((doc) => (
              <motion.button
                key={doc.id}
                layout
                onClick={() => onSelectDocument(doc.id)}
                onContextMenu={(e) => handleContextMenu(e, doc.id)}
                className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-all flex items-center gap-2.5 group border ${
                  doc.id === activeDocId
                    ? "bg-bg-elevated border-border-strong text-text-primary font-medium shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                    : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5 shrink-0 opacity-50">
                  <path d="M4 6h10l6 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="truncate flex-1">{doc.title}</span>
                {doc.role !== "owner" && (
                  <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-bg-tertiary text-text-muted border border-border-strong shrink-0">
                    {doc.role}
                  </span>
                )}
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className="fixed z-50 bg-bg-elevated border border-border-strong rounded-lg shadow-md py-1 min-w-[160px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => {
                  onDeleteDocument(contextMenu.id);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-error hover:bg-error/10 transition-colors font-medium"
              >
                Delete document
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Footer / Theme Toggle & Sign out */}
      <div className="p-3 border-t border-border flex items-center justify-between gap-2">
        <button
          onClick={handleSignOut}
          className="flex-1 text-left px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors font-medium"
        >
          Sign out
        </button>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
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
      </div>
    </div>
  );
}
