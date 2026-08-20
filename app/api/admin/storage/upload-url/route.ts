import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createSignedUpload, STORAGE_POLICIES } from '@/lib/server/storage-upload'

/**
 * Разрешение на загрузку файла.
 *
 * Браузер спрашивает: «можно положить вот такой файл вот сюда?» — сервер
 * проверяет право, тип и размер и выдаёт одноразовую ссылку. Байты идут в
 * хранилище напрямую: видео на сотню мегабайт через Vercel не пролезет,
 * там лимит тела около четырёх с половиной.
 *
 * До этого браузер грузил файлы сам, своим ключом. Значит корзина принимала
 * запись от любого, у кого есть публичный ключ и сессия, — без проверки прав,
 * типа и размера. Проверки были, но в серверном роуте, мимо которого шла
 * загрузка.
 */
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Кто вправе грузить в эту корзину. */
const GUARDS: Record<string, { capability?: string; staffOnly?: boolean }> = {
  'customer-display-ads': { capability: 'store-advertising.create' },
  'operator-avatars': { capability: 'operators.avatar_upload' },
  'operator-documents': { capability: 'operators.document_upload' },
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as {
      policy?: string
      content_type?: string
      size?: number
      folder?: string | null
    } | null

    const policyKey = String(body?.policy || '')
    if (!policyKey || !(policyKey in STORAGE_POLICIES)) {
      return json({ error: 'unknown-policy' }, 400)
    }

    const guard = GUARDS[policyKey]
    if (guard?.capability) {
      const denied = await requireCapability(access, guard.capability)
      if (denied) return denied
    } else if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const signed = await createSignedUpload({
      policy: policyKey as keyof typeof STORAGE_POLICIES,
      contentType: String(body?.content_type || ''),
      sizeBytes: Number(body?.size || 0),
      folder: body?.folder || null,
    })

    if ('error' in signed) return json({ error: signed.error }, 400)

    return json({ ok: true, data: signed })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/storage/upload-url POST',
      message: error?.message || 'error',
    })
    return json({ error: 'upload-url-failed' }, 500)
  }
}
