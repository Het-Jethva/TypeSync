import { z } from "zod";
import type { ListDocumentsQuery } from "@typesync/shared";
import { AppError } from "../middleware/error.js";

export type DocumentListSort = ListDocumentsQuery["sort"];

const UpdatedCursorSchema = z.object({
  sort: z.literal("updated"),
  updatedAt: z.string().datetime(),
  id: z.string().uuid(),
}).strict();

const CreatedCursorSchema = z.object({
  sort: z.literal("created"),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
}).strict();

const AlphabeticalCursorSchema = z.object({
  sort: z.literal("alphabetical"),
  title: z.string(),
  id: z.string().uuid(),
}).strict();

const DocumentCursorSchema = z.discriminatedUnion("sort", [
  UpdatedCursorSchema,
  CreatedCursorSchema,
  AlphabeticalCursorSchema,
]);

export type DocumentCursor =
  | { sort: "updated"; updatedAt: Date; id: string }
  | { sort: "created"; createdAt: Date; id: string }
  | { sort: "alphabetical"; title: string; id: string };

type CursorSource = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export function documentCursorFor(sort: DocumentListSort, item: CursorSource): DocumentCursor {
  switch (sort) {
    case "updated":
      return { sort, updatedAt: item.updatedAt, id: item.id };
    case "created":
      return { sort, createdAt: item.createdAt, id: item.id };
    case "alphabetical":
      return { sort, title: item.title, id: item.id };
  }
}

export function encodeDocumentCursor(cursor: DocumentCursor): string {
  const payload =
    cursor.sort === "updated"
      ? { sort: cursor.sort, updatedAt: cursor.updatedAt.toISOString(), id: cursor.id }
      : cursor.sort === "created"
        ? { sort: cursor.sort, createdAt: cursor.createdAt.toISOString(), id: cursor.id }
        : { sort: cursor.sort, title: cursor.title, id: cursor.id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeDocumentCursor(cursor: string, sort: DocumentListSort): DocumentCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid encoding");
    const parsed = DocumentCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
    if (parsed.sort !== sort) throw new Error("Sort mismatch");
    if (parsed.sort === "updated") {
      return { sort: parsed.sort, updatedAt: new Date(parsed.updatedAt), id: parsed.id };
    }
    if (parsed.sort === "created") {
      return { sort: parsed.sort, createdAt: new Date(parsed.createdAt), id: parsed.id };
    }
    return { sort: parsed.sort, title: parsed.title, id: parsed.id };
  } catch {
    throw new AppError(400, "Invalid document cursor");
  }
}
