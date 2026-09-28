import { createContext, useContext } from "react";

export type BackendReadinessStatus =
  | "waking"
  | "ready"
  | "delayed"
  | "unavailable";

export type BackendReadinessContextValue = {
  status: BackendReadinessStatus;
  retry: () => void;
};

export const BackendReadinessContext =
  createContext<BackendReadinessContextValue | null>(null);

export function useBackendReadiness() {
  const context = useContext(BackendReadinessContext);

  if (!context) {
    throw new Error(
      "useBackendReadiness must be used within BackendReadinessProvider"
    );
  }

  return context;
}
