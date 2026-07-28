import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { config } from "../config.js";

export const auth = betterAuth({
  secret: config.betterAuthSecret,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  trustedOrigins: [
    config.clientUrl,
  ],
  baseURL: config.betterAuthUrl,
  advanced: {
    crossSubDomainCookies: { enabled: false },
    defaultCookieAttributes: {
      sameSite: config.authCookieSameSite,
      secure: config.isProduction || config.authCookieSameSite === "none",
      httpOnly: true,
    },
  },
});
