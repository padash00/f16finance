/**
 * Проверка уведомлений на себе.
 *
 * «Уведомления не приходят» — три разные поломки с одним симптомом: устройство
 * не зарегистрировано, у сервера нет ключа APNs, или Apple отклоняет токен.
 * Снаружи они неотличимы, а лезть в базу и в переменные окружения ради этого
 * может не каждый.
 *
 * Здесь человек отправляет уведомление сам себе и получает прямой ответ, что
 * именно не так. Это не тестовый маршрут «на выброс»: разбираться с тишиной
 * придётся ещё не раз, и делать это должен уметь владелец точки, а не только
 * разработчик.
 */
import { NextResponse } from 'next/server'

import { hasApnsCredentials } from '@/lib/server/apns'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { sendPush } from '@/lib/server/push'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const userId = access.user?.id || null
    const operatorId = access.operatorAuth?.operator_id || null
    if (!userId && !operatorId) return json({ error: 'no-account' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Свои устройства ищем и по учётной записи, и по оператору: токен
    // регистрируется с обоими полями, но у части старых записей есть только
    // одно из них.
    const [byUser, byOperator] = await Promise.all([
      userId
        ? supabase.from('mobile_push_tokens').select('token, platform, updated_at').eq('user_id', userId)
        : { data: [] as any[] },
      operatorId
        ? supabase.from('mobile_push_tokens').select('token, platform, updated_at').eq('operator_id', operatorId)
        : { data: [] as any[] },
    ])

    const rows = [...(((byUser as any).data as any[]) || []), ...(((byOperator as any).data as any[]) || [])]
    const unique = new Map<string, any>()
    for (const row of rows) unique.set(String(row.token), row)

    const devices = [...unique.values()].map((row) => ({
      platform: row.platform || 'unknown',
      updated_at: row.updated_at || null,
    }))

    if (unique.size === 0) {
      return json({
        ok: false,
        reason: 'no-devices',
        message:
          'Ни одно устройство не зарегистрировано. Откройте приложение, войдите и разрешите уведомления — регистрация происходит после входа.',
        devices,
      })
    }

    if (!hasApnsCredentials()) {
      return json({
        ok: false,
        reason: 'apns-not-configured',
        message:
          'Устройства есть, но сервер не настроен на отправку: не заданы ключи APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_BUNDLE_ID.',
        devices,
      })
    }

    const { invalidTokens, sent, reasons, configError } = await sendPush([...unique.keys()], {
      title: 'Orda',
      body: 'Проверка уведомлений — если вы это видите, всё работает.',
      data: { kind: 'push-test' },
      collapseId: 'push-test',
    })

    // Мёртвые токены удаляем сразу: устройство переустановили или удалили
    // приложение, и держать их значит слать в пустоту при каждом событии.
    if (invalidTokens.length > 0) {
      await supabase.from('mobile_push_tokens').delete().in('token', invalidTokens)
    }

    // Ключ не подписался — снаружи это выглядело как успешная отправка, и
    // «уведомления не приходят» оставалось без объяснения.
    if (configError === 'bad-key') {
      return json({
        ok: false,
        reason: 'bad-key',
        message:
          'Ключ APNs не подошёл: сервер не смог подписать запрос. Проверьте APNS_PRIVATE_KEY — в переменную должен попасть весь файл .p8 целиком, вместе со строками BEGIN и END.',
        devices,
      })
    }

    // Apple отвечает словами — их и показываем: это разница между «не тот
    // ключ», «не тот bundle id» и «отладочный токен на боевом сервере».
    const reasonHints: Record<string, string> = {
      InvalidProviderToken: 'Apple не принял ключ: не совпадают APNS_KEY_ID и APNS_TEAM_ID или ключ отозван.',
      ExpiredProviderToken: 'Ключ просрочен — перевыпустите его в Apple Developer.',
      TopicDisallowed: 'Ключ не разрешён для этого приложения: проверьте APNS_BUNDLE_ID.',
      BadDeviceToken:
        'Токены не подходят этому серверу: приложение из App Store шлёт боевые токены, а сервер настроен на отладочный APNs (APNS_ENVIRONMENT=sandbox) — или наоборот.',
      DeviceTokenNotForTopic: 'Токен зарегистрирован другим приложением: проверьте APNS_BUNDLE_ID.',
      Unregistered: 'Устройство отключило уведомления или приложение удалено.',
    }
    const hint = reasons.map((reason) => reasonHints[reason]).find(Boolean)

    const delivered = sent
    return json({
      ok: delivered > 0,
      reason: delivered > 0 ? 'sent' : reasons[0] || 'all-tokens-invalid',
      message:
        delivered > 0
          ? `Отправлено на ${delivered} ${delivered === 1 ? 'устройство' : 'устройства'}. Если уведомление не появилось — проверьте разрешение в настройках телефона.`
          : hint ||
            'Apple отклонил все токены этого аккаунта — они устарели. Перезайдите в приложение, чтобы зарегистрировать устройство заново.',
      devices,
      apnsReasons: reasons,
      invalid: invalidTokens.length,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/me/push-test POST',
      message: error?.message || 'error',
    })
    return json({ error: 'push-test-failed' }, 500)
  }
}
