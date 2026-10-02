import { z } from "zod";
import { readApiPayload } from "./api-payload";
import { apiBaseUrl } from "./backend-url";
import {
  DocumentCollaboratorSchema,
  DocumentCollaboratorWithUserSchema,
  DocumentListPageSchema,
  DocumentSchema,
  DocumentWithRoleSchema,
  type AddCollaboratorRequest,
  type CreateDocumentRequest,
  type ListDocumentsQuery,
  type UpdateDocumentRequest,
} from "@typesync/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const noData = z.undefined();

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestInit
): Promise<T> {
  const { headers: overrides, ...rest } = options ?? {};
  const headers = new Headers(overrides);

  // A JSON content type only means something when there is a body, and it is
  // not a CORS-safelisted header: setting it on reads turns every GET into a
  // preflighted request, doubling the round trips against the backend origin.
  if (rest.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...rest,
    headers,
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch (error) {
    if (!res.ok) {
      throw new ApiError("Request failed", res.status);
    }
    throw error;
  }

  const payload = readApiPayload(json, schema);
  if (!res.ok || !payload.ok) {
    throw new ApiError(payload.ok ? "Request failed" : payload.error, res.status);
  }

  return payload.data;
}

export const api = {
  documents: {
    list: (pagination: Partial<ListDocumentsQuery> = {}) => {
      const params = new URLSearchParams();
      if (pagination.cursor) params.set("cursor", pagination.cursor);
      if (pagination.limit !== undefined) params.set("limit", String(pagination.limit));
      if (pagination.q) params.set("q", pagination.q);
      if (pagination.sort) params.set("sort", pagination.sort);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return request(`/documents${query}`, DocumentListPageSchema);
    },

    get: (id: string) => request(`/documents/${id}`, DocumentWithRoleSchema),

    create: (body: CreateDocumentRequest) =>
      request("/documents", DocumentSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),

    update: (id: string, body: UpdateDocumentRequest) =>
      request(`/documents/${id}`, DocumentSchema.optional(), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),

    delete: (id: string) =>
      request(`/documents/${id}`, noData, {
        method: "DELETE",
      }),

    addCollaborator: (docId: string, body: AddCollaboratorRequest) =>
      request(`/documents/${docId}/collaborators`, DocumentCollaboratorSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),

    listCollaborators: (docId: string) =>
      request(
        `/documents/${docId}/collaborators`,
        z.array(DocumentCollaboratorWithUserSchema)
      ),

    removeCollaborator: (docId: string, userId: string) =>
      request(`/documents/${docId}/collaborators/${userId}`, noData, {
        method: "DELETE",
      }),
  },
};
