import { z } from "zod";

export function getAuthDestination(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\") ||
    Array.from(value).some(character => character.charCodeAt(0) <= 32)) {
    return "/dashboard";
  }
  try {
    const url = new URL(value, "https://typesync.invalid");
    const pathname = decodeURIComponent(url.pathname).toLowerCase();
    if (pathname.startsWith("//") || pathname.includes("\\") ||
      Array.from(pathname).some(character => character.charCodeAt(0) <= 32)) return "/dashboard";
    if (pathname === "/auth" || pathname.startsWith("/auth/")) return "/dashboard";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/dashboard";
  }
}

export function getAuthPath({ mode, destination }: {
  mode: "signin" | "signup";
  destination: string;
}): string {
  const query = new URLSearchParams({ next: destination });
  return `/auth/${mode}?${query}`;
}

export const DOCUMENT_MAX_UPDATE_BYTES = 12 * 1024 * 1024;

export const PostgresTextSchema = z.string().refine(value => !value.includes("\u0000"), {
  message: "Text cannot contain null characters",
});

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

// PostgreSQL's UTF-8 COLLATE "C" orders valid Unicode by code point.
export function compareDocumentTitles(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0);
  for (const [index, leftPoint] of leftPoints.entries()) {
    const rightPoint = rightPoints[index];
    if (rightPoint === undefined) return 1;
    const difference = leftPoint - rightPoint;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

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
  "ai:create": (documentId: string, request: AiCreateRequest, acknowledge: (result: AiResult) => void) => void;
  "ai:list": (documentId: string, acknowledge: (result: AiListResult) => void) => void;
  "ai:resolve": (documentId: string, request: AiResolveRequest, acknowledge: (result: AiResult) => void) => void;
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
  | "rate-limited"
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
      currentRevision: number;
    }
  | {
      success: false;
      code: DocumentJoinErrorCode;
      error: string;
    };

export interface ServerToClientEvents {
  "ai:suggestion": (payload: { documentId: string; suggestion: AiSuggestion }) => void;
  "doc:update": (payload: {
    documentId: string;
    update: Uint8Array;
    source: { epoch: string; revision: number } & (
      { kind: "edit" } | { kind: "ai-acceptance"; socketId: string }
    );
  }) => void;
  "awareness:update": (payload: { documentId: string; update: Uint8Array }) => void;
  "doc:permission-updated": (payload: { documentId: string; role: Role }) => void;
  "doc:permission-revoked": (payload: { documentId: string }) => void;
  "doc:title-updated": (payload: { documentId: string; title: string; updatedAt: string }) => void;
  "doc:saved": (payload: {
    documentId: string;
    title: string;
    updatedAt: string;
    revision: number;
    epoch: string;
  }) => void;
  "doc:size-status": (payload: DocumentSizeStatus) => void;
  "doc:error": (payload: { documentId?: string; message: string }) => void;
}

export const AiActionSchema = z.enum(["rewrite", "shorten", "grammar", "custom"]);
export type AiAction = z.infer<typeof AiActionSchema>;
const AiAnchorSchema = z.array(z.number().int().min(0).max(255)).min(1).max(2048);
export const AiCreateRequestSchema = z.object({
  requestId: z.string().uuid(),
  action: AiActionSchema,
  instruction: PostgresTextSchema.trim().max(2000).default(""),
  sourceText: PostgresTextSchema.min(1).max(12000),
  from: AiAnchorSchema,
  to: AiAnchorSchema,
}).refine(value => value.action !== "custom" || value.instruction.length > 0, {
  message: "Write an instruction for the AI", path: ["instruction"],
});
export type AiCreateRequest = z.infer<typeof AiCreateRequestSchema>;
export const AiResolveRequestSchema = z.object({
  suggestionId: z.string().uuid(),
  decision: z.enum(["accept", "reject"]),
});
export type AiResolveRequest = z.infer<typeof AiResolveRequestSchema>;
export const AiSuggestionSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  documentId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  action: AiActionSchema,
  instruction: z.string(),
  sourceText: z.string(),
  replacement: z.string(),
  from: AiAnchorSchema,
  to: AiAnchorSchema,
  model: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).and(z.discriminatedUnion("status", [
  z.object({ status: z.literal("streaming") }),
  z.object({ status: z.literal("ready") }),
  z.object({ status: z.literal("accepted"), resolvedBy: z.string() }),
  z.object({ status: z.literal("rejected"), resolvedBy: z.string() }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]));
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;
export type AiResult = { success: true; suggestion: AiSuggestion } | { success: false; error: string };
export type AiListResult = { success: true; suggestions: AiSuggestion[]; configured: boolean } | { success: false; error: string };

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
  q: PostgresTextSchema.trim().min(1).max(200).optional(),
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
  title: PostgresTextSchema.min(1, "Title is required").max(100).optional().default("Untitled"),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentSchema>;

export const UpdateDocumentSchema = z.object({
  title: PostgresTextSchema.min(1, "Title is required").max(100).optional(),
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
