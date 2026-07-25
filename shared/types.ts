import { z } from "zod";

// ─── Roles ───────────────────────────────────────────────
export const ROLES = {
  OWNER: "owner",
  EDITOR: "editor",
  VIEWER: "viewer",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// ─── Document ────────────────────────────────────────────
export interface Document {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentWithRole extends Document {
  role: Role;
}

export interface DocumentCollaborator {
  id: string;
  documentId: string;
  userId: string;
  role: Role;
  invitedAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
}

export interface DocumentCollaboratorWithUser extends DocumentCollaborator {
  user: NonNullable<DocumentCollaborator["user"]>;
}

// ─── User Presence ───────────────────────────────────────
export interface PresenceIdentity {
  userId: string;
  name: string;
  color: string;
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
  | "not-joined"
  | "forbidden"
  | "invalid-payload"
  | "update-too-large"
  | "document-too-large"
  | "document-not-loaded";

export type DocumentUpdateResult =
  | { success: true }
  | {
      success: false;
      code: DocumentUpdateErrorCode;
      error: string;
    };

export type DocumentJoinResult =
  | {
      success: true;
      state: Uint8Array;
      stateVector: Uint8Array;
      role: Role;
      presence: PresenceIdentity;
    }
  | {
      success: false;
      error: string;
    };

export interface ServerToClientEvents {
  "doc:update": (payload: { documentId: string; update: Uint8Array }) => void;
  "awareness:update": (payload: { documentId: string; update: Uint8Array }) => void;
  "doc:permission-updated": (payload: { documentId: string; role: Role }) => void;
  "doc:permission-revoked": (payload: { documentId: string }) => void;
  "doc:title-updated": (payload: { documentId: string; title: string; updatedAt: string }) => void;
  "doc:saved": (payload: { documentId: string; updatedAt: string }) => void;
  "doc:size-status": (payload: DocumentSizeStatus) => void;
  "doc:error": (payload: { documentId?: string; message: string }) => void;
}

export interface DocumentSizeStatus {
  documentId: string;
  level: "warning" | "limit";
  reason: "update" | "document";
  bytes: number;
  maxBytes: number;
}

// ─── API Types ───────────────────────────────────────────
export const ListDocumentsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;

export interface DocumentListPage {
  items: DocumentWithRole[];
  nextCursor: string | null;
}

export const CreateDocumentSchema = z.object({
  title: z.string().min(1, "Title is required").max(100).optional().default("Untitled"),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentSchema>;

export const UpdateDocumentSchema = z.object({
  title: z.string().min(1, "Title is required").max(100).optional(),
});
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentSchema>;

export const AddCollaboratorSchema = z.object({
  email: z.string().email(),
  role: z.enum(["editor", "viewer"]),
});
export type AddCollaboratorRequest = z.infer<typeof AddCollaboratorSchema>;

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
