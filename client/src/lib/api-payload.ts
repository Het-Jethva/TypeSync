import { z } from "zod";
import { ApiEnvelopeSchema } from "@typesync/shared";

export type ApiPayload<T> = { ok: true; data: T } | { ok: false; error: string };

export function readApiPayload<T>(payload: unknown, schema: z.ZodType<T>): ApiPayload<T> {
  const envelope = ApiEnvelopeSchema.safeParse(payload);
  if (!envelope.success) return { ok: false, error: "Request failed" };
  if (!envelope.data.success) {
    return { ok: false, error: envelope.data.error ?? "Request failed" };
  }
  const data = schema.safeParse(envelope.data.data);
  if (!data.success) return { ok: false, error: "Response was not valid" };
  return { ok: true, data: data.data };
}
