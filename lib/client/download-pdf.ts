'use client'

/**
 * Скачать PDF, сгенерированный из переданных данных, через /api/admin/reports/pdf.
 * kind: 'finreport' — детальный финансовый отчёт; 'table' — простая таблица.
 * Данные формирует страница (у неё уже есть всё на экране).
 *
 * Показывает глобальный индикатор «Готовим PDF…» сразу при вызове — чтобы было
 * понятно, что кнопка нажалась и идёт генерация (на любом экспорте сразу).
 */

// ── Глобальный индикатор генерации PDF ──────────────────────────────────────
let pdfBusyCount = 0
let pdfOverlay: HTMLDivElement | null = null

function ensureKeyframes() {
  if (typeof document === 'undefined') return
  if (document.getElementById('pdf-overlay-kf')) return
  const style = document.createElement('style')
  style.id = 'pdf-overlay-kf'
  style.textContent = '@keyframes pdfspin{to{transform:rotate(360deg)}}@keyframes pdfin{from{opacity:0;transform:translate(-50%,12px)}to{opacity:1;transform:translate(-50%,0)}}'
  document.head.appendChild(style)
}

function showPdfBusy() {
  if (typeof document === 'undefined') return
  ensureKeyframes()
  pdfBusyCount++
  if (pdfOverlay) return
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;' +
    'display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;' +
    'background:rgba(15,23,42,0.96);border:1px solid rgba(255,255,255,0.12);' +
    'box-shadow:0 14px 44px rgba(0,0,0,0.5);color:#fff;font-size:14px;' +
    'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;backdrop-filter:blur(8px);' +
    'animation:pdfin 0.18s ease-out'
  el.innerHTML =
    '<span data-pdf-spinner style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.22);' +
    'border-top-color:#34d399;border-radius:50%;display:inline-block;animation:pdfspin 0.7s linear infinite"></span>' +
    '<span data-pdf-text>Готовим PDF…</span>'
  document.body.appendChild(el)
  pdfOverlay = el
}

function finishPdfBusy(state: 'done' | 'error', text: string) {
  pdfBusyCount = Math.max(0, pdfBusyCount - 1)
  if (pdfBusyCount > 0) return // ещё идёт другой экспорт — не убираем
  const el = pdfOverlay
  pdfOverlay = null
  if (!el) return
  const spinner = el.querySelector('[data-pdf-spinner]') as HTMLElement | null
  const label = el.querySelector('[data-pdf-text]') as HTMLElement | null
  if (spinner) spinner.style.display = 'none'
  if (label) label.textContent = text
  el.style.borderColor = state === 'error' ? 'rgba(244,63,94,0.55)' : 'rgba(52,211,153,0.55)'
  setTimeout(() => el.remove(), state === 'error' ? 2600 : 1100)
}

export async function downloadReportPdf(
  kind: 'finreport' | 'table' | 'premium',
  data: unknown,
  filename: string,
): Promise<void> {
  showPdfBusy()
  try {
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
    finishPdfBusy('done', 'Готово ✓')
  } catch (err: any) {
    finishPdfBusy('error', `Не удалось: ${err?.message || 'ошибка'}`)
    throw err
  }
}
