import { useEffect, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Collaboration from "@tiptap/extension-collaboration";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { common, createLowlight } from "lowlight";
import * as Y from "yjs";
import { EditorToolbar } from "./EditorToolbar";

const lowlight = createLowlight(common);

const DEMO_CONTENT = `
  <h2>Weekend plans</h2>
  <p>This is the real editor. Type in it, format it, break it — nothing here is
  saved, and nothing you write leaves your browser.</p>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="true"><p>Pick a place to stay</p></li>
    <li data-type="taskItem" data-checked="false"><p>Work out who is driving</p></li>
  </ul>
  <blockquote><p>Bring the good coffee this time.</p></blockquote>
`;

/**
 * The editor from the app, running on its own. The document lives in memory
 * and there is nobody else in it, so no account and no server are needed to
 * try it.
 */
export function LandingEditorDemo() {
  const ydoc = useMemo(() => new Y.Doc(), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true },
      }),
      Underline,
      // The toolbar is shared with the app, so the demo carries every
      // extension it can drive. Anything missing would be a button that
      // silently does nothing.
      Image.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Collaboration.configure({ document: ydoc }),
    ],
    editorProps: { attributes: { class: "tiptap" } },
  });

  // Seeded once. The emptiness check matters because development mounts
  // effects twice, which would otherwise insert the content twice.
  //
  // The document is deliberately not destroyed on unmount: it is held by a memo
  // that a remount does not re-run, so tearing it down would leave the editor
  // bound to a dead document. It holds no connection and nothing outside this
  // component refers to it.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (ydoc.getXmlFragment("default").length > 0) return;
    editor.commands.setContent(DEMO_CONTENT);
  }, [editor, ydoc]);

  return (
    <div className="overflow-hidden rounded-md border border-border-strong bg-bg-elevated text-left shadow-sm">
      <EditorToolbar editor={editor} canEdit />
      <div className="max-h-[380px] overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
