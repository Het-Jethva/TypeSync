import "dotenv/config";
import { z } from "zod";
import { parseListenPort } from "./lib/listen-port.js";

const AuthCookieSameSiteSchema = z.enum(["lax", "none"]);
const REJECTED_AUTH_SECRETS = new Set([
  "replace-this-with-a-random-secret-at-least-32-characters",
  "your-secret-key-change-in-production",
]);

const requiredString = () =>
  z.string({
    error: (issue) => (issue.input === undefined ? "is required" : undefined),
  });

const DatabaseUrlSchema = requiredString()
  .trim()
  .min(1, { error: "is required", abort: true })
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    } catch {
      return false;
    }
  }, "must be a valid PostgreSQL URL");

const HttpUrlSchema = requiredString()
  .trim()
  .min(1, { error: "is required", abort: true })
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "must be a valid HTTP(S) URL");

const ClientOriginSchema = HttpUrlSchema.transform((value) => new URL(value).origin);

const ResendApiKeySchema = requiredString().trim().regex(/^re_[A-Za-z0-9_]+$/, "must be a Resend API key");
const EmailFromSchema = requiredString().trim().refine((value) => {
  if (/[\r\n]/.test(value)) return false;
  const address = value.match(/^[^<>]+<([^<>]+)>$/)?.[1] ?? value;
  return z.email().safeParse(address.trim()).success;
}, "must be an email address or Name <email@example.com>");

const ProductionConfigSchema = z.object({
  DATABASE_URL: DatabaseUrlSchema,
  BETTER_AUTH_SECRET: requiredString()
    .trim()
    .min(32, { error: "must be at least 32 characters", abort: true })
    .refine(
      (value) => !REJECTED_AUTH_SECRETS.has(value),
      "must not use the documented placeholder value"
    ),
  BETTER_AUTH_URL: HttpUrlSchema,
  VITE_CLIENT_URL: ClientOriginSchema,
  AUTH_COOKIE_SAME_SITE: z.preprocess(
    (value) => typeof value === "string" ? value.toLowerCase() : value,
    AuthCookieSameSiteSchema
  ),
  RESEND_API_KEY: ResendApiKeySchema,
  EMAIL_FROM: EmailFromSchema,
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
  port: parseListenPort(process.env.PORT),
  clientUrl:
    productionConfig?.VITE_CLIENT_URL ??
    ClientOriginSchema.parse(process.env.VITE_CLIENT_URL ?? "http://localhost:5173"),
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
  resendApiKey: productionConfig?.RESEND_API_KEY ??
    (process.env.RESEND_API_KEY ? ResendApiKeySchema.parse(process.env.RESEND_API_KEY) : undefined),
  emailFrom: productionConfig?.EMAIL_FROM ??
    (process.env.EMAIL_FROM ? EmailFromSchema.parse(process.env.EMAIL_FROM) : undefined),
} as const;
