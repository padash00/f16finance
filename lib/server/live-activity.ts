import { sendApnsPush } from '@/lib/server/apns'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Живая карточка смены на экране блокировки.
 *
 * Приложение умело её обновлять только само — то есть когда телефон в руках и
 * экран открыт. А продажи пробивают на точке, в операторской программе: пока
 * телефон лежит в кармане, на блокировке висят цифры того момента, когда его
 * последний раз доставали. Отсюда «Live Activity не работает».
 *
 * Здесь вторая половина: сервер досылает состояние сам, как только на точке
 * что-то произошло.
 */

/**
 * Состояние карточки. Имена полей — те же, что у `ContentState` в приложении:
 * ActivityKit разбирает их обычным `JSONDecoder`, и любое расхождение означает
 * молча не обновившуюся карточку.
 */
export type ShiftActivityState = {
  revenue: number
  receipts: number
  cash: number
  kaspi: number
  attention?: string | null
  busyStations?: number | null
  totalStations?: number | null
  /** Момент окончания ближайшей сессии зала, unix-секунды. */
  nextSessionEndsAtUnix?: number | null
}

/**
 * Swift кодирует `Date` числом секунд от 1 января 2001 года, а не от 1970-го, —
 * и `JSONDecoder` по умолчанию ждёт именно его. Разница ровно в этой константе:
 * с обычным unix-временем срок сессии уехал бы на тридцать один год вперёд.
 */
const APPLE_EPOCH_OFFSET = 978_307_200

function toContentState(state: ShiftActivityState): Record<string, unknown> {
  const content: Record<string, unknown> = {
    revenue: state.revenue,
    receipts: state.receipts,
    cash: state.cash,
    kaspi: state.kaspi,
  }
  if (state.attention) content.attention = state.attention
  if (typeof state.busyStations === 'number') content.busyStations = state.busyStations
  if (typeof state.totalStations === 'number') content.totalStations = state.totalStations
  if (typeof state.nextSessionEndsAtUnix === 'number') {
    content.nextSessionEndsAt = state.nextSessionEndsAtUnix - APPLE_EPOCH_OFFSET
  }
  return content
}

/**
 * Обновить карточки смены на телефонах точки.
 *
 * Best-effort и молча: живая активность — удобство, а не работа. Продажа не
 * должна падать из-за того, что Apple не принял уведомление.
 */
export async function pushShiftActivity(args: {
  companyId: string
  shiftId?: string | null
  state: ShiftActivityState
  /** Смена закрыта — карточку убрать. */
  ended?: boolean
}): Promise<void> {
  if (!hasAdminSupabaseCredentials()) return

  try {
    const supabase = createAdminSupabaseClient()
    let query = supabase.from('live_activity_tokens').select('token').eq('company_id', args.companyId)
    if (args.shiftId) query = query.eq('shift_id', args.shiftId)

    const { data, error } = await query
    if (error || !data?.length) return

    const tokens = data.map((row: any) => String(row.token)).filter(Boolean)

    const result = await sendApnsPush(tokens, {
      // Заголовок и текст живой активности не показываются, но Apple требует
      // их в теле: расширение рисует по content-state.
      title: 'Смена',
      body: 'Обновление смены',
      pushType: 'liveactivity',
      liveActivity: {
        event: args.ended ? 'end' : 'update',
        contentState: toContentState(args.state),
        // Устаревшее состояние Apple покажет приглушённым: лучше честное
        // «данные старые», чем уверенно показанные вчерашние деньги.
        staleInSeconds: 15 * 60,
        dismissalUnix: args.ended ? Math.floor(Date.now() / 1000) : undefined,
      },
    })

    // Адреса, которые Apple больше не принимает, чистим сразу: карточки по ним
    // всё равно нет, а стучаться в Apple при каждой продаже незачем.
    if (result.invalidTokens.length > 0) {
      await supabase.from('live_activity_tokens').delete().in('token', result.invalidTokens)
    }
  } catch {
    /* молча: карточка на блокировке не стоит упавшей продажи */
  }
}

/** Убрать карточки смены: смена закрыта. */
export async function endShiftActivity(companyId: string, shiftId?: string | null): Promise<void> {
  await pushShiftActivity({
    companyId,
    shiftId,
    ended: true,
    state: { revenue: 0, receipts: 0, cash: 0, kaspi: 0 },
  })

  if (!hasAdminSupabaseCredentials()) return
  try {
    const supabase = createAdminSupabaseClient()
    let query = supabase.from('live_activity_tokens').delete().eq('company_id', companyId)
    if (shiftId) query = query.eq('shift_id', shiftId)
    await query
  } catch {
    /* см. выше */
  }
}
