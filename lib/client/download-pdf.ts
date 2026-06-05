'use client'

/**
 * Скачать PDF, сгенерированный из переданных данных, через /api/admin/reports/pdf.
 * kind: 'finreport' — детальный финансовый отчёт; 'table' — простая таблица.
 * Данные формирует страница (у неё уже есть всё на экране).
 */
export async function downloadReportPdf(
  kind: 'finreport' | 'table',
  data: unknown,
  filename: string,
): Promise<void> {
  const res = await fetch('/api/admin/reports/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, data }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new Error((j as any)?.error || `Ошибка ${res.status}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
