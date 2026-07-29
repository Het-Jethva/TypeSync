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
import {
  mountSmoothCollaborationCarets,
  renderCollaborationCaretMarker,
} from "../lib/smooth-collaboration-carets";
import { EditorToolbar } from "./EditorToolbar";
import { EditorSlashMenu } from "./EditorSlashMenu";
import { useConfirm } from "../lib/confirm-context";
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
  const confirm = useConfirm();
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
    documentSizeStatus,
    hasPendingUpdates,
    syncStatus,
    syncError,
    isSyncBlocked,
    recover,
  } = useCollaborativeDocument(documentId, onCollaboratorsChange, onAccessLost);
  const canEdit =
    (role === "owner" || role === "editor") &&
    documentSizeStatus?.level !== "limit" &&
    !isSyncBlocked;

  const handleRecover = async () => {
    const accepted = await confirm({
      title: "Discard pending changes",
      message:
        "Edits that have not reached the server will be lost, and the latest version will be reloaded from the server.",
      confirmLabel: "Discard and reload",
      tone: "danger",
    });
    if (accepted) recover();
  };

  const syncStatusText =
    syncStatus === "failed"
      ? isSyncBlocked
        ? `Sync blocked — ${syncError ?? "changes pending"}`
        : "Sync failed — retrying"
      : syncStatus === "offline"
        ? hasPendingUpdates
          ? "Offline — changes pending"
          : "Offline"
        : syncStatus === "syncing"
          ? "Syncing…"
          : "Synced";

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
          placeholder: "Start writing… Type / for commands",
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
          render: renderCollaborationCaretMarker,
        }),
      ],
      editorProps: {
        attributes: {
          class: "tiptap",
        },
        handleTextInput(view, from, to, text) {
          const { selection } = view.state;
          const isEmptyTextBlock =
            text === "/" &&
            from === to &&
            selection.empty &&
            selection.$from.parent.isTextblock &&
            selection.$from.parent.content.size === 0;

          if (isEmptyTextBlock) {
            const coords = view.coordsAtPos(from);
            setSlashMenu({
              isOpen: true,
              position: {
                top: coords.bottom + 6,
                left: coords.left,
              },
            });
          }

          return false;
        },
      },
      onUpdate({ editor }) {
        const { selection } = editor.state;
        const slashIsStillActive =
          selection.empty &&
          selection.$from.parent.isTextblock &&
          selection.$from.parent.textContent === "/" &&
          selection.$from.parentOffset === 1;

        if (!slashIsStillActive) {
          setSlashMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
        }
      },
      onSelectionUpdate({ editor }) {
        const { selection } = editor.state;
        const slashIsStillActive =
          selection.empty &&
          selection.$from.parent.isTextblock &&
          selection.$from.parent.textContent === "/" &&
          selection.$from.parentOffset === 1;

        if (!slashIsStillActive) {
          setSlashMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
        }
      },
      editable: canEdit,
    },
    // `canEdit` is deliberately absent: a dependency change destroys and
    // recreates the editor, which drops selection, focus and scroll position.
    // It flips on role change, on the document size limit, and on sync being
    // blocked — the last of which is the worst moment to move the caret. The
    // effect below applies it to the live instance instead.
    [documentId, ydoc, awareness]
  );

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  useEffect(() => {
    if (!editor) return;

    let detach: (() => void) | undefined;
    let frame: number | null = null;

    // `editor.view` throws while the editor has no view — either it has not been
    // mounted yet or it was already destroyed. Wait for the view instead.
    const attach = () => {
      frame = null;
      if (detach || editor.isDestroyed) return;

      const editorElement = editor.view.dom;
      const overlayContainer = editorElement.closest<HTMLElement>(
        ".editor-scroll-area"
      );
      if (!overlayContainer) {
        frame = window.requestAnimationFrame(attach);
        return;
      }

      detach = mountSmoothCollaborationCarets(
        editorElement,
        overlayContainer,
        awareness
      );
    };

    attach();
    editor.on("mount", attach);

    return () => {
      editor.off("mount", attach);
      if (frame !== null) window.cancelAnimationFrame(frame);
      detach?.();
    };
  }, [editor, awareness]);

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

      <div className="editor-scroll-area relative flex-1 overflow-auto bg-bg-secondary/40 sm:py-8 sm:px-4 py-2 px-0 flex justify-center">
        <div className="w-full max-w-2xl bg-bg-elevated min-h-[calc(100vh-10rem)] h-fit">
          <EditorContent key={ydoc.clientID} editor={editor} />
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
      <div className="shrink-0 px-4 py-1 border-t border-border bg-bg-secondary/30 flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              documentSizeStatus?.level === "limit" || syncStatus === "failed"
                ? "bg-error"
                : documentSizeStatus?.level === "warning" || syncStatus === "offline"
                  ? "bg-warning"
                  : syncStatus === "syncing"
                    ? "bg-warning animate-pulse"
                  : "bg-success"
            }`}
          />
          <span
            className="text-micro text-text-muted font-medium truncate"
            title={syncError ?? undefined}
          >
            {syncStatus === "failed"
              ? syncStatusText
              : documentSizeStatus?.level === "limit"
                ? documentSizeStatus.reason === "update"
                  ? "Edit exceeds size limit"
                  : "Document size limit reached"
                : documentSizeStatus?.level === "warning"
                  ? "Document nearing size limit"
                  : syncStatusText}
          </span>
          {isSyncBlocked && (
            <button
              type="button"
              onClick={() => void handleRecover()}
              className="text-micro text-error hover:text-error/80 underline font-medium cursor-pointer shrink-0 ml-1"
            >
              Discard pending changes and reload
            </button>
          )}
        </div>
        <span className="text-micro text-text-muted font-medium shrink-0">
          {editor?.storage.characterCount?.characters?.() ?? 0} characters
        </span>
      </div>
    </motion.div>
  );
}
