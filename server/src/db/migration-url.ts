import { z } from "zod";

const MigrationUrlSchema = z.string().trim().min(1).refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.hostname.length > 0;
  } catch {
    return false;
  }
});

export function readMigrationUrl(env: {
  NODE_ENV?: string;
  MIGRATION_DATABASE_URL?: string;
  DATABASE_URL?: string;
}): string {
  const name = env.NODE_ENV === "production" || env.MIGRATION_DATABASE_URL !== undefined
    ? "MIGRATION_DATABASE_URL"
    : "DATABASE_URL";
  const parsed = MigrationUrlSchema.safeParse(env[name]);
  if (!parsed.success) {
    throw new Error(`${name} must be a nonempty, valid PostgreSQL URL`);
  }
  return parsed.data;
}
