import { useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { AnimatePresence } from "motion/react";
import { ToolbarUrlPopover } from "./ToolbarUrlPopover";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";

interface EditorToolbarProps {
  editor: TiptapEditor | null;
  canEdit: boolean;
}

function ToolbarButton({
  isActive = false,
  onClick,
  title,
  children,
  disabled = false,
}: {
  isActive?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => {
        if (!disabled) onClick();
      }}
      title={title}
      disabled={disabled}
      aria-label={title}
      className={`toolbar-button touch-target w-6.5 h-6.5 rounded flex items-center justify-center transition-[background-color,border-color,color,box-shadow,transform,opacity] border text-ui ${
        disabled
          ? "cursor-not-allowed border-transparent text-text-muted opacity-50"
          : "cursor-pointer"
      } ${
        isActive
          ? "bg-accent-light border-border-accent text-accent font-semibold shadow-[0_1px_2px_rgba(194,89,63,0.02)]"
          : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-border mx-1" />;
}

export function EditorToolbar({ editor, canEdit }: EditorToolbarProps) {
  const [openPopover, setOpenPopover] = useState<"link" | "image" | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  if (!editor) return null;

  const closePopover = () => {
    setOpenPopover(null);
    editor.chain().focus().run();
  };

  // The blocks people reach for least often, kept off the main row so it stays
  // one line.
  const overflowItems: DropdownMenuItem[] = [
    {
      id: "task-list",
      label: "Task list",
      disabled: !canEdit,
      onSelect: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      id: "code-block",
      label: "Code block",
      disabled: !canEdit,
      onSelect: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "table",
      label: "Table",
      disabled: !canEdit,
      onSelect: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      id: "divider",
      label: "Divider",
      disabled: !canEdit,
      onSelect: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ];

  return (
    <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-bg-secondary/40">
      {/* History */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo (Ctrl+Z)"
        disabled={!canEdit || !editor.can().undo()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M9 14L4 9l5-5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 9h11a5 5 0 0 1 0 10h-3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canEdit || !editor.can().redo()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M15 14l5-5-5-5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 9H9a5 5 0 0 0 0 10h3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Text style */}
      <ToolbarButton
        isActive={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
        disabled={!canEdit}
      >
        <span className="text-title font-bold">B</span>
      </ToolbarButton>

      <ToolbarButton
        isActive={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
        disabled={!canEdit}
      >
        <span className="text-title italic font-semibold">I</span>
      </ToolbarButton>

      <ToolbarButton
        isActive={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (Ctrl+U)"
        disabled={!canEdit}
      >
        <span className="text-title underline font-semibold">U</span>
      </ToolbarButton>

      <ToolbarButton
        isActive={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
        disabled={!canEdit}
      >
        <span className="text-title line-through">S</span>
      </ToolbarButton>

      <Divider />

      {/* Headings */}
      {[1, 2, 3].map((level) => (
        <ToolbarButton
          key={level}
          isActive={editor.isActive("heading", { level })}
          onClick={() => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()}
          title={`Heading ${level}`}
          disabled={!canEdit}
        >
          <span className="text-ui font-bold">H{level}</span>
        </ToolbarButton>
      ))}

      <Divider />

      {/* Lists */}
      <ToolbarButton
        isActive={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <circle cx="4" cy="7" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="4" cy="17" r="1.5" fill="currentColor" stroke="none" />
          <path d="M9 7h12M9 12h12M9 17h12" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </ToolbarButton>

      <ToolbarButton
        isActive={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M10 7h11M10 12h11M10 17h11" strokeWidth="1.5" strokeLinecap="round" />
          <text x="2" y="9" fontSize="7" fill="currentColor" fontWeight="600" stroke="none">1</text>
          <text x="2" y="14" fontSize="7" fill="currentColor" fontWeight="600" stroke="none">2</text>
          <text x="2" y="19" fontSize="7" fill="currentColor" fontWeight="600" stroke="none">3</text>
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Block elements */}
      <ToolbarButton
        isActive={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Blockquote"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M3 6h18M3 12h18M3 18h12" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Link */}
      <div className="relative">
        <ToolbarButton
          isActive={editor.isActive("link")}
          onClick={() => setOpenPopover((current) => (current === "link" ? null : "link"))}
          title={editor.isActive("link") ? "Edit link" : "Insert link"}
          disabled={!canEdit}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </ToolbarButton>
        <AnimatePresence>
          {openPopover === "link" && (
            <ToolbarUrlPopover
              label={editor.isActive("link") ? "Edit link" : "Link address"}
              placeholder="example.com/page"
              initialValue={editor.getAttributes("link").href ?? ""}
              submitLabel={editor.isActive("link") ? "Update" : "Add link"}
              removeLabel="Remove link"
              onRemove={
                editor.isActive("link")
                  ? () =>
                      editor.chain().focus().extendMarkRange("link").unsetLink().run()
                  : undefined
              }
              onSubmit={(url) =>
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: url })
                  .run()
              }
              onClose={closePopover}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Image */}
      <div className="relative">
        <ToolbarButton
          onClick={() => setOpenPopover((current) => (current === "image" ? null : "image"))}
          title="Insert image"
          disabled={!canEdit}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
            <path d="M21 15l-5-5L5 21" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ToolbarButton>
        <AnimatePresence>
          {openPopover === "image" && (
            <ToolbarUrlPopover
              label="Image address"
              placeholder="example.com/photo.jpg"
              submitLabel="Insert image"
              onSubmit={(url) => editor.chain().focus().setImage({ src: url }).run()}
              onClose={closePopover}
            />
          )}
        </AnimatePresence>
      </div>

      <Divider />

      {/* Overflow */}
      <div className="relative">
        <ToolbarButton
          onClick={() => setOverflowOpen((current) => !current)}
          title="More blocks"
          isActive={overflowOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
            <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </ToolbarButton>
        <AnimatePresence>
          {overflowOpen && (
            <DropdownMenu
              label="More blocks"
              items={overflowItems}
              onClose={() => setOverflowOpen(false)}
              className="absolute top-full left-0 mt-1.5"
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
