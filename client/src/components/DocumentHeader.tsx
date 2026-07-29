import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

import { ShareModal } from "./ShareModal";
import { CollaboratorPresence } from "./CollaboratorPresence";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";
import { exportDocument } from "../lib/export-document";
import type { DocumentWithRole } from "@typesync/shared";
import type { Editor as TiptapEditor } from "@tiptap/react";

interface DocumentHeaderProps {
  document: DocumentWithRole;
  editor: TiptapEditor | null;
  onRename: (title: string) => Promise<void>;
  onDocumentUpdate: () => void;
  activeCollaborators: { name: string; color: string }[];
}

export function DocumentHeader({
  document,
  editor,
  onRename,
  onDocumentUpdate,
  activeCollaborators,
}: DocumentHeaderProps) {

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");

  const documentMenuItems: DropdownMenuItem[] = [
    {
      id: "export-html",
      label: "Download as HTML",
      disabled: !editor,
      onSelect: () => editor && exportDocument(editor, document.title, "html"),
    },
    {
      id: "export-txt",
      label: "Download as text",
      disabled: !editor,
      onSelect: () => editor && exportDocument(editor, document.title, "txt"),
    },
    {
      id: "export-json",
      label: "Download as JSON",
      disabled: !editor,
      onSelect: () => editor && exportDocument(editor, document.title, "json"),
    },
  ];

  useEffect(() => {
    setTitle(document.title);
  }, [document.id, document.title]);

  const handleBlur = async () => {
    const trimmedTitle = title.trim();
    setIsEditing(false);

    if (!trimmedTitle || trimmedTitle === document.title) {
      setTitle(document.title);
      return;
    }

    setSaveStatus("saving");
    try {
      await onRename(trimmedTitle);
    } catch {
      setTitle(document.title);
    } finally {
      setSaveStatus("saved");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      setTitle(document.title);
      setIsEditing(false);
    }
  };

  const canEdit = document.role === "owner" || document.role === "editor";

  return (
    <>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Title */}
        {isEditing && canEdit ? (
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
            className="bg-bg-primary border border-border rounded-md px-2 py-0.5 text-ui font-semibold text-text-primary outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light min-w-0 max-w-[120px] sm:max-w-[300px] transition-[background-color,border-color,color,box-shadow]"
          />
        ) : canEdit ? (
          <button
            onClick={() => setIsEditing(true)}
            className="text-ui font-semibold text-text-primary truncate hover:text-accent transition-colors px-1 max-w-[100px] sm:max-w-[300px]"
            title="Click to rename"
          >
            {document.title}
          </button>
        ) : (
          <span
            className="text-ui font-semibold text-text-primary truncate px-1 max-w-[100px] sm:max-w-[300px]"
            title={document.title}
          >
            {document.title}
          </span>
        )}

        {/* Save status */}
        <AnimatePresence>
          {saveStatus === "saving" && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="status"
              aria-live="polite"
              className="flex items-center gap-1.5 text-meta font-medium text-text-secondary shrink-0"
            >
              <span
                className="w-2.5 h-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin"
                aria-hidden="true"
              />
              Saving…
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <CollaboratorPresence collaborators={activeCollaborators} />

        {document.role === "owner" && (
          <button
            onClick={() => setShareOpen(true)}
            aria-label="Share document"
            className="touch-target btn-linear flex items-center gap-1.5 px-2 py-1 sm:px-2.5 text-ui text-text-secondary hover:text-text-primary transition-[background-color,border-color,color,box-shadow]"
            title="Share document"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5">
              <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M16 6l-4-4-4 4M12 2v13" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Share</span>
          </button>
        )}

        <div className="relative">
          <button
            onClick={() => setMenuOpen((current) => !current)}
            aria-label="Document actions"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            title="Document actions"
            className="touch-target w-7 h-7 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
              <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
              <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <AnimatePresence>
            {menuOpen && (
              <DropdownMenu
                label="Document actions"
                items={documentMenuItems}
                onClose={() => setMenuOpen(false)}
                className="absolute top-full right-0 mt-1.5"
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <ShareModal
        documentId={document.id}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onUpdate={onDocumentUpdate}
      />
    </>
  );
}
