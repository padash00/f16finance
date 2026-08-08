import 'server-only'

import { createSign } from 'node:crypto'
import http2 from 'node:http2'

/**
 * Отправка push-уведомлений в нативное приложение Apple (iPhone / iPad / Mac).
 *
 * Зачем отдельно от Expo: Expo Push принимает только свои токены вида
 * `ExponentPushToken[...]`. Нативное приложение получает от APNs сырой
 * device token (hex), и отправлять его на exp.host бессмысленно — он молча
 * отбрасывается фильтром в `lib/server/push.ts`.
 *
 * Авторизация — JWT на эллиптической кривой (ES256), подписанный ключом .p8 из
 * Apple Developer. Токен живёт до часа; Apple отклоняет как слишком старые
 * (>1 ч), так и слишком частые обновления, поэтому кэшируем на 50 минут.
 *
 * ENV:
 *   APNS_KEY_ID       — идентификатор ключа (10 символов), из имени файла .p8
 *   APNS_TEAM_ID      — Team ID (10 символов)
 *   APNS_PRIVATE_KEY  — содержимое .p8 (PEM целиком или base64)
 *   APNS_BUNDLE_ID    — bundle id приложения, напр. kz.ordaops.apple
 *   APNS_ENVIRONMENT  — production (по умолчанию) | sandbox
 *
 * Модуль best-effort: никогда не бросает. Push — не критичный путь, и падение
 * отправки не должно ронять бизнес-операцию, из которой её позвали.
 */

const APNS_HOST_PRODUCTION = 'api.push.apple.com'
const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com'

/** Токены APNs невалидны навсегда — приложение удалено или переустановлено. */
const UNRECOVERABLE_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'])

export type ApnsPushType = 'alert' | 'background' | 'liveactivity'

export type ApnsPayload = {
  title: string
  body: string
  data?: Record<string, unknown>
  /** Значение на иконке. `0` снимает бейдж. */
  badge?: number
  /** Категория для действий в уведомлении (одобрить/отклонить прямо из шторки). */
  categoryId?: string
  /** Идентификатор для схлопывания повторов (напр. одна и та же смена). */
  collapseId?: string
  pushType?: ApnsPushType
}

export type ApnsResult = {
  sent: number
  failed: number
  /** Токены, которые больше никогда не заработают — их надо удалить из БД. */
  invalidTokens: string[]
}

const EMPTY_RESULT: ApnsResult = { sent: 0, failed: 0, invalidTokens: [] }

// ────────────────────────────────────────────────────────────────────────────
// Конфигурация
// ────────────────────────────────────────────────────────────────────────────

type ApnsConfig = {
  keyId: string
  teamId: string
  privateKey: string
  bundleId: string
  host: string
}

/** Ключ может лежать в env как PEM с переносами или как base64 (удобнее в Vercel). */
function normalizePrivateKey(raw: string): string {
  const value = raw.trim()
  if (value.includes('BEGIN PRIVATE KEY')) {
    // В Vercel переносы часто экранированы — возвращаем настоящие.
    return value.replace(/\\n/g, '\n')
  }
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    if (decoded.includes('BEGIN PRIVATE KEY')) return decoded
  } catch {
    /* не base64 */
  }
  return value
}

function readConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID?.trim()
  const teamId = process.env.APNS_TEAM_ID?.trim()
  const privateKeyRaw = process.env.APNS_PRIVATE_KEY
  const bundleId = process.env.APNS_BUNDLE_ID?.trim()

  if (!keyId || !teamId || !privateKeyRaw || !bundleId) return null

  return {
    keyId,
    teamId,
    privateKey: normalizePrivateKey(privateKeyRaw),
    bundleId,
    host: process.env.APNS_ENVIRONMENT?.trim() === 'sandbox' ? APNS_HOST_SANDBOX : APNS_HOST_PRODUCTION,
  }
}

/** Настроен ли APNs. Позволяет вызывающим не тратить запрос в БД впустую. */
export function hasApnsCredentials(): boolean {
  return readConfig() !== null
}

// ────────────────────────────────────────────────────────────────────────────
// JWT
// ────────────────────────────────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

let cachedToken: { value: string; issuedAt: number; keyId: string } | null = null
const TOKEN_TTL_MS = 50 * 60 * 1000

