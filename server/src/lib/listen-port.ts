import { z } from "zod";

const ListenPortSchema = z.number().int().min(1).max(65535);

export function parseListenPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3000;
  const parsed = ListenPortSchema.safeParse(Number(value));
  if (!parsed.success) throw new Error(`Invalid PORT: ${value}`);
  return parsed.data;
}
