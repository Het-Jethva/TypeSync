import { config } from "../config.js";

function originFromHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function isTrustedWebOrigin(
  origin: string | undefined,
  referer: string | undefined
): boolean {
  if (origin !== undefined) {
    return originFromHeader(origin) === config.clientUrl;
  }
  return originFromHeader(referer) === config.clientUrl;
}
