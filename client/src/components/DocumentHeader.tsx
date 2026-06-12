import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

import { ShareModal } from "./ShareModal";
import { CollaboratorPresence } from "./CollaboratorPresence";
import type { Document } from "@typesync/shared";

interface DocumentHeaderProps {
  document: Document & { role: string };
  onRename: (title: string) => void;
  onDocumentUpdate: () => void;
}

export function DocumentHeader({ document, onRename, onDocumentUpdate }: DocumentHeaderProps) {

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [shareOpen, setShareOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");

  const handleBlur = () => {
    setIsEditing(false);
    if (title.trim() && title !== document.title) {
      setSaveStatus("saving");
      onRename(title.trim());
      setTimeout(() => setSaveStatus("saved"), 1000);
    } else {
      setTitle(document.title);
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
            className="bg-transparent text-sm font-semibold text-text-primary outline-none border-b border-accent px-0 py-0.5 min-w-0 flex-1"
          />
        ) : (
          <button
            onClick={() => canEdit && setIsEditing(true)}
            className="text-sm font-semibold text-text-primary truncate hover:text-accent transition-colors"
            title={canEdit ? "Click to rename" : document.title}
          >
            {document.title}
          </button>
        )}

        {/* Save status */}
        <AnimatePresence mode="wait">
          <motion.span
            key={saveStatus}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-text-muted shrink-0"
          >
            {saveStatus === "saving" ? "Saving..." : ""}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2 shrink-0">
        <CollaboratorPresence />

        {document.role === "owner" && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShareOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5">
              <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M16 6l-4-4-4 4M12 2v13" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Share
          </motion.button>
        )}
      </div>

      {/* Share modal */}
      <AnimatePresence>
        {shareOpen && (
          <ShareModal
            documentId={document.id}
            onClose={() => setShareOpen(false)}
            onUpdate={onDocumentUpdate}
          />
        )}
      </AnimatePresence>
    </>
  );
}
