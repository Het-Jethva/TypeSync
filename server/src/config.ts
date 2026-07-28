import "dotenv/config";
import { z } from "zod";

const AuthCookieSameSiteSchema = z.enum(["lax", "none"]);
const DOCUMENTED_PLACEHOLDER_AUTH_SECRET =
  "your-secret-key-change-in-production";

const DatabaseUrlSchema = z
  .string({ required_error: "is required" })
  .trim()
  .min(1, "is required")
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    } catch {
      return false;
    }
  }, "must be a valid PostgreSQL URL");

const HttpUrlSchema = z
  .string({ required_error: "is required" })
  .trim()
  .min(1, "is required")
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "must be a valid HTTP(S) URL");

const ProductionConfigSchema = z.object({
  DATABASE_URL: DatabaseUrlSchema,
  BETTER_AUTH_SECRET: z
    .string({ required_error: "is required" })
    .trim()
    .min(32, "must be at least 32 characters")
    .refine(
      (value) => value !== DOCUMENTED_PLACEHOLDER_AUTH_SECRET,
      "must not use the documented placeholder value"
    ),
  BETTER_AUTH_URL: HttpUrlSchema,
  VITE_CLIENT_URL: HttpUrlSchema,
  AUTH_COOKIE_SAME_SITE: z.preprocess(
    (value) => typeof value === "string" ? value.toLowerCase() : value,
    AuthCookieSameSiteSchema
  ),
});

function readProductionConfig(): z.infer<typeof ProductionConfigSchema> {
  const parsed = ProductionConfigSchema.safeParse(process.env);
  if (parsed.success) {
    return parsed.data;
  }

  const failures = Object.entries(parsed.error.flatten().fieldErrors)
    .flatMap(([name, messages]) =>
      (messages ?? []).map((message) => `- ${name}: ${message}`)
    )
    .join("\n");
  throw new Error(`Invalid production configuration:\n${failures}`);
}

const isProduction = process.env.NODE_ENV === "production";
const productionConfig = isProduction ? readProductionConfig() : undefined;
const configuredCookieSameSite =
  process.env.AUTH_COOKIE_SAME_SITE?.toLowerCase();
const developmentCookieSameSite = configuredCookieSameSite
  ? AuthCookieSameSiteSchema.parse(configuredCookieSameSite)
  : "lax";

export const config = {
  port: Number(process.env.PORT) || 3000,
  clientUrl:
    productionConfig?.VITE_CLIENT_URL ??
    process.env.VITE_CLIENT_URL ??
    "http://localhost:5173",
  databaseUrl: productionConfig?.DATABASE_URL ?? process.env.DATABASE_URL,
  betterAuthSecret:
    productionConfig?.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET,
  betterAuthUrl:
    productionConfig?.BETTER_AUTH_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000",
  authCookieSameSite:
    productionConfig?.AUTH_COOKIE_SAME_SITE ?? developmentCookieSameSite,
  isProduction,
} as const;
