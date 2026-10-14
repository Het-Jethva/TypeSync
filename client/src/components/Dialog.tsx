import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]';

const openDialogs: HTMLDialogElement[] = [];
let previousBodyOverflow = "";

interface DialogContentProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Focused on open. Falls back to the first focusable element in the dialog. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Id of the element describing the dialog, for `aria-describedby`. */
  describedById?: string;
  /** Blocks escape and backdrop dismissal while an operation is in flight. */
  busy?: boolean;
}

type DialogProps = DialogContentProps & (
  | { variant?: "dialog"; footer?: ReactNode; maxWidthClassName?: string }
  | { variant: "drawer"; footer?: never; maxWidthClassName?: never }
);

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
  variant = "dialog",
  maxWidthClassName = "max-w-md",
}: DialogProps) {
  const modalRef = useRef<HTMLDialogElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `dialog-title-${useId().replace(/:/g, "")}`;

  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  // Captured before the dialog takes focus so it can be handed back on close.
  useLayoutEffect(() => {
    const modal = modalRef.current;
    const panel = dialogRef.current;
    if (!open || !modal || !panel) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    modal.showModal();
    if (openDialogs.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openDialogs.push(modal);

    const focusableElements = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(":disabled") &&
          !element.closest("[inert]") &&
          element.getClientRects().length > 0,
      );
    const focusable = focusableElements();
    const initialTarget = initialFocusRef?.current;
    const target =
      initialTarget && focusable.includes(initialTarget)
        ? initialTarget
        : (focusable[0] ?? panel);
    target.focus();

    // Disabling or removing the focused control can leave focus on BODY.
    // Listen there too, while only the top modal owns keyboard navigation.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (openDialogs.at(-1) !== modal) return;
      if (event.key !== "Tab") return;

      const controls = focusableElements();
      const first = controls[0];
      const last = controls.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (
        !controls.some((control) => control === active) ||
        (event.shiftKey ? active === first : active === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      openDialogs.splice(openDialogs.indexOf(modal), 1);
      modal.close();
      if (openDialogs.length === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }
      opener?.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  // Deliberately not driven by AnimatePresence. Inside the portal it animated
  // out but never unmounted, leaving an invisible surface over the middle of
  // the page that still took clicks; outside the portal it never mounted at
  // all, because a portal is not an animatable child. Mounting is plain
  // conditional rendering, so it cannot fail in either direction, and the
  // entrance is a CSS animation that skips itself under reduced motion.
  return createPortal(
    <dialog
      ref={modalRef}
      aria-labelledby={titleId}
      aria-describedby={describedById}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className="fixed inset-0 z-50 m-0 h-full w-full max-h-none max-w-none border-0 bg-transparent p-0 text-inherit outline-none [&::backdrop]:bg-transparent"
    >
      <div
        className="dialog-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={requestClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        className={variant === "drawer"
          ? "absolute inset-y-0 left-0 h-full w-[280px] max-w-[85vw] border-r border-border bg-bg-secondary shadow-xl outline-none"
          : `dialog-panel absolute top-1/2 left-1/2 w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-md ${maxWidthClassName} outline-none`}
      >
        {variant === "drawer" ? (
          <>
            <h2 id={titleId} className="sr-only">{title}</h2>
            {children}
          </>
        ) : <div className="bg-bg-elevated border border-border-strong rounded-md shadow-xl">
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
        </div>}
      </div>
    </dialog>,
    document.body,
  );
}
