import { useEffect, useState, useRef } from "react";
import type { Editor } from "@tiptap/react";

interface SlashMenuItem {
  title: string;
  description: string;
  icon: string;
  action: (editor: Editor) => void;
}

const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  {
    title: "Heading 1",
    description: "Big section heading",
    icon: "H1",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Simple bulleted list",
    icon: "•",
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Sequential numbered list",
    icon: "1.",
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "Task List",
    description: "Checklist with tasks",
    icon: "☑",
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: "Blockquote",
    description: "Add a quote block",
    icon: "“",
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Code Block",
    description: "Syntax highlighted block",
    icon: "</>",
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Table",
    description: "Insert a 3x3 table",
    icon: "田",
    action: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: "Divider",
    description: "Insert a horizontal rule",
    icon: "―",
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

interface EditorSlashMenuProps {
  editor: Editor;
  position: { top: number; left: number };
  onClose: () => void;
}

export function EditorSlashMenu({ editor, position, onClose }: EditorSlashMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Bounds checking logic for menu placement
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const menuWidth = rect.width || 240;
      const menuHeight = rect.height || 256;

      let left = position.left;
      let top = position.top;

      // Adjust horizontal overflow
      if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 12;
      }
      if (left < 12) {
        left = 12;
      }

      // Adjust vertical overflow
      if (top + menuHeight > window.innerHeight) {
        const spaceAbove = position.top - 12 - 12;
        if (spaceAbove > menuHeight) {
          top = position.top - menuHeight - 12;
        } else {
          top = window.innerHeight - menuHeight - 12;
        }
      }
      if (top < 12) {
        top = 12;
      }

      setAdjustedPosition({ top, left });
    }
  }, [position]);

  // Close when user clicks outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % SLASH_MENU_ITEMS.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + SLASH_MENU_ITEMS.length) % SLASH_MENU_ITEMS.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        
        // Remove the slash '/' typed before execution
        const { selection } = editor.state;
        editor.chain().focus().deleteRange({ from: selection.from - 1, to: selection.from }).run();
        
        // Execute the action
        SLASH_MENU_ITEMS[selectedIndex].action(editor);
        onClose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === " ") {
        onClose();
      } else if (e.key === "Backspace") {
        setTimeout(() => {
          const { selection } = editor.state;
          const charBefore = editor.state.doc.textBetween(Math.max(0, selection.from - 1), selection.from);
          if (charBefore !== "/") {
            onClose();
          }
        }, 10);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [editor, selectedIndex, onClose]);

  // Scroll active item into view inside the popover
  useEffect(() => {
    if (menuRef.current) {
      const activeEl = menuRef.current.children[selectedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-bg-elevated border border-border-strong rounded-md shadow-lg py-1 w-60 max-h-64 overflow-y-auto"
      style={{
        top: `${adjustedPosition.top}px`,
        left: `${adjustedPosition.left}px`,
      }}
    >
      {SLASH_MENU_ITEMS.map((item, idx) => (
        <button
          key={item.title}
          onClick={() => {
            const { selection } = editor.state;
            editor.chain().focus().deleteRange({ from: selection.from - 1, to: selection.from }).run();
            item.action(editor);
            onClose();
          }}
          className={`w-full text-left px-3 py-1.5 flex items-center gap-3 transition-colors border-l-2 ${
            selectedIndex === idx
              ? "bg-accent-light/50 border-accent text-text-primary"
              : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          }`}
        >
          <div className={`w-5.5 h-5.5 rounded border border-border-strong flex items-center justify-center text-[10px] font-bold shrink-0 ${
            selectedIndex === idx ? "bg-bg-elevated border-border-accent text-accent" : "bg-bg-secondary text-text-secondary"
          }`}>
            {item.icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium">{item.title}</p>
            <p className="text-[9px] text-text-muted truncate">{item.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
