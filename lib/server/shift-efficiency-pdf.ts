/**
 * Сборка PDF-отчёта со смешанной ориентацией страниц.
 *
 * Одним заданием печати это сделать нельзя: Chromium печатает весь документ в
 * одной ориентации. Поэтому документ печатается частями, а потом склеивается
 * через pdf-lib.
 *
 * Частей три, а не по две на смену. Сводка и продавцы — альбомные, все
 * страницы смен — книжные, словарь снова альбомный; внутри одной ориентации
 * страницы печатаются одним заданием. На тридцати сменах это три запуска
 * печати вместо шестидесяти трёх: тот же результат, но укладывается в лимит
 * времени функции.
 *
 * Растеризация запрещена. Текст в готовом файле обязан выделяться,
 * копироваться и находиться поиском — иначе документом нельзя пользоваться.
 *
 * Номера страниц проставляются после склейки: во временных PDF каждая часть
 * думает, что она единственная, и напечатала бы «1 / 1».
 */

import { FONT_IMPORT, PDF_CSS } from '@/lib/reports/shift-efficiency-pdf-css'
import {
  renderGlossary,
  renderMonthSummary,
  renderSellersOverview,
  renderShiftReasoning,
  renderShiftSummary,
} from '@/lib/reports/shift-efficiency-pdf-pages'
import type { ShiftEfficiencyPdfReport } from '@/lib/reports/shift-efficiency-pdf-dto'

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar'

type Orientation = 'landscape' | 'portrait'

function document(pages: string[], orientation: Orientation): string {
  const size = orientation === 'landscape' ? '297mm 210mm' : '210mm 297mm'
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<style>
${FONT_IMPORT}
@page { size: ${size}; margin: 0; }
${PDF_CSS}
</style>
</head><body>${pages.join('')}</body></html>`
}

/**
 * Печатает одну ориентацию одним заданием.
 *
 * `preferCSSPageSize` обязателен: размер берётся из `@page`, а не из
 * настроек принтера, иначе альбомная часть уедет на книжный лист.
 */
async function printPart(
  browser: any,
  pages: string[],
  orientation: Orientation,
): Promise<Uint8Array | null> {
  if (pages.length === 0) return null

  const page = await browser.newPage()
  try {
    await page.setContent(document(pages, orientation), { waitUntil: 'load', timeout: 60_000 })
    try {
      await page.evaluate(() => (document as any).fonts?.ready)
    } catch {
      /* шрифты не критичны: fallback описан в CSS */
    }
    return (await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })) as Uint8Array
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Проставляет «N / M» в правом нижнем углу склеенного документа.
 *
 * Рисуется поверх готовых страниц, потому что общее число страниц становится
 * известно только после склейки. Цифры и косая черта — латиница, поэтому
 * встроенного Helvetica достаточно и кириллический шрифт вшивать не нужно.
 */
async function stampPageNumbers(bytes: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')

  const pdf = await PDFDocument.load(bytes)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  const total = pages.length

  pages.forEach((page, i) => {
    const label = `${i + 1} / ${total}`
    const size = 7
    const width = font.widthOfTextAtSize(label, size)
    const { width: pw } = page.getSize()
    // Отступ совпадает с полем подвала в CSS: 15 мм для альбома, 9 мм для
    // книжной. Ориентацию определяем по ширине страницы.
    const marginMm = pw > 700 ? 15 : 9
    const marginPt = (marginMm / 25.4) * 72

    page.drawText(label, {
      x: pw - marginPt - width,
      y: (5 / 25.4) * 72,
      size,
      font,
      color: rgb(0.576, 0.643, 0.722),
    })
  })

  return pdf.save()
}

export async function buildShiftEfficiencyPdf(report: ShiftEfficiencyPdfReport): Promise<Buffer> {
  const [{ default: puppeteer }, { default: chromium }] = await Promise.all([
    import('puppeteer-core'),
    import('@sparticuz/chromium-min'),
  ])

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  })

  try {
    // Порядок частей и есть порядок страниц готового документа.
    const opening = [renderMonthSummary(report), ...renderSellersOverview(report)]
    const shiftPages = report.shifts.flatMap((s) => [
      renderShiftSummary(report, s),
      renderShiftReasoning(report, s),
    ])
    const closing = [renderGlossary(report)]

    const parts = await Promise.all([
      printPart(browser, opening, 'landscape'),
      printPart(browser, shiftPages, 'portrait'),
      printPart(browser, closing, 'landscape'),
    ])

    const { PDFDocument } = await import('pdf-lib')
    const merged = await PDFDocument.create()
    merged.setTitle(`Разбор смен и эффективности продавцов · ${report.period.monthLabel}`)
    merged.setAuthor('Orda Control')
    merged.setCreator('Orda Control')

    for (const part of parts) {
      if (!part) continue
      const doc = await PDFDocument.load(part)
      const copied = await merged.copyPages(doc, doc.getPageIndices())
      for (const page of copied) merged.addPage(page)
    }

    return Buffer.from(await stampPageNumbers(await merged.save()))
  } finally {
    await browser.close().catch(() => {})
  }
}
