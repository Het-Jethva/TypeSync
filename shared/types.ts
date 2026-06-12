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

export interface DocumentWithCollaborators extends Document {
  collaborators: DocumentCollaborator[];
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

// ─── User Presence ───────────────────────────────────────
export interface UserPresence {
  userId: string;
  name: string;
  email: string;
  color: string;
  cursor?: {
    anchor: number;
    head: number;
  };
}

// ─── Socket Events ───────────────────────────────────────
export interface ClientToServerEvents {
  "doc:join": (documentId: string) => void;
  "doc:leave": (documentId: string) => void;
  "doc:update": (documentId: string, update: Uint8Array) => void;
  "awareness:update": (documentId: string, update: Uint8Array) => void;
}

export interface ServerToClientEvents {
  "doc:sync": (state: Uint8Array) => void;
  "doc:update": (update: Uint8Array) => void;
  "awareness:update": (update: Uint8Array) => void;
  "doc:error": (message: string) => void;
}

// ─── API Types ───────────────────────────────────────────
export interface CreateDocumentRequest {
  title: string;
}

export interface UpdateDocumentRequest {
  title?: string;
}

export interface AddCollaboratorRequest {
  email: string;
  role: "editor" | "viewer";
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
