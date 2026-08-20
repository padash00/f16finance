import 'server-only'

/**
 * Прочитать выборку целиком.
 *
 * PostgREST отдаёт максимум тысячу строк и молчит об этом: ответ приходит
 * успешный, просто короче, чем есть на самом деле. Для списка это «показали не
 * всё», а для суммы — неверные деньги, и заметить их не по чему: ошибки нет,
 * число выглядит правдоподобно, просто оно меньше.
 *
 * В коде уже больше двадцати собственных копий этого цикла — по одной на файл,
 * где кто-то на это наступил. Здесь общая: новому коду не нужно наступать
 * заново.
 *
 * Выборке нужен устойчивый порядок, иначе страницы поедут: строка, попавшая
 * между запросами на границу, окажется в двух страницах или ни в одной.
 * Поэтому `order` обязателен, а не «желателен».
 *
 *   const sales = await fetchAllRows((from, to) =>
 *     supabase.from('point_sales').select('total_amount').eq('sale_date', date).order('id').range(from, to),
 *   )
 */
export async function fetchAllRows<T = any>(
  buildQuery: (from: number, to: number) => any,
  options?: { pageSize?: number; maxPages?: number },
): Promise<T[]> {
  const pageSize = options?.pageSize ?? 1000
  // Предохранитель от бесконечного цикла, если запрос вдруг перестанет
  // сокращаться. Двадцать страниц — двадцать тысяч строк.
  const maxPages = options?.maxPages ?? 20

  const rows: T[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await buildQuery(page * pageSize, page * pageSize + pageSize - 1)
    if (error) throw error
    const batch = (data || []) as T[]
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}
