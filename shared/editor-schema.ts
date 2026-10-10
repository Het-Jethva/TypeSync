import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

export function createContentExtensions() {
  return [
    StarterKit.configure({ undoRedo: false, codeBlock: false, link: { openOnClick: false, autolink: true } }),
    Image.configure({ inline: false, allowBase64: false }),
    Table.configure({ resizable: true }), TableRow, TableCell, TableHeader,
    TaskList, TaskItem.configure({ nested: true }),
    CodeBlockLowlight.configure({ lowlight }),
  ];
}

export const editorSchema = getSchema(createContentExtensions());