function buildAuthToken(config: ApnsConfig): string | null {
  const now = Date.now()
  if (cachedToken && cachedToken.keyId === config.keyId && now - cachedToken.issuedAt < TOKEN_TTL_MS) {
    return cachedToken.value
  }

  try {
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }))
    const claims = base64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }))
    const signingInput = `${header}.${claims}`

    // JOSE требует подпись в формате r‖s (ieee-p1363), а не DER, который Node
    // отдаёт по умолчанию. Без dsaEncoding Apple вернёт InvalidProviderToken.
    const signer = createSign('SHA256')
    signer.update(signingInput)
    signer.end()
    const signature = signer.sign({ key: config.privateKey, dsaEncoding: 'ieee-p1363' })

    const token = `${signingInput}.${base64url(signature)}`
    cachedToken = { value: token, issuedAt: now, keyId: config.keyId }
    return token
  } catch {
    // Битый ключ в env — не роняем вызывающего, просто не отправляем.
    cachedToken = null
    return null
  }
}

/** Сбросить кэш JWT (после ротации ключа). */
export function invalidateApnsToken(): void {
  cachedToken = null
}

// ────────────────────────────────────────────────────────────────────────────
// Отправка
// ────────────────────────────────────────────────────────────────────────────

/** Похоже ли на сырой device token APNs (hex, 64+ символов). */
export function isApnsToken(token: string): boolean {
  return /^[0-9a-fA-F]{64,}$/.test(token.trim())
}

function buildBody(payload: ApnsPayload): string {
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: 'default',
  }
  if (typeof payload.badge === 'number') aps.badge = payload.badge
  if (payload.categoryId) aps.category = payload.categoryId
  // Уведомление должно уметь обновляться на месте — иначе одна и та же смена
  // засыпает экран блокировки десятком карточек.
  if (payload.collapseId) aps['thread-id'] = payload.collapseId

  return JSON.stringify({ aps, ...(payload.data || {}) })
}

/**
 * Отправка на список токенов через одно HTTP/2-соединение.
 *
 * APNs держит соединение и мультиплексирует запросы — открывать по соединению
 * на токен было бы на порядок медленнее.
 */
export async function sendApnsPush(tokens: string[], payload: ApnsPayload): Promise<ApnsResult> {
  const config = readConfig()
  if (!config) return EMPTY_RESULT

  const unique = Array.from(new Set(tokens.map((t) => String(t || '').trim()).filter(isApnsToken)))
  if (unique.length === 0) return EMPTY_RESULT

  const authToken = buildAuthToken(config)
  if (!authToken) return EMPTY_RESULT

  const body = buildBody(payload)
  const pushType: ApnsPushType = payload.pushType || 'alert'
  const topic = pushType === 'liveactivity' ? `${config.bundleId}.push-type.liveactivity` : config.bundleId

  let client: http2.ClientHttp2Session | null = null
  const result: ApnsResult = { sent: 0, failed: 0, invalidTokens: [] }

  try {
    client = http2.connect(`https://${config.host}`)
    // Без обработчика 'error' сбой соединения роняет процесс необработанным
    // исключением, а не отдаёт нам ошибку в await.
    client.on('error', () => {})

    await Promise.all(
      unique.map(
        (token) =>
          new Promise<void>((resolve) => {
            let settled = false
            const finish = () => {
              if (!settled) {
                settled = true
                resolve()
              }
            }

            try {
              const request = client!.request({
                ':method': 'POST',
                ':path': `/3/device/${token}`,
                authorization: `bearer ${authToken}`,
                'apns-topic': topic,
                'apns-push-type': pushType,
                'apns-priority': pushType === 'background' ? '5' : '10',
                ...(payload.collapseId ? { 'apns-collapse-id': payload.collapseId.slice(0, 64) } : {}),
                'content-type': 'application/json',
              })

              let status = 0
              let responseBody = ''

              request.on('response', (headers) => {
                status = Number(headers[':status'] || 0)
              })
              request.on('data', (chunk) => {
                responseBody += chunk
              })
              request.on('end', () => {
                if (status === 200) {
                  result.sent += 1
                } else {
                  result.failed += 1
                  try {
                    const reason = JSON.parse(responseBody)?.reason
                    if (reason && UNRECOVERABLE_REASONS.has(reason)) {
                      result.invalidTokens.push(token)
                    }
                  } catch {
                    /* тело не разобралось — считаем ошибкой без деталей */
                  }
                }
                finish()
              })
              request.on('error', () => {
                result.failed += 1
                finish()
              })

              request.setTimeout(10_000, () => {
                result.failed += 1
                request.close()
                finish()
              })

              request.end(body)
            } catch {
              result.failed += 1
              finish()
            }
          }),
      ),
    )
  } catch {
    /* best-effort: соединение не поднялось */
  } finally {
    try {
      client?.close()
    } catch {
      /* уже закрыто */
    }
  }

  return result
}
