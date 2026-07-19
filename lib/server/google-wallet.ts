import crypto from 'crypto'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'

/**
 * Google Wallet — карты лояльности.
 *
 * Выдача карты: «fat JWT» (класс + объект зашиты в подписанный токен) →
 * ссылка https://pay.google.com/gp/v/save/<jwt>, API-вызов не нужен.
 * Обновление баллов: PATCH loyaltyObject через Wallet API (OAuth сервис-аккаунта).
 *
 * ENV (все три обязательны, иначе фича тихо выключена):
 *   GOOGLE_WALLET_ISSUER_ID — числовой Issuer ID из Google Pay & Wallet Console
 *   GOOGLE_WALLET_SA_EMAIL  — email сервис-аккаунта (…@…iam.gserviceaccount.com)
 *   GOOGLE_WALLET_SA_KEY    — private_key из JSON-ключа (PEM; можно base64)
 */

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1'

function getCreds() {
  const issuerId = String(process.env.GOOGLE_WALLET_ISSUER_ID || '').trim()
  const email = String(process.env.GOOGLE_WALLET_SA_EMAIL || '').trim()
  let key = String(process.env.GOOGLE_WALLET_SA_KEY || '').trim()
  if (!issuerId || !email || !key) return null
  // Ключ мог быть положен в ENV как base64 или с литеральными \n
  if (!key.includes('BEGIN')) {
    try { key = Buffer.from(key, 'base64').toString('utf8') } catch { /* оставим как есть */ }
  }
  key = key.replace(/\\n/g, '\n')
  if (!key.includes('BEGIN')) return null
  return { issuerId, email, key }
}

export function hasGoogleWalletCredentials() {
  return getCreds() !== null
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url')
}

function signJwtRS256(payload: Record<string, unknown>, key: string) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${body}`)
  const signature = signer.sign(key).toString('base64url')
  return `${header}.${body}.${signature}`
}

function classId(issuerId: string, organizationId: string | null) {
  // 1 класс на организацию: свой бренд у каждого арендатора
  const suffix = (organizationId || 'default').replace(/[^a-zA-Z0-9_]/g, '_')
  return `${issuerId}.orda_loyalty_${suffix}`
}

function objectId(issuerId: string, customerId: string) {
  return `${issuerId}.c_${customerId.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

export type WalletCustomer = {
  id: string
  name: string
  phone: string | null
  card_number: string
  loyalty_points: number
}

/** Ссылка «Добавить в Google Кошелёк» для клиента. null — креды не настроены. */
export function buildLoyaltySaveUrl(params: {
  customer: WalletCustomer
  organizationId: string | null
  programName: string
}): string | null {
  const creds = getCreds()
  if (!creds) return null
  const { customer, organizationId, programName } = params

  const loyaltyClass = {
    id: classId(creds.issuerId, organizationId),
    issuerName: programName,
    programName: `${programName} — карта лояльности`,
    programLogo: {
      sourceUri: { uri: 'https://ordaops.kz/apple-icon.png' },
      contentDescription: { defaultValue: { language: 'ru', value: programName } },
    },
    hexBackgroundColor: '#0f766e',
    reviewStatus: 'UNDER_REVIEW',
    countryCode: 'KZ',
  }

  const loyaltyObject = {
    id: objectId(creds.issuerId, customer.id),
    classId: loyaltyClass.id,
    state: 'ACTIVE',
    accountId: customer.phone || customer.card_number,
    accountName: customer.name,
    loyaltyPoints: {
      label: 'Баллы',
      balance: { int: Math.max(0, Math.floor(customer.loyalty_points)) },
    },
    barcode: {
      type: 'QR_CODE',
      value: customer.card_number,
      alternateText: customer.card_number,
    },
  }

  const jwt = signJwtRS256(
    {
      iss: creds.email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: { loyaltyClasses: [loyaltyClass], loyaltyObjects: [loyaltyObject] },
    },
    creds.key,
  )
  return `https://pay.google.com/gp/v/save/${jwt}`
}

async function getAccessToken(creds: { email: string; key: string }): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000)
  const assertion = signJwtRS256(
    {
      iss: creds.email,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    creds.key,
  )
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const json = await res.json().catch(() => null)
  return json?.access_token || null
}

/**
 * Обновить баллы на уже выданной карте. Fire-and-forget: ошибки логируются,
 * но продажу не блокируют (карта могла быть не выдана — 404 это норма).
 */
export async function updateLoyaltyBalance(customerId: string, points: number): Promise<void> {
  const creds = getCreds()
  if (!creds) return
  try {
    const token = await getAccessToken(creds)
    if (!token) throw new Error('google-wallet-token-failed')
    const id = objectId(creds.issuerId, customerId)
    const res = await fetch(`${WALLET_API}/loyaltyObject/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loyaltyPoints: { label: 'Баллы', balance: { int: Math.max(0, Math.floor(points)) } },
      }),
    })
    // 404 — клиент ещё не добавил карту в кошелёк, это не ошибка
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '')
      throw new Error(`google-wallet-patch-${res.status}: ${text.slice(0, 200)}`)
    }
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'google-wallet.updateLoyaltyBalance',
      message: error?.message || 'error',
    })
  }
}
