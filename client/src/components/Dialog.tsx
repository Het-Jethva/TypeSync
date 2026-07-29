import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Rendered below the body, separated from it. Buttons belong here. */
  footer?: ReactNode;
  /** Focused on open. Falls back to the first focusable element in the dialog. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Id of the element describing the dialog, for `aria-describedby`. */
  describedById?: string;
  /** Blocks escape and backdrop dismissal while an operation is in flight. */
  busy?: boolean;
  maxWidthClassName?: string;
}

/**
 * Modal dialog: portalled, focus-trapped, escape-dismissable, and restores
 * focus to whatever opened it. Callers render it unconditionally and drive it
 * with `open`; it animates in and disappears immediately on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  initialFocusRef,
  describedById,
  busy = false,
  maxWidthClassName = "max-w-md",
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `dialog-title-${useId().replace(/:/g, "")}`;

  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  // Captured before the dialog takes focus so it can be handed back on close.
  useLayoutEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const target =
      initialFocusRef?.current ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      dialogRef.current;
    target?.focus();

    return () => opener?.focus();
  }, [open, initialFocusRef]);

  // A modal that scrolls the page behind it reads as two competing surfaces.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable =
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  // Deliberately not driven by AnimatePresence. Inside the portal it animated
  // out but never unmounted, leaving an invisible surface over the middle of
  // the page that still took clicks; outside the portal it never mounted at
  // all, because a portal is not an animatable child. Mounting is plain
  // conditional rendering, so it cannot fail in either direction, and the
  // entrance is a CSS animation that skips itself under reduced motion.
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="dialog-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={requestClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`dialog-panel absolute top-1/2 left-1/2 w-[calc(100%-2rem)] ${maxWidthClassName} outline-none`}
      >
        <div className="bg-bg-elevated border border-border-strong rounded-md shadow-xl">
          <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-4">
            <h2
              id={titleId}
              className="text-title font-semibold text-text-primary tracking-tight"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={requestClose}
              aria-label={`Close ${title.toLowerCase()}`}
              className="touch-target w-7 h-7 rounded hover:bg-bg-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors shrink-0"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  d="M18 6L6 18M6 6l12 12"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="px-6 pb-6">{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
