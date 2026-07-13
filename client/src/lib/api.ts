import type {
  ApiResponse,
  Document,
  DocumentWithRole,
  CreateDocumentRequest,
  UpdateDocumentRequest,
  AddCollaboratorRequest,
  DocumentCollaborator,
  DocumentCollaboratorWithUser,
} from "@typesync/shared";

const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : "/api";

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

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

export const api = {
  documents: {
    list: () =>
      request<(Document & { role: string })[]>("/documents"),

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
