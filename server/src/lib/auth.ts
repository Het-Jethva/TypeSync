import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { config } from "../config.js";
import { sendVerificationEmail } from "./verification-email.js";
import { getAuthDestination, getAuthPath } from "@typesync/shared";

export const AUTH_CLIENT_IP_HEADER = "x-typesync-client-ip";

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
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60,
    async sendVerificationEmail({ user, url }) {
      const verificationUrl = new URL(url);
      let destination = "/dashboard";
      const requestedCallback = verificationUrl.searchParams.get("callbackURL") ?? "/";
      if (URL.canParse(requestedCallback, config.clientUrl)) {
        const callback = new URL(requestedCallback, config.clientUrl);
        if (callback.origin === config.clientUrl) {
          destination = getAuthDestination(
            callback.pathname === "/auth/signin"
              ? callback.searchParams.get("next")
              : callback.pathname === "/" ? null : callback.pathname + callback.search + callback.hash,
          );
        }
      }
      const callback = new URL(getAuthPath({ mode: "signin", destination }), config.clientUrl);
      callback.searchParams.set("verified", "1");
      verificationUrl.searchParams.set("callbackURL", callback.href);
      await sendVerificationEmail({ email: user.email, url: verificationUrl.href });
    },
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
    ipAddress: {
      ipAddressHeaders: [AUTH_CLIENT_IP_HEADER],
    },
    defaultCookieAttributes: {
      sameSite: config.authCookieSameSite,
      secure: config.isProduction || config.authCookieSameSite === "none",
      httpOnly: true,
    },
  },
});
