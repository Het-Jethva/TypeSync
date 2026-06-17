import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { config } from "../config.js";

// Helper to determine cookie settings dynamically based on client and auth URLs
const getCookieConfig = (clientUrl: string, authUrl: string) => {
  try {
    const client = new URL(clientUrl);
    const auth = new URL(authUrl);

    const clientHost = client.hostname;
    const authHost = auth.hostname;

    // Check if running on localhost (dev environment)
    const isLocal =
      clientHost.includes("localhost") ||
      clientHost.includes("127.0.0.1") ||
      authHost.includes("localhost") ||
      authHost.includes("127.0.0.1");

    if (isLocal) {
      return {
        crossSubDomainCookies: { enabled: false },
        defaultCookieAttributes: {},
      };
    }

    // Split hostnames into parts to determine parent domain
    const clientParts = clientHost.split(".");
    const authParts = authHost.split(".");

    // Extract root domain (eTLD+1 approximation: last two parts, e.g., hetjethva.tech)
    const clientRoot = clientParts.slice(-2).join(".");
    const authRoot = authParts.slice(-2).join(".");

    const isSameSite = clientRoot === authRoot;

    if (isSameSite) {
      // Frontend and backend share the same parent domain (e.g. typesync.hetjethva.tech and api.typesync.hetjethva.tech)
      // We enable cross-subdomain cookies on the root domain, allowing secure Lax cookies to work.
      return {
        crossSubDomainCookies: {
          enabled: true,
          domain: `.${clientRoot}`,
        },
        defaultCookieAttributes: {
          sameSite: "lax" as const,
          secure: true,
          httpOnly: true,
        },
      };
    } else {
      // Frontend and backend are on completely different domains (e.g. Vercel and Render default subdomains)
      // Must use SameSite=None and Secure for cookies to be sent cross-site.
      return {
        crossSubDomainCookies: { enabled: false },
        defaultCookieAttributes: {
          sameSite: "none" as const,
          secure: true,
          httpOnly: true,
        },
      };
    }
  } catch (error) {
    // Fail-safe default fallback
    return {
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: {},
    };
  }
};

const cookieConfig = getCookieConfig(config.clientUrl, config.betterAuthUrl);

export const auth = betterAuth({
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
    crossSubDomainCookies: cookieConfig.crossSubDomainCookies,
    defaultCookieAttributes: cookieConfig.defaultCookieAttributes,
  },
});

