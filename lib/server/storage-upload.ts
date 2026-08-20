import 'server-only'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Разовый пропуск на загрузку файла.
 *
 * Правило проекта простое: в Supabase ходит сервер, браузер — только в наш
 * API. Файлы были исключением, и по понятной причине: Vercel не пропускает
 * тело больше ~4,5 МБ, а реклама на витрину — это видео на сотню мегабайт.
 * Через сервер оно физически не пройдёт.
 *
 * Исключение стоило дороже, чем казалось. Раз браузер грузит сам, значит
 * корзина открыта на запись всякому, у кого есть публичный ключ и любая
 * сессия: ни проверки прав, ни проверки типа, ни ограничения размера — всё
 * это осталось в серверном роуте, мимо которого и шла загрузка.
 *
 * Здесь середина: разрешение выдаёт сервер (он же проверяет право, тип и
 * размер), а байты идут напрямую в хранилище по одноразовой ссылке. Ключ на
 * запись браузеру больше не нужен.
 */

export type StoragePolicy = {
  bucket: string
  /** Папка внутри корзины. Путь задаёт сервер — клиент его не выбирает. */
  prefix: string
  /** Разрешённые типы: ключ — mime, значение — расширение файла. */
  allowed: Record<string, string>
  maxBytes: number
}

export const STORAGE_POLICIES: Record<string, StoragePolicy> = {
  // Реклама на экран покупателя: картинки и видео.
  'customer-display-ads': {
    bucket: 'customer-display-ads',
    prefix: '',
    allowed: {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
    },
    maxBytes: 200 * 1024 * 1024,
  },
  // Фото оператора в карточке.
  'operator-avatars': {
    bucket: 'operator-files',
    prefix: 'avatars',
    allowed: {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    },
    maxBytes: 5 * 1024 * 1024,
  },
  // Документы оператора: удостоверение, медкнижка, договор.
  'operator-documents': {
    bucket: 'operator-files',
    prefix: 'documents',
    allowed: {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'application/pdf': 'pdf',
    },
    maxBytes: 20 * 1024 * 1024,
  },
}

export type SignedUpload = {
  path: string
  token: string
  signedUrl: string
  publicUrl: string
}

/** Причина отказа — человеческим языком, её увидит тот, кто грузит файл. */
export type SignedUploadError = { error: string }

function randomSuffix() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Проверить заявку и выдать пропуск.
 *
 * `folder` — часть пути, которую задаёт вызывающий роут (например, id
 * оператора). В имя файла не попадает ничего из присланного клиентом: имя
 * собирает сервер, расширение берётся из разрешённого типа. Иначе через имя
 * файла можно было бы уехать в чужую папку или подсунуть `.html` в публичную
 * корзину.
 */
export async function createSignedUpload(params: {
  policy: keyof typeof STORAGE_POLICIES
  contentType: string
  sizeBytes: number
  folder?: string | null
}): Promise<SignedUpload | SignedUploadError> {
  const policy = STORAGE_POLICIES[params.policy]
  if (!policy) return { error: 'unknown-policy' }
  if (!hasAdminSupabaseCredentials()) return { error: 'storage-not-configured' }

  const contentType = String(params.contentType || '').trim().toLowerCase()
  const extension = policy.allowed[contentType]
  if (!extension) {
    const names = Array.from(new Set(Object.values(policy.allowed))).join(', ').toUpperCase()
    return { error: `Такой тип файла сюда не грузится. Подойдут: ${names}` }
  }

  const size = Number(params.sizeBytes || 0)
  if (!Number.isFinite(size) || size <= 0) return { error: 'Размер файла не указан' }
  if (size > policy.maxBytes) {
    return { error: `Файл больше ${Math.round(policy.maxBytes / (1024 * 1024))} МБ` }
  }

  // Папку тоже не берём как есть: только буквы, цифры и дефис.
  const folder = String(params.folder || '').replace(/[^a-zA-Z0-9-]/g, '')
  const parts = [policy.prefix, folder].filter(Boolean)
  const name = `${Date.now()}_${randomSuffix()}.${extension}`
  const path = [...parts, name].join('/')

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase.storage.from(policy.bucket).createSignedUploadUrl(path)
  if (error || !data?.signedUrl || !data?.token) {
    return { error: error?.message || 'Не удалось подготовить загрузку' }
  }

  const { data: publicData } = supabase.storage.from(policy.bucket).getPublicUrl(path)

  return {
    path,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: publicData.publicUrl,
  }
}

/**
 * Убедиться, что по адресу лежит именно то, что разрешали.
 *
 * Пропуск ограничивает путь, но не байты: браузер мог отправить видео под
 * видом картинки или файл вдвое больше заявленного. Проверяем уже загруженный
 * объект и убираем, если он не подходит, — до того, как на него сошлётся
 * запись в базе.
 */
export async function verifyUploadedObject(params: {
  policy: keyof typeof STORAGE_POLICIES
  path: string
}): Promise<{ ok: true; contentType: string; size: number } | SignedUploadError> {
  const policy = STORAGE_POLICIES[params.policy]
  if (!policy) return { error: 'unknown-policy' }
  if (!hasAdminSupabaseCredentials()) return { error: 'storage-not-configured' }

  const supabase = createAdminSupabaseClient()
  const path = String(params.path || '')
  const slash = path.lastIndexOf('/')
  const folder = slash > 0 ? path.slice(0, slash) : ''
  const name = slash > 0 ? path.slice(slash + 1) : path

  const { data, error } = await supabase.storage.from(policy.bucket).list(folder, { search: name })
  if (error) return { error: error.message || 'Файл не найден' }

  const object = (data || []).find((row: any) => String(row?.name) === name)
  if (!object) return { error: 'Файл не загрузился' }

  const meta = (object as any).metadata || {}
  const size = Number(meta.size || 0)
  const contentType = String(meta.mimetype || '').toLowerCase()

  const remove = async () => {
    await supabase.storage.from(policy.bucket).remove([path]).catch(() => null)
  }

  if (size > policy.maxBytes) {
    await remove()
    return { error: `Файл больше ${Math.round(policy.maxBytes / (1024 * 1024))} МБ` }
  }
  if (contentType && !policy.allowed[contentType]) {
    await remove()
    return { error: 'Тип файла не совпал с заявленным' }
  }

  return { ok: true, contentType, size }
}
