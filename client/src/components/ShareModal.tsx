import { useState, useEffect, useCallback, useRef, useId, useLayoutEffect } from "react";
import { motion } from "motion/react";
import { api } from "../lib/api";
import type { DocumentCollaboratorWithUser } from "@typesync/shared";

interface ShareModalProps {
  documentId: string;
  onClose: () => void;
  onUpdate: () => void;
}

export function ShareModal({ documentId, onClose, onUpdate }: ShareModalProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [collaborators, setCollaborators] = useState<DocumentCollaboratorWithUser[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const collaboratorsRequestGenerationRef = useRef(0);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailId = `share-email-${useId().replace(/:/g, "")}`;
  const roleId = `share-role-${useId().replace(/:/g, "")}`;
  const titleId = `share-title-${useId().replace(/:/g, "")}`;
  const statusId = `share-status-${useId().replace(/:/g, "")}`;

  const fetchCollaborators = useCallback(async () => {
    const requestGeneration = ++collaboratorsRequestGenerationRef.current;
    setIsFetching(true);

    try {
      const res = await api.documents.listCollaborators(documentId);
      if (requestGeneration !== collaboratorsRequestGenerationRef.current) return;
      if (res.data) {
        setCollaborators(res.data);
      }
    } catch (err) {
      if (requestGeneration !== collaboratorsRequestGenerationRef.current) return;
      console.error("Failed to fetch collaborators:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch collaborators");
    } finally {
      if (requestGeneration === collaboratorsRequestGenerationRef.current) {
        setIsFetching(false);
      }
    }
  }, [documentId]);

  useEffect(() => {
    collaboratorsRequestGenerationRef.current += 1;
    setCollaborators([]);
    setError("");
    setSuccess("");
    setIsFetching(true);
    void fetchCollaborators();

    return () => {
      collaboratorsRequestGenerationRef.current += 1;
    };
  }, [fetchCollaborators]);

  const handleUpdateRole = async (targetEmail: string, newRole: "editor" | "viewer") => {
    try {
      setError("");
      setSuccess("");
      await api.documents.addCollaborator(documentId, { email: targetEmail, role: newRole });
      await fetchCollaborators();
      onUpdate();
    } catch (err: any) {
      setError(err.message || "Failed to update collaborator role");
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    try {
      setError("");
      setSuccess("");
      await api.documents.removeCollaborator(documentId, userId);
      await fetchCollaborators();
      onUpdate();
    } catch (err: any) {
      setError(err.message || "Failed to remove collaborator");
    }
  };

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    emailInputRef.current?.focus();

    return () => {
      opener?.focus();
    };
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!isLoading) onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
    );
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setIsLoading(true);
    try {
      await api.documents.addCollaborator(documentId, { email, role });
      setSuccess(
        `${email} was added as ${role === "editor" ? "an editor" : "a viewer"}.`
      );
      setEmail("");
      onUpdate();
      await fetchCollaborators();
    } catch (err: any) {
      setError(err.message || "Failed to add collaborator");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={statusId}
        aria-busy={isLoading || isFetching}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
      >
        <div className="bg-bg-elevated border border-border-strong rounded-md p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <h2 id={titleId} className="text-sm font-semibold text-text-primary">Share document</h2>
            <button
              onClick={onClose}
              aria-label="Close share dialog"
              className="touch-target w-6.5 h-6.5 rounded hover:bg-bg-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
                <path d="M18 6L6 18M6 6l12 12" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor={emailId} className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                Email address
              </label>
              <input
                ref={emailInputRef}
                id={emailId}
                name="email"
                autoComplete="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
                disabled={isLoading}
              />
              <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">
                The collaborator must already have a TypeSync account using this email.
              </p>
            </div>

            <div>
              <fieldset>
                <legend className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                  Role
                </legend>
              <div id={roleId} className="flex gap-2" aria-label="Invitee role">
                {(["editor", "viewer"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    aria-pressed={role === r}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-[background-color,border-color,color,box-shadow] border ${
                      role === r
                        ? "bg-accent-light border-border-accent text-accent font-semibold"
                        : "border-border bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    }`}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
              </fieldset>
            </div>

            <div id={statusId} aria-live="polite" aria-atomic="true">
              {error && (
                <p className="text-xs text-error bg-error/5 border border-error/20 rounded px-3 py-2">
                  {error}
                </p>
              )}
              {!error && success && (
                <p className="text-xs text-success bg-success/5 border border-success/20 rounded px-3 py-2">
                  {success}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-linear-primary text-xs"
            >
              {isLoading ? "Adding collaborator…" : "Add collaborator"}
            </button>
          </form>

          {/* Collaborator List */}
          <div className="mt-6 pt-5 border-t border-border">
            <h3 className="text-[10px] font-semibold text-text-primary uppercase tracking-wider mb-3">
              Who has access
            </h3>
            
            {isFetching ? (
              <div className="flex justify-center py-2">
                <div className="w-4 h-4 border-2 border-border-strong border-t-accent rounded-full animate-spin" />
              </div>
            ) : collaborators.length === 0 ? (
              <p className="text-xs text-text-muted">Only you have access to this document.</p>
            ) : (
              <div className="space-y-3 max-h-[160px] overflow-y-auto pr-1">
                {collaborators.map((collab) => (
                  <div key={collab.user.id} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-5.5 h-5.5 rounded bg-bg-secondary border border-border-strong flex items-center justify-center text-[9px] font-medium text-text-primary shrink-0">
                        {collab.user.name?.charAt(0).toUpperCase() || "U"}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-text-primary truncate">{collab.user.name}</p>
                        <p className="text-[10px] text-text-muted truncate">{collab.user.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={collab.role}
                        onChange={(e) => handleUpdateRole(collab.user.email, e.target.value as "editor" | "viewer")}
                        aria-label={`Role for ${collab.user.name}`}
                        name={`role-${collab.user.id}`}
                        className="bg-bg-secondary border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none focus:border-border-accent"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => handleRemoveCollaborator(collab.user.id)}
                        aria-label={`Remove ${collab.user.name}`}
                        className="touch-target p-1 rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
