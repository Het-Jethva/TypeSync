import { createAuthClient } from "better-auth/react";
import { apiBaseUrl } from "./backend-url";

const authClient = createAuthClient({
  baseURL: new URL(`${apiBaseUrl}/auth`, window.location.origin).href,
  sessionOptions: {
    refetchInterval: 60 * 60,
  },
  fetchOptions: {
    customFetchImpl: (url, options) => {
      const deadline = AbortSignal.timeout(45_000);
      const signal = options?.signal
        ? AbortSignal.any([options.signal, deadline])
        : deadline;
      return fetch(url, { ...options, signal });
    },
  },
});

export const { useSession, signIn, signUp, signOut, sendVerificationEmail } = authClient;
