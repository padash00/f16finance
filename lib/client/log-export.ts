/**
 * Клиентский хелпер для логирования экспортов файлов (Excel, CSV, PDF).
 *
 * Применять сразу после успешного скачивания, например:
 *
 *   await logExport({ subject: 'доходы', format: 'xlsx', count: rows.length })
 *
 * Вызов не блокирует UI и не падает при отсутствии сети — лог просто не запишется.
 */

type LogExportInput = {
  /** Что именно экспортируется (по-русски, в им.падеже): «доходы», «отчёт смены», «зарплатная ведомость» */
  subject: string
  /** Формат файла: 'xlsx' | 'csv' | 'pdf' | 'docx' и т.п. */
  format: 'xlsx' | 'csv' | 'pdf' | 'docx' | 'json' | string
  /** Количество строк/записей в файле (опционально) */
  count?: number
  /** Период экспорта (опционально), например '2026-04' или '2026-04-01..2026-04-30' */
  period?: string
  /** ID точки/компании, к которой относится экспорт (опционально) */
  companyId?: string | null
  /** Произвольные дополнительные поля */
  extra?: Record<string, unknown>
}

export async function logExport(input: LogExportInput): Promise<void> {
  try {
    const entityId = `export-${Date.now()}`
    await fetch('/api/admin/audit-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entityType: 'data-export',
        entityId,
        action: 'export',
        payload: {
          subject: input.subject,
          format: input.format,
          count: input.count ?? null,
          period: input.period ?? null,
          company_id: input.companyId ?? null,
          ...(input.extra || {}),
        },
      }),
    })
  } catch {
    // Логирование не должно ломать пользовательский поток
  }
}
