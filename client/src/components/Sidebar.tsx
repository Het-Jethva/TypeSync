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
          <div className="w-8 h-8 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-sm font-bold shrink-0">
            {session?.user?.name?.charAt(0).toUpperCase() || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary truncate">
              {session?.user?.name || "User"}
            </p>
            <p className="text-xs text-text-muted truncate">
              {session?.user?.email}
            </p>
          </div>
        </div>
      </div>

      {/* New document button */}
      <div className="p-3">
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={onCreateDocument}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/15 transition-colors text-sm font-medium"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
            <path d="M12 5v14M5 12h14" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          New document
        </motion.button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search documents..."
          className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/30 transition-colors"
        />
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-2">
        {isLoading ? (
          <div className="p-4 flex justify-center">
            <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-text-muted text-center py-8"
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
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 group ${
                  doc.id === activeDocId
                    ? "bg-accent/10 text-accent"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 shrink-0 opacity-50">
                  <path d="M4 6h10l6 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="truncate flex-1">{doc.title}</span>
                {doc.role !== "owner" && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.06] text-text-muted shrink-0">
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
              className="fixed z-50 bg-bg-elevated border border-border rounded-lg shadow-xl py-1 min-w-[160px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => {
                  onDeleteDocument(contextMenu.id);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors"
              >
                Delete document
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Sign out */}
      <div className="p-3 border-t border-border">
        <button
          onClick={handleSignOut}
          className="w-full text-left px-3 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
