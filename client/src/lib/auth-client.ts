import { createAuthClient } from "better-auth/react";
import { apiBaseUrl } from "./backend-url";

export const authClient = createAuthClient({
  baseURL: new URL(`${apiBaseUrl}/auth`, window.location.origin).href,
});

export const { useSession, signIn, signUp, signOut, sendVerificationEmail } = authClient;
