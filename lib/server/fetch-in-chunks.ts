/**
 * Постраничная выборка сверх лимита PostgREST.
 *
 * Сервер режет любой ответ до `db-max-rows` (1000), даже если в `.range()`
 * попросили больше. Один запрос на 5000 строк молча возвращал 1000 — и
 * клиенту казалось, что строк больше нет. Поэтому окно [page·pageSize,
 * page·pageSize + pageSize) читаем кусками по `chunk` и склеиваем.
 *
 * Запрос в `fetchRange` обязан иметь стабильную сортировку (например, дата +
 * id): иначе строки с одинаковой датой могут задвоиться или пропасть на стыке
 * кусков.
 */
export async function fetchInChunks<T>(options: {
  page: number
  pageSize: number
  chunk?: number
  fetchRange: (from: number, to: number) => Promise<T[]>
}): Promise<T[]> {
  const chunk = Math.max(1, options.chunk ?? 1000)
  const rows: T[] = []
  let cursor = options.page * options.pageSize

  while (rows.length < options.pageSize) {
    const size = Math.min(chunk, options.pageSize - rows.length)
    const batch = await options.fetchRange(cursor, cursor + size - 1)
    rows.push(...batch)
    // Пришло меньше, чем просили, — строки кончились (или сервер урезал кусок;
    // кусок не больше лимита, так что это конец данных)
    if (batch.length < size) break
    cursor += size
  }

  return rows
}
