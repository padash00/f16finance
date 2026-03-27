/**
 * Short-lived in-memory admin session tokens.
 * Generated on successful admin login, expire after 8 hours.
 * Resets on server restart — suitable for this use case.
 */

type TokenEntry = { email: string; expiresAt: number }

const tokens = new Map<string, TokenEntry>()

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

// Cleanup expired tokens every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of tokens) {
      if (entry.expiresAt < now) tokens.delete(key)
    }
  }, 60 * 60 * 1000)
}

export function createAdminToken(email: string): string {
  const token = crypto.randomUUID()
  tokens.set(token, { email, expiresAt: Date.now() + TOKEN_TTL_MS })
  return token
}

/**
 * Returns the admin email if the token is valid, or null if expired/unknown.
 */
export function validateAdminToken(token: string): string | null {
  const entry = tokens.get(token)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    tokens.delete(token)
    return null
  }
  return entry.email
}

export function revokeAdminToken(token: string): void {
  tokens.delete(token)
}
