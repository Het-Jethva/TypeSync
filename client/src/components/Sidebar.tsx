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
  onClose?: () => void;
  showCloseButton?: boolean;
}

function formatRelativeTime(dateStr: string | Date): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function Sidebar({
  documents,
  activeDocId,
  isLoading,
  onCreateDocument,
  onDeleteDocument,
  onSelectDocument,
  onClose,
  showCloseButton,
}: SidebarProps) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const [theme, setTheme] = useState(() => {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  const [sortBy, setSortBy] = useState<"updated" | "alphabetical" | "created">("updated");

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

  const sortedAndFiltered = documents
    .filter((d) => d.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "alphabetical") {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "created") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const handleContextMenu = (e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    setContextMenu({ id: docId, x: e.clientX, y: e.clientY });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="h-full flex flex-col bg-bg-secondary w-[280px] max-w-[85vw]">
      {/* User section */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded bg-bg-tertiary border border-border-strong text-text-primary flex items-center justify-center text-xs font-semibold shrink-0">
              {session?.user?.name?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text-primary truncate">
                {session?.user?.name || "User"}
              </p>
              <p className="text-[10px] text-text-muted truncate">
                {session?.user?.email}
              </p>
            </div>
          </div>
          {showCloseButton && onClose && (
            <button
              onClick={onClose}
              className="w-7 h-7 rounded hover:bg-bg-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors shrink-0"
              title="Close sidebar"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
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

      {/* Search & Sort */}
      <div className="px-3 pb-2 flex gap-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="flex-1 bg-bg-primary border border-border rounded px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-all"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="bg-bg-primary border border-border rounded px-2 py-1.5 text-[10px] text-text-secondary focus:outline-none focus:border-border-accent cursor-pointer shrink-0"
          title="Sort documents"
        >
          <option value="updated">Recent</option>
          <option value="alphabetical">A-Z</option>
          <option value="created">Created</option>
        </select>
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-2">
        {isLoading ? (
          <div className="p-4 flex justify-center">
            <div className="w-5 h-5 border-2 border-border-strong border-t-accent rounded-full animate-spin" />
          </div>
        ) : sortedAndFiltered.length === 0 ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[11px] text-text-muted text-center py-8"
          >
            {search ? "No documents found" : "No documents yet"}
          </motion.p>
        ) : (
          <div className="space-y-0.5">
            {sortedAndFiltered.map((doc) => (
              <motion.button
                key={doc.id}
                layout
                onClick={() => onSelectDocument(doc.id)}
                onContextMenu={(e) => handleContextMenu(e, doc.id)}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-all flex items-center gap-2.5 group border ${
                  doc.id === activeDocId
                    ? "bg-bg-elevated border-border-strong text-text-primary font-medium shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
                    : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={`w-3.5 h-3.5 shrink-0 mt-0.5 align-top transition-colors ${
                  doc.id === activeDocId ? "text-accent" : "text-text-muted opacity-50 group-hover:text-text-primary group-hover:opacity-100"
                }`}>
                  <path d="M4 6h10l6 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className={`truncate text-xs ${doc.id === activeDocId ? "text-accent font-semibold" : "text-text-primary"}`}>{doc.title}</p>
                  <p className="text-[9px] text-text-muted">
                    {formatRelativeTime(doc.updatedAt)}
                  </p>
                </div>
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
              className="fixed z-50 bg-bg-elevated border border-border-strong rounded shadow-md py-1 min-w-[160px]"
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
          className="flex-1 text-left px-3 py-1.5 rounded text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors font-medium"
        >
          Sign out
        </button>
        <button
          onClick={toggleTheme}
          className="w-7 h-7 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer shrink-0"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
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
      </div>
    </div>
  );
}
