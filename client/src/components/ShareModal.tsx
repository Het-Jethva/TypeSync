import { useState, useEffect, useCallback, useRef, useId } from "react";
import { Dialog } from "./Dialog";
import { Select } from "./Select";
import { api } from "../lib/api";
import { errorMessage } from "../lib/error-message";
import {
  AddCollaboratorSchema,
  type DocumentCollaboratorWithUser,
} from "@typesync/shared";

interface ShareModalProps {
  documentId: string;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

type CollaboratorsState =
  | { status: "loading" }
  | { status: "loaded"; collaborators: DocumentCollaboratorWithUser[] }
  | { status: "failed"; message: string };

export function ShareModal({
  documentId,
  open,
  onClose,
  onUpdate,
}: ShareModalProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [collaboratorsState, setCollaboratorsState] = useState<CollaboratorsState>({
    status: "loading",
  });
  const collaboratorsRequestGenerationRef = useRef(0);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const emailId = `share-email-${useId().replace(/:/g, "")}`;
  const roleId = `share-role-${useId().replace(/:/g, "")}`;
  const statusId = `share-status-${useId().replace(/:/g, "")}`;

  const fetchCollaborators = useCallback(async () => {
    const requestGeneration = ++collaboratorsRequestGenerationRef.current;
    setCollaboratorsState({ status: "loading" });

    try {
      const res = await api.documents.listCollaborators(documentId);
      if (requestGeneration !== collaboratorsRequestGenerationRef.current)
        return;
      setCollaboratorsState({ status: "loaded", collaborators: res });
    } catch (err) {
      if (requestGeneration !== collaboratorsRequestGenerationRef.current)
        return;
      console.error("Failed to fetch collaborators:", err);
      setCollaboratorsState({
        status: "failed",
        message: errorMessage(err, "Failed to fetch collaborators"),
      });
    }
  }, [documentId]);

  useEffect(() => {
    if (!open) return;

    collaboratorsRequestGenerationRef.current += 1;
    setEmail("");
    setError("");
    setSuccess("");
    setCollaboratorsState({ status: "loading" });
    void fetchCollaborators();

    return () => {
      collaboratorsRequestGenerationRef.current += 1;
    };
  }, [fetchCollaborators, open]);

  const handleUpdateRole = async (
    targetEmail: string,
    newRole: "editor" | "viewer",
  ) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      setError("");
      setSuccess("");
      await api.documents.addCollaborator(documentId, {
        email: targetEmail,
        role: newRole,
      });
      void fetchCollaborators();
      onUpdate();
    } catch (err) {
      setError(errorMessage(err, "Failed to update collaborator role"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      setError("");
      setSuccess("");
      await api.documents.removeCollaborator(documentId, userId);
      void fetchCollaborators();
      onUpdate();
    } catch (err) {
      setError(errorMessage(err, "Failed to remove collaborator"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
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
        `${email} was added as ${role === "editor" ? "an editor" : "a viewer"}.`,
      );
      setEmail("");
      onUpdate();
      void fetchCollaborators();
    } catch (err) {
      setError(errorMessage(err, "Failed to add collaborator"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share document"
      describedById={statusId}
      busy={isLoading}
      initialFocusRef={emailInputRef}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor={emailId}
            className="block text-micro font-semibold text-text-secondary uppercase tracking-wider mb-1.5"
          >
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
            className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-ui text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light transition-[background-color,border-color,color,box-shadow]"
            disabled={isLoading}
          />
          <p className="mt-1.5 text-micro leading-relaxed text-text-muted">
            The collaborator must already have a TypeSync account using this
            email.
          </p>
        </div>

        <div>
          <fieldset>
            <legend className="block text-micro font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Role
            </legend>
            <div id={roleId} className="flex gap-2" aria-label="Invitee role">
              {(["editor", "viewer"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  aria-pressed={role === r}
                  className={`flex-1 py-1.5 rounded text-ui font-medium transition-[background-color,border-color,color,box-shadow] border ${
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
            <p className="text-ui text-error bg-error/5 border border-error/20 rounded px-3 py-2">
              {error}
            </p>
          )}
          {!error && success && (
            <p className="text-ui text-success bg-success/5 border border-success/20 rounded px-3 py-2">
              {success}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full btn-linear-primary text-ui"
        >
          {isLoading ? "Saving changes…" : "Add collaborator"}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-border">
        <h3 className="text-micro font-semibold text-text-primary uppercase tracking-wider mb-3">
          Who has access
        </h3>

        {collaboratorsState.status === "loading" ? (
          <div
            className="flex items-center justify-center gap-2 py-2"
            role="status"
            aria-live="polite"
          >
            <div
              className="w-4 h-4 border-2 border-border-strong border-t-accent rounded-full animate-spin"
              aria-hidden="true"
            />
            <span className="text-ui font-medium text-text-muted">
              Loading collaborators…
            </span>
          </div>
        ) : collaboratorsState.status === "failed" ? (
          <div role="status" aria-live="polite" className="space-y-2">
            <p className="text-ui text-error">{collaboratorsState.message}</p>
            <button
              type="button"
              onClick={() => void fetchCollaborators()}
              className="btn-linear-primary text-ui px-3 py-1.5"
            >
              Try again
            </button>
          </div>
        ) : collaboratorsState.collaborators.length === 0 ? (
          <p className="text-ui text-text-muted">
            Only you have access to this document.
          </p>
        ) : (
          <div className="space-y-3 max-h-[160px] overflow-y-auto pr-1">
            {collaboratorsState.collaborators.map((collab) => (
              <div
                key={collab.user.id}
                className="flex items-center justify-between gap-3 text-ui"
              >
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <div className="w-5.5 h-5.5 rounded bg-bg-secondary border border-border-strong flex items-center justify-center text-micro font-medium text-text-primary shrink-0">
                    {collab.user.name?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary truncate">
                      {collab.user.name}
                    </p>
                    <p className="text-micro text-text-muted truncate">
                      {collab.user.email}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Select
                    disabled={isLoading}
                    value={collab.role}
                    onChange={(e) => {
                      const parsedRole = AddCollaboratorSchema.shape.role.safeParse(
                        e.target.value
                      );
                      if (!parsedRole.success) return;
                      handleUpdateRole(collab.user.email, parsedRole.data);
                    }}
                    aria-label={`Role for ${collab.user.name}`}
                    name={`role-${collab.user.id}`}
                    className="bg-bg-secondary py-0.5 text-micro"
                    wrapperClassName="shrink-0"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </Select>

                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleRemoveCollaborator(collab.user.id)}
                    aria-label={`Remove ${collab.user.name}`}
                    className="touch-target p-1 rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
