import type {
  ApiResponse,
  Document,
  DocumentWithRole,
  CreateDocumentRequest,
  UpdateDocumentRequest,
  AddCollaboratorRequest,
  DocumentCollaborator,
  DocumentCollaboratorWithUser,
  DocumentListPage,
  ListDocumentsQuery,
} from "@typesync/shared";

const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  let data: ApiResponse<T>;
  try {
    data = (await res.json()) as ApiResponse<T>;
  } catch (error) {
    if (!res.ok) {
      throw new ApiError("Request failed", res.status);
    }
    throw error;
  }

  if (!res.ok) {
    throw new ApiError(
      typeof data.error === "string" ? data.error : "Request failed",
      res.status
    );
  }

  return data;
}

export const api = {
  documents: {
    list: (pagination: Partial<ListDocumentsQuery> = {}) => {
      const params = new URLSearchParams();
      if (pagination.cursor) params.set("cursor", pagination.cursor);
      if (pagination.limit !== undefined) params.set("limit", String(pagination.limit));
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return request<DocumentListPage>(`/documents${query}`);
    },

    get: (id: string) =>
      request<DocumentWithRole>(`/documents/${id}`),

    create: (body: CreateDocumentRequest) =>
      request<Document>("/documents", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    update: (id: string, body: UpdateDocumentRequest) =>
      request<Document>(`/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),

    delete: (id: string) =>
      request(`/documents/${id}`, {
        method: "DELETE",
      }),

    addCollaborator: (docId: string, body: AddCollaboratorRequest) =>
      request<DocumentCollaborator>(`/documents/${docId}/collaborators`, {
        method: "POST",
        body: JSON.stringify(body),
      }),

    listCollaborators: (docId: string) =>
      request<DocumentCollaboratorWithUser[]>(`/documents/${docId}/collaborators`),

    removeCollaborator: (docId: string, userId: string) =>
      request(`/documents/${docId}/collaborators/${userId}`, {
        method: "DELETE",
      }),
  },
};
