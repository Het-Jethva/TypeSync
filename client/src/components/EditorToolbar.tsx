import type { Editor as TiptapEditor } from "@tiptap/react";

interface EditorToolbarProps {
  editor: TiptapEditor | null;
  documentId: string;
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
      className={`w-6.5 h-6.5 rounded flex items-center justify-center transition-all border text-xs ${
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

export function EditorToolbar({ editor, documentId, canEdit }: EditorToolbarProps) {
  if (!editor) return null;

  const downloadExport = (format: "html" | "txt" | "json") => {
    const title = `typesync-${documentId}`;
    const content =
      format === "html"
        ? `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${editor.getHTML()}</body></html>`
        : format === "json"
          ? JSON.stringify(editor.getJSON(), null, 2)
          : editor.getText();
    const type = format === "html" ? "text/html" : format === "json" ? "application/json" : "text/plain";
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-bg-secondary/40 flex-wrap">
      {/* Text style */}
      <ToolbarButton
        isActive={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
        disabled={!canEdit}
      >
        <span className="text-sm font-bold">B</span>
      </ToolbarButton>

      <ToolbarButton
        isActive={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
        disabled={!canEdit}
      >
        <span className="text-sm italic font-semibold">I</span>
      </ToolbarButton>

      <ToolbarButton
        isActive={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (Ctrl+U)"
        disabled={!canEdit}
      >
        <span className="text-sm underline font-semibold">U</span>
      </ToolbarButton>

      <ToolbarButton
        isActive={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
        disabled={!canEdit}
      >
        <span className="text-sm line-through">S</span>
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
          <span className="text-xs font-bold">H{level}</span>
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

      <ToolbarButton
        isActive={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="Task list"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <rect x="3" y="5" width="5" height="5" rx="1" strokeWidth="1.5" />
          <path d="M5 7.5l1 1 2-2" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="3" y="14" width="5" height="5" rx="1" strokeWidth="1.5" />
          <path d="M12 7h8M12 17h8" strokeWidth="1.5" strokeLinecap="round" />
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

      <ToolbarButton
        isActive={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="Code block"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M3 12h18" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Table */}
      <ToolbarButton
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
        title="Insert table"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" strokeWidth="1" />
        </svg>
      </ToolbarButton>

      {/* Link */}
      <ToolbarButton
        isActive={editor.isActive("link")}
        onClick={() => {
          const url = window.prompt("Enter URL:");
          if (url) {
            editor.chain().focus().setLink({ href: url }).run();
          }
        }}
        title="Insert link"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </ToolbarButton>

      {/* Image */}
      <ToolbarButton
        onClick={() => {
          const url = window.prompt("Enter image URL:");
          if (url) {
            editor.chain().focus().setImage({ src: url }).run();
          }
        }}
        title="Insert image"
        disabled={!canEdit}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
          <path d="M21 15l-5-5L5 21" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ToolbarButton>

      <Divider />

      <div className="flex items-center gap-1">
        <ToolbarButton onClick={() => downloadExport("html")} title="Export HTML">
          <span className="text-[10px] font-semibold">HTML</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => downloadExport("txt")} title="Export plain text">
          <span className="text-[10px] font-semibold">TXT</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => downloadExport("json")} title="Export JSON">
          <span className="text-[10px] font-semibold">JSON</span>
        </ToolbarButton>
      </div>
    </div>
  );
}
