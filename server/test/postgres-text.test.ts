import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AiCreateRequestSchema, CreateDocumentSchema, ListDocumentsQuerySchema, PostgresTextSchema, UpdateDocumentSchema } from "@typesync/shared";
import { decodeDocumentCursor, encodeDocumentCursor } from "../src/services/document-cursor.ts";

test("PostgreSQL text boundaries reject only null characters and preserve request defaults", () => {
  const id = randomUUID();
  const request = { requestId: id, action: "rewrite", sourceText: "Hello", from: [1], to: [2] };
  for (const [schema, payload] of [
    [CreateDocumentSchema, { title: "bad\u0000title" }],
    [UpdateDocumentSchema, { title: "bad\u0000title" }],
    [ListDocumentsQuerySchema, { q: "bad\u0000query" }],
    [AiCreateRequestSchema, { ...request, instruction: "bad\u0000instruction" }],
    [AiCreateRequestSchema, { ...request, sourceText: "bad\u0000source" }],
  ] as const) assert.equal(schema.safeParse(payload).success, false);
  assert.throws(() => decodeDocumentCursor(encodeDocumentCursor({ sort: "alphabetical", title: "bad\u0000title", id }), "alphabetical"), { statusCode: 400 });
  const title = "é e\u0301 😀\n\t\u0001";
  assert.equal(PostgresTextSchema.parse(title), title);
  assert.deepEqual(CreateDocumentSchema.parse({}), { title: "Untitled" });
  assert.deepEqual(CreateDocumentSchema.parse({ title }), { title });
  assert.deepEqual(UpdateDocumentSchema.parse({}), {});
  assert.deepEqual(UpdateDocumentSchema.parse({ title }), { title });
  assert.equal(ListDocumentsQuerySchema.parse({ q: "  hello  " }).q, "hello");
  assert.equal(AiCreateRequestSchema.parse({ ...request, instruction: "  hello  " }).instruction, "hello");
  assert.equal(AiCreateRequestSchema.parse(request).instruction, "");
  assert.deepEqual(decodeDocumentCursor(encodeDocumentCursor({ sort: "alphabetical", title: title.repeat(20), id }), "alphabetical"), { sort: "alphabetical", title: title.repeat(20), id });
});
