import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import CharacterCount from "@tiptap/extension-character-count";

import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { motion } from "motion/react";
import { common, createLowlight } from "lowlight";
import { useCollaborativeDocument } from "../lib/hooks/useCollaborativeDocument";
import { EditorToolbar } from "./EditorToolbar";
import { EditorSlashMenu } from "./EditorSlashMenu";
import type { Role } from "@typesync/shared";
const lowlight = createLowlight(common);

interface EditorProps {
  documentId: string;
  role: Role;
  onCollaboratorsChange?: (collaborators: { name: string; color: string }[]) => void;
  onAccessLost?: () => void;
  onPendingUpdatesChange?: (hasPendingUpdates: boolean) => void;
}

export function Editor({
  documentId,
  role,
  onCollaboratorsChange,
  onAccessLost,
  onPendingUpdatesChange,
}: EditorProps) {
  const [slashMenu, setSlashMenu] = useState<{
    isOpen: boolean;
    position: { top: number; left: number };
  }>({
    isOpen: false,
    position: { top: 0, left: 0 },
  });
  const {
    ydoc,
    awareness,
    isConnected,
    documentSizeStatus,
    hasPendingUpdates,
    syncError,
  } = useCollaborativeDocument(documentId, onCollaboratorsChange, onAccessLost);
  const canEdit =
    (role === "owner" || role === "editor") &&
    documentSizeStatus?.level !== "limit" &&
    syncError === null;

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          codeBlock: false, // Use CodeBlockLowlight instead
          link: {
            openOnClick: false,
            autolink: true,
          },
        }),
        Underline,
        CharacterCount,
        Image.configure({
          inline: false,
          allowBase64: false,
        }),
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableCell,
        TableHeader,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        CodeBlockLowlight.configure({
          lowlight,
        }),
        Placeholder.configure({
          placeholder: "Start writing...",
        }),
        Collaboration.configure({
          document: ydoc,
        }),
        CollaborationCaret.configure({
          provider: { awareness },
          user: {
            userId: "",
            name: "Connecting…",
            color: "#5a6b7c",
          },
        }),
      ],
      editorProps: {
        attributes: {
          class: "tiptap",
        },
        handleKeyDown(view, event) {
          if (event.key === "/") {
            const { selection } = view.state;
            const textBefore = selection.$from.parent.textBetween(0, selection.$from.parentOffset);
            if (textBefore.trim() === "") {
              const coords = view.coordsAtPos(selection.from);
              setSlashMenu({
                isOpen: true,
                position: {
                  top: coords.bottom + 6,
                  left: coords.left,
                },
              });
            }
          }
          return false;
        },
      },
      onSelectionUpdate({ editor }) {
        const { selection } = editor.state;
        const charBefore = editor.state.doc.textBetween(Math.max(0, selection.from - 1), selection.from);
        if (charBefore !== "/") {
          setSlashMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
        }
      },
      editable: canEdit,
    },
    [documentId, ydoc, awareness, canEdit]
  );

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  useEffect(() => {
    onPendingUpdatesChange?.(hasPendingUpdates);
  }, [hasPendingUpdates, onPendingUpdatesChange]);

  useEffect(() => {
    return () => onPendingUpdatesChange?.(false);
  }, [onPendingUpdatesChange]);

  useEffect(() => {
    if (!hasPendingUpdates) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingUpdates]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="h-full flex flex-col"
    >
      <EditorToolbar editor={editor} documentId={documentId} canEdit={canEdit} />

      <div className="flex-1 overflow-auto bg-bg-secondary/40 sm:py-8 sm:px-4 py-2 px-0 flex justify-center">
        <div className="w-full max-w-2xl bg-bg-elevated sm:border sm:border-border-strong sm:rounded-md sm:shadow-[0_2px_12px_rgba(0,0,0,0.01)] border-none rounded-none shadow-none sm:min-h-[700px] min-h-[calc(100vh-10rem)] h-fit">
          <EditorContent editor={editor} />
        </div>
      </div>

      {slashMenu.isOpen && editor && (
        <EditorSlashMenu
          editor={editor}
          position={slashMenu.position}
          onClose={() => setSlashMenu((prev) => ({ ...prev, isOpen: false }))}
        />
      )}

      {/* Connection status bar */}
      <div className="shrink-0 px-4 py-1 border-t border-border bg-bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              documentSizeStatus?.level === "limit" || syncError
                ? "bg-error"
                : documentSizeStatus?.level === "warning" || !isConnected || hasPendingUpdates
                  ? "bg-warning animate-pulse"
                  : "bg-success"
            }`}
          />
          <span
            className="text-[10px] text-text-muted font-medium"
            title={syncError ?? undefined}
          >
            {documentSizeStatus?.level === "limit"
              ? documentSizeStatus.reason === "update"
                ? "Edit exceeds size limit"
                : "Document size limit reached"
              : syncError
                ? "Unable to save changes"
              : documentSizeStatus?.level === "warning"
                ? "Document nearing size limit"
                : !isConnected
                  ? hasPendingUpdates
                    ? "Offline — changes pending"
                    : "Connecting"
                  : hasPendingUpdates
                    ? "Saving…"
                    : "Saved"}
          </span>
        </div>
        <span className="text-[10px] text-text-muted font-medium">
          {editor?.storage.characterCount?.characters?.() ?? 0} characters
        </span>
      </div>
    </motion.div>
  );
}
