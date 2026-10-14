import { getSchema, type Attributes } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
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
const ValidatedLink = Link.extend({
  addAttributes() {
    const attributes: Attributes = this.parent?.() ?? {};
    return { ...attributes, href: { ...attributes.href, validate: "string" } };
  },
});

export function createContentExtensions() {
  return [
    StarterKit.configure({ undoRedo: false, codeBlock: false, link: false }),
    ValidatedLink.configure({ openOnClick: false, autolink: true }),
    Image.configure({ inline: false, allowBase64: false }),
    Table.configure({ resizable: true }), TableRow, TableCell, TableHeader,
    TaskList, TaskItem.configure({ nested: true }),
    CodeBlockLowlight.configure({ lowlight }),
  ];
}

export const editorSchema = getSchema(createContentExtensions());

export function validateTableResources(doc: Node): void {
  let documentGridSize = 0;
  doc.descendants(table => {
    if (table.type.spec.tableRole !== "table") return;
    const rows = table.childCount;
    if (rows > 200) throw new Error("Table exceeds 200 rows");
    const expiredSpans = new Array<number>(rows + 1).fill(0);
    let activeSpans = 0;
    let width = 0;
    table.forEach((row, _offset, rowIndex) => {
      activeSpans -= expiredSpans[rowIndex] ?? 0;
      let rowWidth = activeSpans;
      row.forEach(cell => {
        const colspan: unknown = cell.attrs.colspan;
        const rowspan: unknown = cell.attrs.rowspan;
        const colwidth: unknown = cell.attrs.colwidth;
        if (typeof colspan !== "number" || !Number.isInteger(colspan) || colspan < 1 || colspan > 100) {
          throw new Error("Table cell colspan must be an integer between 1 and 100");
        }
        if (typeof rowspan !== "number" || !Number.isInteger(rowspan) || rowspan < 1 || rowspan > rows - rowIndex) {
          throw new Error("Table cell rowspan must be a positive integer within the remaining rows");
        }
        if (colwidth !== null) {
          if (!Array.isArray(colwidth) || colwidth.length !== colspan) {
            throw new Error("Table cell colwidth must match colspan");
          }
          for (const value of colwidth) {
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000) {
              throw new Error("Table cell widths must be finite numbers between 0 and 10000");
            }
          }
        }
        rowWidth += colspan;
        if (rowWidth > 100) throw new Error("Table exceeds 100 columns");
        if (rowspan > 1) {
          activeSpans += colspan;
          const endRow = rowIndex + rowspan;
          expiredSpans[endRow] = (expiredSpans[endRow] ?? 0) + colspan;
        }
      });
      width = Math.max(width, rowWidth);
    });
    const gridSize = rows * width;
    if (gridSize > 10_000) throw new Error("Table exceeds 10000 grid slots");
    documentGridSize += gridSize;
    if (documentGridSize > 50_000) throw new Error("Document tables exceed 50000 grid slots");
  });
}

export const unsafeAiSelectionReason = "Select text without crossing table cells. AI cannot replace a selection containing images or other non-text content.";

export function isTextOnlySelection(doc: Node, from: number, to: number): boolean {
  let safe = true;
  doc.nodesBetween(from, to, (node, position) => {
    if (!safe) return false;
    const role = node.type.spec.tableRole;
    if ((role === "cell" || role === "header_cell") && (from <= position || to >= position + node.nodeSize)) {
      safe = false;
      return false;
    }
    if (!node.isText && (node.isLeaf || node.isAtom) && node.type.name !== "hardBreak") {
      safe = false;
      return false;
    }
  });
  return safe;
}

export function selectedText(doc: Node, from: number, to: number): string {
  return doc.textBetween(from, to, "\n", node =>
    node.type.name === "hardBreak" ? "\n" : ""
  );
}
