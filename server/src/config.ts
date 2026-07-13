import "dotenv/config";
import { z } from "zod";

const AuthCookieSameSiteSchema = z.enum(["lax", "none"]);

function readAuthCookieSameSite(): z.infer<typeof AuthCookieSameSiteSchema> {
  const configured = process.env.AUTH_COOKIE_SAME_SITE?.toLowerCase();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_COOKIE_SAME_SITE must be set to 'lax' or 'none' in production"
      );
    }
    return "lax";
  }

  const parsed = AuthCookieSameSiteSchema.safeParse(configured);
  if (!parsed.success) {
    throw new Error("AUTH_COOKIE_SAME_SITE must be either 'lax' or 'none'");
  }
  return parsed.data;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  clientUrl: process.env.VITE_CLIENT_URL || "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL,
  betterAuthUrl: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  authCookieSameSite: readAuthCookieSameSite(),
  isProduction: process.env.NODE_ENV === "production",
} as const;
