import type { NextFunction, Request, RequestHandler, Response } from "express";

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitOptions {
  /** Sustained request rate allowed per client, in requests per minute. */
  requestsPerMinute: number;
  /** Requests a client may make back to back before the sustained rate applies. */
  burst: number;
}

const SWEEP_INTERVAL = 60_000;

/**
 * Per-client token bucket, matching the buckets the collaboration socket
 * already applies to document and awareness frames. State is per-process,
 * which is consistent with the single collaboration server the deployment
 * deliberately runs.
 */
export function createRateLimit({
  requestsPerMinute,
  burst,
}: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, TokenBucket>();
  const refillPerSecond = requestsPerMinute / 60;

  function refill(bucket: TokenBucket, now: number): number {
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    return Math.min(burst, bucket.tokens + elapsedSeconds * refillPerSecond);
  }

  // A bucket that has refilled to capacity is indistinguishable from a client
  // that has never been seen, so dropping it bounds memory against a stream of
  // distinct addresses.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (refill(bucket, now) >= burst) buckets.delete(key);
    }
  }, SWEEP_INTERVAL);
  sweep.unref();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = req.ip;
    if (!key) return next();

    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, lastRefill: now };
      buckets.set(key, bucket);
    }

    bucket.tokens = refill(bucket, now);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfter = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ success: false, error: "Too many requests" });
      return;
    }

    bucket.tokens -= 1;
    next();
  };
}
