// Вывод email оператора из логина — зеркало lib/core/auth.ts на сервере.
// Оператор входит по логину (username), email = <username>@operator.local.
const OPERATOR_AUTH_EMAIL_DOMAIN = 'operator.local'

export function normalizeOperatorUsername(login: string): string {
  return login.trim().toLowerCase()
}

export function toOperatorAuthEmail(username: string): string {
  return `${normalizeOperatorUsername(username)}@${OPERATOR_AUTH_EMAIL_DOMAIN}`
}

/**
 * Превращает введённый логин в email для Supabase Auth.
 * Содержит '@' → это email (владелец / админ). Иначе → логин оператора.
 */
export function loginToEmail(login: string): { email: string; isOperator: boolean } {
  const v = login.trim()
  if (v.includes('@')) return { email: v.toLowerCase(), isOperator: false }
  return { email: toOperatorAuthEmail(v), isOperator: true }
}
