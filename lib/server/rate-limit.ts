/**
 * Simple in-memory rate limiter for Next.js API routes.
 * Resets on server restart — suitable for edge cases, not production-grade.
 * For production, use Upstash Redis or Vercel KV.
 */

type BucketEntry = { count: number; resetAt: number }

const buckets = new Map<string, BucketEntry>()

// Cleanup old buckets every 5 minutes to prevent memory leaks
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of buckets) {
      if (entry.resetAt < now) buckets.delete(key)
    }
  }, 5 * 60 * 1000)
}

/**
 * Check if a key is within the allowed rate limit.
 * @param key       Unique identifier (e.g. IP + route)
 * @param limit     Max requests allowed in the window
 * @param windowMs  Window duration in milliseconds
 * @returns `{ allowed: boolean; remaining: number; resetAt: number }`
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  let entry = buckets.get(key)

  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    buckets.set(key, entry)
  }

  entry.count += 1
  const remaining = Math.max(0, limit - entry.count)
  const allowed = entry.count <= limit

  return { allowed, remaining, resetAt: entry.resetAt }
}

/**
 * Extract client IP from a Next.js Request object.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'unknown'
}
