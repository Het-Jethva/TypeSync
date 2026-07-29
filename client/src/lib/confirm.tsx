import { useCallback, useRef, useState, type ReactNode } from "react";
import { Dialog } from "../components/Dialog";
import {
  ConfirmContext,
  type ConfirmRequest,
  type ConfirmContextValue,
} from "./confirm-context";

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  // Held outside state so settling never becomes a side effect inside a state
  // updater, which StrictMode is free to invoke more than once.
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmContextValue>((next) => {
    return new Promise<boolean>((resolve) => {
      // A second request while one is open means the first is no longer the
      // question being asked. Decline it rather than leaving it unresolved.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setRequest(next);
    });
  }, []);

  const settle = useCallback((accepted: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(accepted);
  }, []);

  const isDanger = request?.tone === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={request !== null}
        onClose={() => settle(false)}
        title={request?.title ?? ""}
        maxWidthClassName="max-w-sm"
        // Destructive prompts open on the way out, not the way through.
        initialFocusRef={isDanger ? cancelButtonRef : confirmButtonRef}
        footer={
          <>
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={() => settle(false)}
              className="btn-linear"
            >
              {request?.cancelLabel ?? "Cancel"}
            </button>
            <button
              ref={confirmButtonRef}
              type="button"
              onClick={() => settle(true)}
              className={isDanger ? "btn-linear-danger" : "btn-linear-primary"}
            >
              {request?.confirmLabel ?? "Confirm"}
            </button>
          </>
        }
      >
        <p className="text-ui text-text-secondary leading-relaxed">
          {request?.message}
        </p>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
