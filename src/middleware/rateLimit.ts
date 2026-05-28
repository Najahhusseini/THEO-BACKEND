// src/middleware/rateLimit.ts
import { Context, Next } from 'hono';

interface RateLimitOptions {
  windowMs: number;    // time window in milliseconds
  maxRequests: number; // max requests per window
  keyGenerator?: (c: Context) => string; // custom key (default: IP)
}

// Simple in‑memory store (for development; replace with Redis in production)
const store = new Map<string, { count: number; resetTime: number }>();

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetTime <= now) {
      store.delete(key);
    }
  }
}, 60 * 1000);

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyGenerator } = options;

  return async (c: Context, next: Next) => {
    const key = keyGenerator ? keyGenerator(c) : c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetTime <= now) {
      // New window
      store.set(key, { count: 1, resetTime: now + windowMs });
      await next();
      return;
    }

    if (entry.count >= maxRequests) {
      // Rate limit exceeded
      return c.json({ error: 'Too many requests, please try again later.' }, 429);
    }

    // Increment count
    entry.count++;
    store.set(key, entry);
    await next();
  };
}