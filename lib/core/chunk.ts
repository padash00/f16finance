/**
 * Разрезать список на пачки по size элементов.
 *
 * Нужен почти везде, где идёт запрос `.in('id', ids)`: один `.in()` на сотни
 * UUID превышает лимит длины URL у шлюза, и запрос падает не на первом же
 * тесте, а на клиенте с большим каталогом. Копий этой функции в коде было
 * девять — по одной на файл, где на это наступили.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
