import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { signOut, useSession } from "../lib/auth-client";
import type { DocumentWithRole, Role } from "@typesync/shared";
import { toggleThemeWithTransition } from "../lib/theme";
import { useConfirm } from "../lib/confirm-context";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";
import { Select } from "./Select";

type SortBy = "updated" | "alphabetical" | "created";

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "updated", label: "Recent" },
  { value: "alphabetical", label: "A-Z" },
  { value: "created", label: "Created" },
];

function isSortBy(value: string): value is SortBy {
  return SORT_OPTIONS.some((option) => option.value === value);
}

type ContextMenuState = {
  id: string;
  title: string;
  role: Role;
  x: number;
  y: number;
};

interface SidebarProps {
  documents: DocumentWithRole[];
  activeDocId?: string;
  isLoading: boolean;
  isCreating?: boolean;
  error?: string | null;
  onRetry?: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onCreateDocument: () => void;
  onDeleteDocument: (id: string) => void;
  onLeaveDocument: (id: string) => void;
  onRenameDocument: (id: string, title: string) => void;
  onCopyLink: (id: string) => void;
  onSelectDocument: (id: string) => void;
  search: string;
  onSearchChange: (query: string) => void;
  onBeforeSignOut?: () => Promise<boolean>;
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
  isCreating = false,
  error,
  onRetry,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onCreateDocument,
  onDeleteDocument,
  onLeaveDocument,
  onRenameDocument,
  onCopyLink,
  onSelectDocument,
  search,
  onSearchChange,
  onBeforeSignOut,
  onClose,
  showCloseButton,
}: SidebarProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: session } = useSession();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const contextMenuTriggerRef = useRef<HTMLElement | null>(null);

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  const [sortBy, setSortBy] = useState<SortBy>("updated");

  const beginRename = (id: string, title: string) => setRenaming({ id, value: title });

  const commitRename = () => {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    const original = documents.find((doc) => doc.id === renaming.id)?.title;
    if (trimmed && trimmed !== original) onRenameDocument(renaming.id, trimmed);
    setRenaming(null);
  };

  const toggleTheme = (e: React.MouseEvent<HTMLButtonElement>) => {
    toggleThemeWithTransition(theme, setTheme, e);
  };

  // Filtering is the server's job now; ordering stays local to the loaded page.
  const sortedDocuments = [...documents].sort((a, b) => {
    if (sortBy === "alphabetical") {
      return a.title.localeCompare(b.title);
    }
    if (sortBy === "created") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const closeContextMenu = () => {
    setContextMenu(null);
    contextMenuTriggerRef.current?.focus();
    contextMenuTriggerRef.current = null;
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu]);

  const openContextMenu = (
    e: React.MouseEvent,
    doc: DocumentWithRole,
    trigger?: HTMLElement
  ) => {
    e.preventDefault();
    const source = trigger ?? (e.currentTarget as HTMLElement);
    const rect = source.getBoundingClientRect();
    contextMenuTriggerRef.current = source;
    setContextMenu({
      id: doc.id,
      title: doc.title,
      role: doc.role,
      x: e.clientX || rect.right,
      y: e.clientY || rect.bottom,
    });
  };

  const confirmDelete = async (id: string, title: string) => {
    const accepted = await confirm({
      title: "Delete document",
      message: `“${title}” will be deleted permanently. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (accepted) onDeleteDocument(id);
  };

  const confirmLeave = async (id: string, title: string) => {
    const accepted = await confirm({
      title: "Leave document",
      message: `“${title}” will be removed from your documents. The owner can share it with you again.`,
      confirmLabel: "Leave",
      tone: "danger",
    });
    if (accepted) onLeaveDocument(id);
  };

  const contextMenuItems = (menu: ContextMenuState): DropdownMenuItem[] => {
    const items: DropdownMenuItem[] = [];

    if (menu.role === "owner" || menu.role === "editor") {
      items.push({
        id: "rename",
        label: "Rename",
        onSelect: () => beginRename(menu.id, menu.title),
      });
    }

    items.push({
      id: "copy-link",
      label: "Copy link",
      onSelect: () => onCopyLink(menu.id),
    });

    items.push(
      menu.role === "owner"
        ? {
            id: "delete",
            label: "Delete",
            tone: "danger",
            onSelect: () => void confirmDelete(menu.id, menu.title),
          }
        : {
            id: "leave",
            label: "Leave document",
            tone: "danger",
            onSelect: () => void confirmLeave(menu.id, menu.title),
          }
    );

    return items;
  };

  const handleSignOut = async () => {
    if (onBeforeSignOut && !(await onBeforeSignOut())) return;
    await signOut();
    navigate("/");
  };

  return (
    <div className="h-full flex flex-col bg-bg-secondary w-[280px] max-w-[85vw]">
      {/* User section */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded bg-bg-tertiary border border-border-strong text-text-primary flex items-center justify-center text-ui font-semibold shrink-0">
              {session?.user?.name?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="min-w-0">
              <p className="text-ui font-semibold text-text-primary truncate">
                {session?.user?.name || "User"}
              </p>
              <p className="text-micro text-text-muted truncate">
                {session?.user?.email}
              </p>
            </div>
          </div>
          {showCloseButton && onClose && (
            <button
              onClick={onClose}
              aria-label="Close sidebar"
              className="touch-target w-7 h-7 rounded hover:bg-bg-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors shrink-0"
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
          disabled={isCreating}
          aria-busy={isCreating}
          className="w-full flex items-center justify-center gap-2 btn-linear-primary disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isCreating ? (
            <span
              className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
              aria-hidden="true"
            />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5">
              <path d="M12 5v14M5 12h14" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          )}
          <span className="text-ui">
            {isCreating ? "Creating…" : "New document"}
          </span>
        </button>
      </div>

      {/* Search & Sort */}
      <div className="px-3 pb-2 flex gap-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search documents…"
          aria-label="Search documents"
          // `min-w-0` because an input carries an intrinsic width that flex-1
          // will not shrink past, which pushed the sort control off the edge.
          className="flex-1 min-w-0 bg-bg-primary border border-border rounded px-2.5 py-1.5 text-ui text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
        />
        <Select
          value={sortBy}
          onChange={(e) => {
            if (isSortBy(e.target.value)) setSortBy(e.target.value);
          }}
          // Same size as the search field beside it: identical padding on a
          // smaller line box made this control shorter than its neighbour.
          className="text-ui text-text-secondary"
          wrapperClassName="shrink-0"
          aria-label="Sort documents"
          title="Sort documents"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-2">
        {isLoading ? (
          // Skeleton rows rather than a spinner: they occupy the shape the list
          // is about to take, so the wait reads as content arriving instead of
          // the app being stuck.
          <div
            className="space-y-0.5 pt-1"
            role="status"
            aria-live="polite"
            aria-label="Loading documents"
          >
            {[0, 1, 2, 3, 4].map((row) => (
              <div
                key={row}
                aria-hidden="true"
                className="flex items-center gap-2.5 px-3 py-2 rounded"
                style={{ opacity: 1 - row * 0.15 }}
              >
                <div className="w-3.5 h-3.5 rounded-sm bg-bg-tertiary animate-pulse shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div
                    className="h-2.5 rounded bg-bg-tertiary animate-pulse"
                    style={{ width: `${72 - row * 9}%` }}
                  />
                  <div className="h-1.5 w-10 rounded bg-bg-tertiary animate-pulse" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading documents…</span>
          </div>
        ) : error ? (
          <div className="p-4 text-center">
            <p className="text-ui text-error mb-3 leading-relaxed">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="btn-linear-primary text-ui px-3 py-1.5"
              >
                Try again
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {sortedDocuments.length === 0 ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-meta text-text-muted text-center py-8"
              >
                {search ? "No documents found" : "No documents yet"}
              </motion.p>
            ) : (
              sortedDocuments.map((doc) => (
                <motion.div
                  key={doc.id}
                  layout
                  onContextMenu={(e) => openContextMenu(e, doc)}
                  className={`w-full rounded text-ui transition-[background-color,border-color,color,box-shadow,opacity] flex items-center gap-1 group border ${
                    doc.id === activeDocId
                      ? "bg-bg-elevated border-border-strong text-text-primary font-medium shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
                      : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                >
                  {renaming?.id === doc.id ? (
                    <input
                      autoFocus
                      value={renaming.value}
                      aria-label={`Rename ${doc.title}`}
                      onChange={(event) =>
                        setRenaming({ id: doc.id, value: event.target.value })
                      }
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRename();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRenaming(null);
                        }
                      }}
                      className="flex-1 min-w-0 mx-2 my-1 rounded border border-border-accent bg-bg-primary px-2 py-1 text-ui text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-light"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectDocument(doc.id)}
                      className="touch-target flex-1 min-w-0 text-left px-3 py-2 rounded text-ui transition-colors flex items-center gap-2.5"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className={`w-3.5 h-3.5 shrink-0 mt-0.5 align-top transition-colors ${
                        doc.id === activeDocId ? "text-accent" : "text-text-muted opacity-50 group-hover:text-text-primary group-hover:opacity-100"
                      }`}>
                        <path d="M4 6h10l6 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className={`truncate text-ui ${doc.id === activeDocId ? "text-accent font-semibold" : "text-text-primary"}`}>{doc.title}</p>
                        <p className="text-micro text-text-muted">
                          {formatRelativeTime(doc.updatedAt)}
                        </p>
                      </div>
                      {doc.role !== "owner" && (
                        <span className="text-micro font-medium px-1 py-0.5 rounded bg-bg-tertiary text-text-muted border border-border-strong shrink-0">
                          {doc.role}
                        </span>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Actions for ${doc.title}`}
                    aria-expanded={contextMenu?.id === doc.id}
                    aria-haspopup="menu"
                    onClick={(event) => openContextMenu(event, doc, event.currentTarget)}
                    className="touch-target shrink-0 px-2 py-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                  >
                    <span aria-hidden="true" className="text-display leading-none">⋯</span>
                  </button>
                </motion.div>
              ))
            )}
            {hasMore && (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="w-full mt-2 px-3 py-2 rounded text-meta font-medium text-text-secondary border border-border hover:bg-bg-hover hover:text-text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {contextMenu && (
          <DropdownMenu
            label={`Actions for ${contextMenu.title}`}
            items={contextMenuItems(contextMenu)}
            onClose={closeContextMenu}
            className="fixed"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 200),
              top: Math.min(contextMenu.y, window.innerHeight - 160),
            }}
          />
        )}
      </AnimatePresence>

      {/* Footer / Theme Toggle & Sign out */}
      <div className="p-3 border-t border-border flex items-center justify-between gap-2">
        <button
          onClick={handleSignOut}
          className="flex-1 text-left px-3 py-1.5 rounded text-ui text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors font-medium"
        >
          Sign out
        </button>
        <button
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="touch-target w-7 h-7 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer shrink-0"
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
