import { createContext, useContext } from "react";

export type ConfirmRequest = {
  title: string;
  message: string;
  /** Label for the affirmative action. Name the action, not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` styles the affirmative action as destructive. */
  tone?: "default" | "danger";
};

export type ConfirmContextValue = (request: ConfirmRequest) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * Returns an async `confirm` that resolves true when the user accepts. Unlike
 * `window.confirm` it does not block the main thread, so every caller must be
 * able to await it.
 */
export function useConfirm() {
  const context = useContext(ConfirmContext);

  if (!context) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }

  return context;
}
