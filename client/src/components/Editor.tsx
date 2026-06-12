import { useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import * as awarenessProtocol from "y-protocols/awareness";
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
import * as Y from "yjs";
import { motion } from "motion/react";
import { common, createLowlight } from "lowlight";
import { getSocket } from "../lib/socket";
import { useSession } from "../lib/auth-client";
import { EditorToolbar } from "./EditorToolbar";

const lowlight = createLowlight(common);

// Assign random color to each user session
const CURSOR_COLORS = [
  "#8b5cf6", "#06b6d4", "#f59e0b", "#ef4444", "#22c55e",
  "#ec4899", "#3b82f6", "#f97316", "#14b8a6", "#a855f7",
];

function getRandomColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
}

interface EditorProps {
  documentId: string;
}

export function Editor({ documentId }: EditorProps) {
  const { data: session } = useSession();
  const [isConnected, setIsConnected] = useState(false);
  const cursorColor = useMemo(() => getRandomColor(), []);

  // Create a Yjs document per documentId
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);
  const awareness = useMemo(() => new awarenessProtocol.Awareness(ydoc), [ydoc]);

  // Set up socket sync
  useEffect(() => {
    const socket = getSocket();

    const handleSync = (state: Uint8Array) => {
      Y.applyUpdate(ydoc, new Uint8Array(state));
      setIsConnected(true);
    };

    const handleUpdate = (update: Uint8Array) => {
      Y.applyUpdate(ydoc, new Uint8Array(update));
    };

    const handleAwarenessUpdate = (update: Uint8Array) => {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        new Uint8Array(update),
        "remote"
      );
    };

    socket.on("doc:sync", handleSync);
    socket.on("doc:update", handleUpdate);
    socket.on("awareness:update", handleAwarenessUpdate);

    // Join the document room
    socket.emit("doc:join", documentId);

    // Listen for local changes and broadcast
    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin !== "remote") {
        socket.emit("doc:update", documentId, update);
      }
    };
    ydoc.on("update", updateHandler);

    // Listen for local awareness changes and broadcast
    const awarenessUpdateHandler = ({ added, updated, removed }: any, origin: any) => {
      if (origin !== "remote") {
        const changedClients = added.concat(updated).concat(removed);
        const update = awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          changedClients
        );
        socket.emit("awareness:update", documentId, update);
      }
    };
    awareness.on("update", awarenessUpdateHandler);

    return () => {
      socket.off("doc:sync", handleSync);
      socket.off("doc:update", handleUpdate);
      socket.off("awareness:update", handleAwarenessUpdate);
      ydoc.off("update", updateHandler);
      awareness.off("update", awarenessUpdateHandler);
      socket.emit("doc:leave", documentId);
      ydoc.destroy();
      awareness.destroy();
    };
  }, [documentId, ydoc, awareness]);

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
        Image.configure({
          inline: false,
          allowBase64: true,
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
            name: session?.user?.name || "Anonymous",
            color: cursorColor,
          },
        }),
      ],
      editorProps: {
        attributes: {
          class: "tiptap",
        },
      },
    },
    [documentId, ydoc, awareness]
  );

  // Sync user details to awareness when session is loaded/updated
  useEffect(() => {
    if (editor && !editor.isDestroyed && session?.user?.name) {
      editor.commands.updateUser({
        name: session.user.name,
        color: cursorColor,
      });
    }
  }, [editor, session?.user?.name, cursorColor]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="h-full flex flex-col"
    >
      <EditorToolbar editor={editor} />

      <div className="flex-1 overflow-auto bg-bg-primary">
        <div className="max-w-3xl mx-auto py-6 px-4">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Connection status bar */}
      <div className="shrink-0 px-4 py-1 border-t border-border bg-bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? "bg-success" : "bg-warning animate-pulse"
            }`}
          />
          <span className="text-[10px] text-text-muted font-medium">
            {isConnected ? "Connected" : "Connecting"}
          </span>
        </div>
        <span className="text-[10px] text-text-muted font-medium">
          {editor?.storage.characterCount?.characters?.() ?? 0} characters
        </span>
      </div>
    </motion.div>
  );
}
