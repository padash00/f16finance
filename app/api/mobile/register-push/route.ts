import { NextResponse } from 'next/server'

import { isApnsToken } from '@/lib/server/apns'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

/**
 * Регистрация push-токена устройства (мобилка зовёт после входа).
 *
 * Принимаем оба вида токенов: Expo (`ExponentPushToken[...]`) от React Native
 * приложения и сырой hex-токен APNs от нативного Apple-приложения. Приложения
 * будут сосуществовать, поэтому таблица общая, а вид определяется по форме
 * токена — при отправке `lib/server/push.ts` разведёт их по каналам.
 */
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) {
      // Отказ по авторизации записываем.
      //
      // В журнал попадают только исключения, а ранний выход — не исключение:
      // если телефон приходит без живой сессии, снаружи это неотличимо от
      // «телефон не приходил вовсе». Обе картины дают ноль устройств в базе и
      // пустой журнал, а чинятся в разных местах.
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/mobile/register-push',
        message: `адрес не принят: нет доступа (${access.response.status})`,
      })
      return access.response
    }

    const body = (await request.json().catch(() => null)) as { token?: string; platform?: string } | null
    const token = String(body?.token || '').trim()

    const isExpo = token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken')
    if (!isExpo && !isApnsToken(token)) {
      // Тоже записываем: пустой или неузнанный адрес выглядит снаружи так же,
      // как отсутствие телефона.
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/mobile/register-push',
        message: `адрес не принят: неузнанная форма (длина ${token.length})`,
      })
      return NextResponse.json({ error: 'bad-token' }, { status: 400 })
    }

    // `platform` присылает клиент, поэтому доверять ему нельзя — нормализуем
    // сами по форме токена, а клиентское значение оставляем только как уточнение
    // (ios / ipados / macos), если оно непротиворечиво.
    const claimedPlatform = String(body?.platform || '').trim().toLowerCase()
    const APPLE_PLATFORMS = new Set(['ios', 'ipados', 'macos'])
    const platform = isExpo
      ? claimedPlatform.slice(0, 16) || 'expo'
      : APPLE_PLATFORMS.has(claimedPlatform)
        ? claimedPlatform
        : 'ios'

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { error } = await supabase.from('mobile_push_tokens').upsert(
      {
        token,
        user_id: access.user?.id || null,
        operator_id: access.operatorAuth?.operator_id || null,
        organization_id: access.activeOrganization?.id || null,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    )
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/mobile/register-push', message: error?.message || 'register-push' })
    return NextResponse.json({ error: error?.message || 'Ошибка' }, { status: 500 })
  }
}
