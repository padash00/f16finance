/**
 * Точка-«экстра» — отдельная касса, которую финансовые отчёты по умолчанию
 * не складывают в общие итоги (переключатель «включить в итоги»).
 *
 * Признак строгий: код `extra` или точное имя `F16 Extra`. Раньше /reports
 * искал подстроку «extra» в названии — у SaaS-клиента точка «Extra Store»
 * молча выпадала из выручки.
 */
export function isExtraCompany(company: { code?: string | null; name?: string | null }): boolean {
  return String(company.code || '').toLowerCase() === 'extra' || company.name === 'F16 Extra'
}
