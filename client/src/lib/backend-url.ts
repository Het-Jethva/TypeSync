function readBackendOrigin(configuredUrl: string | undefined): string | undefined {
  const value = configuredUrl?.trim();
  if (!value) return undefined;

  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname.replace(/\/+$/, "") !== "" ||
    url.search || url.hash || url.username || url.password
  ) {
    throw new Error("VITE_API_URL must be an HTTP(S) origin without a path, query, or credentials");
  }
  return url.origin;
}

export const backendOrigin = readBackendOrigin(import.meta.env.VITE_API_URL);
export const apiBaseUrl = `${backendOrigin ?? ""}/api`;
