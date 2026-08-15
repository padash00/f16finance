import type { FormattedEvent } from '@/lib/core/event-formatter'

/**
 * Что из журнала достойно сообщения в Telegram.
 *
 * Раньше уходило ЛЮБОЕ событие, кроме пяти технических типов, — в чат сыпались
 * строки вида «Имя — operator_exam (operator_exam.send)», которые ничего не
 * объясняют и тонут в потоке. Сообщение оправдано, когда владельцу надо
 * вмешаться: удалили данные, тронули доступы, вошли не туда.
 *
 * Всё остальное по-прежнему пишется в журнал и видно на странице логов.
 */

/** Типы событий, которые не шлём никогда: технический шум. */
export const TELEGRAM_SILENT_ENTITY_TYPES = new Set<string>([
  'page-view',
  'auth-attempt',
  'ai-usage',
  'system-error',
  'operator-chat',
])

/** Действия, о которых сообщаем независимо от того, как их оформил форматтер. */
const TELEGRAM_ALERT_ACTIONS = new Set<string>([
  'delete',
  'delete-organization',
  'dismiss',
  'block',
  'rotate-token',
  'reset-password',
  'grant',
  'revoke',
])

export function deservesTelegram(
  formatted: Pick<FormattedEvent, 'severity' | 'category'>,
  action: string,
): boolean {
  if (formatted.severity === 'important' || formatted.severity === 'critical') return true
  if (TELEGRAM_ALERT_ACTIONS.has(action.toLowerCase())) return true
  // Безопасность важна сама по себе, остальное — только в журнал.
  return formatted.category === 'security'
}
