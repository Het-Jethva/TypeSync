import { z } from "zod";

export const DOCUMENT_MAX_UPDATE_BYTES = 12 * 1024 * 1024;

export const RoleSchema = z.enum(["owner", "editor", "viewer"]);
export type Role = z.infer<typeof RoleSchema>;

export const CollaboratorRoleSchema = z.enum(["editor", "viewer"]);
export type CollaboratorRole = z.infer<typeof CollaboratorRoleSchema>;

export type DocumentAccessRequirement = "owner" | "editor" | "any";

export function canEditDocument(role: Role | null): boolean {
  return role === "owner" || role === "editor";
}

export function documentRoleSatisfies(
  role: Role | null,
  required: DocumentAccessRequirement
): boolean {
  if (role === null) return false;
  switch (required) {
    case "any":
      return true;
    case "owner":
      return role === "owner";
    case "editor":
      return canEditDocument(role);
    default: {
      const unreachable: never = required;
      return unreachable;
    }
  }
}

export const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentWithRoleSchema = DocumentSchema.extend({
  role: RoleSchema,
});
export type DocumentWithRole = z.infer<typeof DocumentWithRoleSchema>;

export const CollaboratorUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable().optional(),
});

export const DocumentCollaboratorSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  userId: z.string(),
  role: CollaboratorRoleSchema,
  invitedAt: z.string(),
  user: CollaboratorUserSchema.optional(),
});
export type DocumentCollaborator = z.infer<typeof DocumentCollaboratorSchema>;

export const DocumentCollaboratorWithUserSchema = DocumentCollaboratorSchema.extend({
  user: CollaboratorUserSchema,
});
export type DocumentCollaboratorWithUser = z.infer<
  typeof DocumentCollaboratorWithUserSchema
>;

// ─── User Presence ───────────────────────────────────────
export interface PresenceIdentity {
  userId: string;
  name: string;
  color: string;
  /**
   * Role in the room this frame belongs to. Null before any room is joined.
   * Volatile like the rest of presence: a role change reaches other people on
   * the next frame that person sends.
   */
  role: Role | null;
}

// ─── Socket Events ───────────────────────────────────────
export interface ClientToServerEvents {
  "doc:join": (
    documentId: string,
    acknowledge: (result: DocumentJoinResult) => void
  ) => void;
  "doc:leave": (documentId: string) => void;
  "doc:update": (
    documentId: string,
    update: Uint8Array,
    acknowledge: (result: DocumentUpdateResult) => void
  ) => void;
  "awareness:update": (documentId: string, update: Uint8Array) => void;
}

export type DocumentUpdateErrorCode =
  | "server-draining"
  | "rate-limited"
  | "session-expired"
  | "unavailable"
  | "not-joined"
  | "forbidden"
  | "invalid-payload"
  | "update-too-large"
  | "document-too-large"
  | "document-not-loaded";

export type DocumentUpdateResult =
  | { success: true; revision: number; epoch: string }
  | {
      success: false;
      code: DocumentUpdateErrorCode;
      error: string;
    };

export type DocumentJoinErrorCode =
  | "invalid-id"
  | "session-expired"
  | "unavailable"
  | "cancelled"
  | "forbidden"
  | "server-draining"
  | "load-failed";

export type DocumentJoinResult =
  | {
      success: true;
      state: Uint8Array;
      role: Role;
      presence: PresenceIdentity;
      /** Unique document runtime generation, including across server restarts. */
      epoch: string;
      /** Highest revision of this epoch written to PostgreSQL. 0 if this epoch has not saved. */
      persistedRevision: number;
    }
  | {
      success: false;
      code: DocumentJoinErrorCode;
      error: string;
    };

export interface ServerToClientEvents {
  "doc:update": (payload: { documentId: string; update: Uint8Array }) => void;
  "awareness:update": (payload: { documentId: string; update: Uint8Array }) => void;
  "doc:permission-updated": (payload: { documentId: string; role: Role }) => void;
  "doc:permission-revoked": (payload: { documentId: string }) => void;
  "doc:title-updated": (payload: { documentId: string; title: string; updatedAt: string }) => void;
  "doc:saved": (payload: {
    documentId: string;
    updatedAt: string;
    revision: number;
    epoch: string;
  }) => void;
  "doc:size-status": (payload: DocumentSizeStatus) => void;
  "doc:error": (payload: { documentId?: string; message: string }) => void;
}

export interface DocumentSizeStatus {
  documentId: string;
  level: "ok" | "warning" | "limit";
  reason: "update" | "document";
  bytes: number;
  maxBytes: number;
}

// ─── API Types ───────────────────────────────────────────
export const ListDocumentsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Case-insensitive substring match on the title. */
  q: z.string().trim().min(1).max(200).optional(),
  /** Keyset order. A cursor is only valid for the same sort. */
  sort: z.enum(["updated", "created", "alphabetical"]).default("updated"),
});
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;

export const DocumentListPageSchema = z.object({
  items: z.array(DocumentWithRoleSchema),
  nextCursor: z.string().nullable(),
});
export type DocumentListPage = z.infer<typeof DocumentListPageSchema>;

export const CreateDocumentSchema = z.object({
  title: z.string().min(1, "Title is required").max(100).optional().default("Untitled"),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentSchema>;

export const UpdateDocumentSchema = z.object({
  title: z.string().min(1, "Title is required").max(100).optional(),
});
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentSchema>;

export const AddCollaboratorSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: CollaboratorRoleSchema,
});
export type AddCollaboratorRequest = z.infer<typeof AddCollaboratorSchema>;

export const ApiEnvelopeSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    data: z.unknown().optional(),
    error: z.never().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string().optional(),
    data: z.never().optional(),
  }),
]);
