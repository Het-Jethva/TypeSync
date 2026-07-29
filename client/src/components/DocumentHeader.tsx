import { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";

import { ShareModal } from "./ShareModal";
import { CollaboratorPresence } from "./CollaboratorPresence";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";
import { DocumentStatusPill } from "./DocumentStatusPill";
import { AnchoredPortal } from "./AnchoredPortal";
import { exportDocument } from "../lib/export-document";
import type { DocumentStatus } from "../lib/document-status";
import type { ActiveCollaborator } from "../lib/presence";
import type { DocumentWithRole } from "@typesync/shared";
import type { Editor as TiptapEditor } from "@tiptap/react";

interface DocumentHeaderProps {
  document: DocumentWithRole;
  editor: TiptapEditor | null;
  status: DocumentStatus | null;
  /** Narrow viewport, where secondary actions fold into the menu. */
  isCompact: boolean;
  onRename: (title: string) => Promise<void>;
  onDocumentUpdate: () => void;
  activeCollaborators: ActiveCollaborator[];
}

export function DocumentHeader({
  document,
  editor,
  status,
  isCompact,
  onRename,
  onDocumentUpdate,
  activeCollaborators,
}: DocumentHeaderProps) {

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement>(null);

  const isOwner = document.role === "owner";

  const documentMenuItems: DropdownMenuItem[] = [
    // Share is a primary action, so it keeps its own button where there is
    // room and folds into this menu where there is not.
    ...(isOwner && isCompact
      ? [
          {
            id: "share",
            label: "Share",
            onSelect: () => setShareOpen(true),
          },
        ]
      : []),
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

    setIsRenaming(true);
    try {
      await onRename(trimmedTitle);
    } catch {
      setTitle(document.title);
    } finally {
      setIsRenaming(false);
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
            className="bg-bg-primary border border-border rounded-md px-2 py-0.5 text-ui font-semibold text-text-primary outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light flex-1 min-w-0 sm:max-w-[300px] transition-[background-color,border-color,color,box-shadow]"
          />
        ) : canEdit ? (
          <button
            onClick={() => setIsEditing(true)}
            className="text-ui font-semibold text-text-primary truncate hover:text-accent transition-colors px-1 min-w-0 sm:max-w-[300px] text-left"
            title="Click to rename"
          >
            {document.title}
          </button>
        ) : (
          <span
            className="text-ui font-semibold text-text-primary truncate px-1 min-w-0 sm:max-w-[300px]"
            title={document.title}
          >
            {document.title}
          </span>
        )}

        <DocumentStatusPill status={status} isRenaming={isRenaming} />
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <CollaboratorPresence collaborators={activeCollaborators} />

        {isOwner && !isCompact && (
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

        <div ref={menuAnchorRef}>
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
              <AnchoredPortal anchorRef={menuAnchorRef} align="right">
                <DropdownMenu
                  label="Document actions"
                  items={documentMenuItems}
                  onClose={() => setMenuOpen(false)}
                />
              </AnchoredPortal>
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
