import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";

export interface DropdownMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
}

interface DropdownMenuProps {
  label: string;
  items: DropdownMenuItem[];
  onClose: () => void;
  /** Positioning classes. The menu itself is only responsible for behaviour. */
  className?: string;
  style?: CSSProperties;
}

/**
 * Menu with roving arrow-key focus, escape and click-away dismissal. Rendered
 * only while open so the caller controls mounting and animation.
 */
export function DropdownMenu({
  label,
  items,
  onClose,
  className = "",
  style,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [onClose]);

  const moveFocus = (direction: 1 | -1) => {
    const focusable = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])'
      ) ?? []
    );
    if (!focusable.length) return;

    const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
    const next = (index + direction + focusable.length) % focusable.length;
    focusable[next].focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    }
  };

  return (
    <motion.div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={handleKeyDown}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.1 }}
      style={style}
      className={`z-50 min-w-[176px] rounded-md border border-border-strong bg-bg-elevated py-1 shadow-lg ${className}`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            item.tone === "danger"
              ? "text-error hover:bg-error/10"
              : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          }`}
        >
          {item.icon && <span className="shrink-0">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </motion.div>
  );
}
