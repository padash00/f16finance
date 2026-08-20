/**
 * Загрузка файла: разрешение у сервера, байты — напрямую в хранилище.
 *
 * Раньше страницы грузили файлы своим ключом Supabase. Работало, но означало
 * открытую на запись корзину: ни права, ни тип, ни размер никто не смотрел —
 * проверки жили в серверном роуте, мимо которого шла загрузка.
 *
 * Через сервер целиком тоже нельзя: Vercel не пропускает тело больше ~4,5 МБ,
 * а рекламный ролик весит сотню. Поэтому сервер выдаёт одноразовую ссылку —
 * он проверяет право, тип и размер, — а файл идёт мимо него.
 */

export type UploadResult = {
  /** Публичный адрес файла — его и сохраняют в базе. */
  publicUrl: string
  /** Путь внутри корзины: по нему сервер сверяет загруженное. */
  path: string
}

export class UploadError extends Error {}

/**
 * `folder` — уточнение пути (например, id оператора). Основную часть пути и
 * имя файла задаёт сервер: имя, пришедшее из браузера, могло бы увести файл в
 * чужую папку.
 */
export async function uploadFile(params: {
  policy: 'customer-display-ads' | 'operator-avatars' | 'operator-documents'
  file: File
  folder?: string | null
}): Promise<UploadResult> {
  const { file } = params

  const permission = await fetch('/api/admin/storage/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policy: params.policy,
      content_type: file.type,
      size: file.size,
      folder: params.folder || null,
    }),
  })

  const granted = await permission.json().catch(() => null)
  if (!permission.ok) {
    throw new UploadError(granted?.error || 'Не удалось начать загрузку')
  }

  const { signedUrl, publicUrl, path } = granted.data as {
    signedUrl: string
    publicUrl: string
    path: string
  }

  // Одноразовая ссылка принимает обычный PUT — клиент Supabase в браузере
  // для этого не нужен, а значит не нужен и ключ на запись.
  const uploaded = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })

  if (!uploaded.ok) {
    throw new UploadError('Файл не загрузился. Попробуйте ещё раз.')
  }

  return { publicUrl, path }
}
