import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// 100/min is a PRODUCTION anti-abuse cap (Netlify runs functions with
// NODE_ENV=production). Locally the bridge serves ONE developer behind a
// single proxied IP, and a single Dashboard mount fires dozens of API calls —
// that shared bucket then starved profile saves and loads with 429s (the
// "nada se guarda" bug). RATE_LIMIT_MAX still overrides both environments.
const isProd = process.env.NODE_ENV === "production";
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || (isProd ? "100" : "2000"), 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10); // 1 minute

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.headers["x-forwarded-for"] as string || req.socket?.remoteAddress || "unknown";
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }

  entry.count++;

  res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, MAX_REQUESTS - entry.count));
  res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader("Retry-After", retryAfter);
    return res.status(429).json({
      success: false,
      error: "Too many requests",
      retryAfter,
    });
  }

  // Lazy cleanup: delete stale entries on each request
  for (const [key, e] of store) {
    if (now > e.resetAt) store.delete(key);
  }

  next();
}
