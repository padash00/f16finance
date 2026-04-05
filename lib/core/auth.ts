import { OPERATOR_AUTH_EMAIL_DOMAIN } from '@/lib/core/constants'

export type LoginUserType = 'admin' | 'operator'

export function detectLoginType(login: string): LoginUserType {
  return login.includes('@') ? 'admin' : 'operator'
}

export function normalizeOperatorUsername(login: string): string {
  return login.trim().toLowerCase()
}

export function toOperatorAuthEmail(username: string): string {
  return `${normalizeOperatorUsername(username)}@${OPERATOR_AUTH_EMAIL_DOMAIN}`
}
