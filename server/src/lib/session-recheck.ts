export function sessionRecheck(
  now: number,
  unavailableUntil: number | undefined
): "unavailable" | "due" {
  if (unavailableUntil !== undefined && now < unavailableUntil) return "unavailable";
  return "due";
}

/** A recent validation does not skip a lookup that just failed. */
export function sessionCacheHit(
  now: number,
  lastValidation: number,
  intervalMs: number,
  unavailableUntil: number | undefined
): boolean {
  if (sessionRecheck(now, unavailableUntil) === "unavailable") return false;
  return now - lastValidation < intervalMs;
}
