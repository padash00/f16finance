/**
 * Разбор смен и продавцов в Excel.
 *
 * Не «выгрузка таблицы», а тот же отчёт, что в PDF, но пригодный для работы:
 * фильтры, сортировка, свои сводные. Поэтому листов несколько и у каждого своя
 * задача.
 *
 *   Итог      — ответ словами: сколько смен, где вопросы, чего не хватало.
 *   Продавцы  — оценка человека и его сильные и слабые стороны.
 *   Смены     — все числа с фильтром: отсюда строят свои сводные.
 *   Разбор    — то же, что раскрывается на экране, но текстом по каждой смене.
 *   Графики   — картинки: касса против нормы, покупатели, оценки продавцов.
 *   Словарь   — что означает каждое слово отчёта.
 *
 * Диаграммы внутри ячеек — это не украшение, а условное форматирование Excel:
 * полоски и цветовые шкалы живут в файле, пересчитываются при правке и
 * переживают фильтрацию. Отдельные графики картинками лежат на своём листе:
 * библиотека не умеет создавать нативные диаграммы Excel, поэтому они
 * рисуются и вставляются изображением — зато выглядят одинаково везде.
 */

import ExcelJS from 'exceljs'

import type { buildShiftReportContract } from '@/lib/reports/build-shift-report-contract'

type Contract = ReturnType<typeof buildShiftReportContract>

const HEAD_FILL = 'FF0F2038'
const GOOD_FILL = 'FFDCFCE7'
const WARN_FILL = 'FFFEF3C7'
const BAD_FILL = 'FFFEE2E2'
const MUTED_FILL = 'FFF8FAFC'

const MONEY_FMT = '# ##0 " ₸"'

function headerRow(sheet: ExcelJS.Worksheet, row: number, values: string[]) {
  const r = sheet.getRow(row)
  r.values = values
  r.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
  r.alignment = { vertical: 'middle', wrapText: true }
  r.height = 24
  return r
}

function tone(delta: number | null | undefined): string | null {
  if (delta == null) return null
  if (delta >= 5) return GOOD_FILL
  if (delta <= -5) return BAD_FILL
  return null
}

// ─── Лист «Итог» ────────────────────────────────────────────────────────────

function sheetSummary(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Итог', { views: [{ showGridLines: false }] })
  sheet.columns = [{ width: 34 }, { width: 26 }, { width: 70 }]

  sheet.mergeCells('A1:C1')
  const title = sheet.getCell('A1')
  title.value = c.meta.title
  title.font = { bold: true, size: 18, color: { argb: HEAD_FILL } }
  sheet.getRow(1).height = 28

  sheet.mergeCells('A2:C2')
  const sub = sheet.getCell('A2')
  sub.value = `${c.meta.subtitle} · ${c.meta.period} · сформирован ${c.meta.generated}`
  sub.font = { size: 10, color: { argb: 'FF64748B' } }

  let row = 4
  headerRow(sheet, row, ['Показатель', 'Значение', 'Пояснение'])
  row += 1

  for (const k of c.summary.kpis) {
    const r = sheet.getRow(row)
    r.values = [k.label, k.value, k.sub || '']
    r.getCell(1).font = { bold: true, size: 10 }
    r.getCell(2).font = { bold: true, size: 12 }
    r.getCell(3).font = { size: 9, color: { argb: 'FF64748B' } }
    r.alignment = { vertical: 'middle', wrapText: true }
    row += 1
  }

  row += 1
  if (c.summary.notes?.length) {
    sheet.getCell(`A${row}`).value = 'Что мешало считать точно'
    sheet.getCell(`A${row}`).font = { bold: true, size: 11 }
    row += 1
    for (const note of c.summary.notes) {
      sheet.mergeCells(`A${row}:C${row}`)
      const cell = sheet.getCell(`A${row}`)
      cell.value = `• ${note}`
      cell.alignment = { wrapText: true, vertical: 'top' }
      cell.font = { size: 10, color: { argb: 'FFB45309' } }
      sheet.getRow(row).height = 30
      row += 1
    }
    row += 1
  }

  sheet.getCell(`A${row}`).value = 'Как это считается'
  sheet.getCell(`A${row}`).font = { bold: true, size: 11 }
  row += 1
  sheet.mergeCells(`A${row}:C${row}`)
  const method = sheet.getCell(`A${row}`)
  method.value = c.summary.method
  method.alignment = { wrapText: true, vertical: 'top' }
  method.font = { size: 10 }
  method.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MUTED_FILL } }
  sheet.getRow(row).height = 90

  return sheet
}

// ─── Лист «Продавцы» ────────────────────────────────────────────────────────

function sheetCashiers(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Продавцы', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { width: 20 },
    { width: 16 },
    { width: 18 },
    { width: 10 },
    { width: 12 },
    { width: 16 },
    { width: 18 },
    { width: 30 },
    { width: 30 },
  ]

  headerRow(sheet, 1, [
    'Продавец',
    'Статус',
    'Как отработал',
    'Смен',
    'Чеков',
    'Выручка',
    'Можно ли доверять',
    'Сильные стороны',
    'Стоит подтянуть',
  ])

  let row = 2
  for (const p of c.cashiers) {
    const r = sheet.getRow(row)
    r.values = [
      p.name,
      p.status,
      p.score_text,
      p.shifts,
      p.receipts,
      p.revenue,
      p.confidence_text,
      p.strengths.join(', ') || '—',
      p.weaknesses.join(', ') || '—',
    ]
    r.getCell(1).font = { bold: true }
    r.getCell(6).numFmt = MONEY_FMT
    r.alignment = { vertical: 'middle', wrapText: true }

    // Цвет статуса — чтобы лист читался, не вчитываясь.
    const fill =
      p.status === 'Топ' || p.status === 'Сильный'
        ? GOOD_FILL
        : p.status === 'Нужна помощь'
          ? WARN_FILL
          : null
    if (fill) r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }

    row += 1
  }

  if (row > 2) {
    sheet.autoFilter = { from: 'A1', to: `I${row - 1}` }
    // Полоски внутри ячеек: сравнение выручки без отдельного графика.
    sheet.addConditionalFormatting({
      ref: `F2:F${row - 1}`,
      rules: [{ type: 'dataBar', color: { argb: 'FF16A34A' }, priority: 1 } as any],
    })
    sheet.addConditionalFormatting({
      ref: `D2:D${row - 1}`,
      rules: [{ type: 'dataBar', color: { argb: 'FF3B82F6' }, priority: 2 } as any],
    })
  }

  // Разбор метрик отдельным блоком: у каждого продавца свои строки.
  row += 2
  sheet.getCell(`A${row}`).value = 'Метрики продавцов: отклонение от нормы'
  sheet.getCell(`A${row}`).font = { bold: true, size: 12 }
  row += 1
  headerRow(sheet, row, ['Продавец', 'Метрика', 'Отклонение', '', '', '', '', '', ''])
  row += 1

  const metricsFrom = row
  for (const p of c.cashiers) {
    for (const m of p.metrics) {
      const r = sheet.getRow(row)
      const numeric = Number(String(m.delta_text).replace(/[^\d+-]/g, ''))
      r.values = [p.name, m.label, Number.isFinite(numeric) ? numeric / 100 : null]
      r.getCell(3).numFmt = '+0%;-0%;0%'
      const fill = tone(Number.isFinite(numeric) ? numeric : null)
      if (fill) r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      row += 1
    }
  }

  if (row > metricsFrom) {
    sheet.addConditionalFormatting({
      ref: `C${metricsFrom}:C${row - 1}`,
      rules: [
        {
          type: 'colorScale',
          priority: 3,
          cfvo: [{ type: 'min' }, { type: 'num', value: 0 }, { type: 'max' }],
          color: [{ argb: 'FFF87171' }, { argb: 'FFFFFFFF' }, { argb: 'FF4ADE80' }],
        } as any,
      ],
    })
  }

  return sheet
}

// ─── Лист «Смены» ───────────────────────────────────────────────────────────

function sheetShifts(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Смены', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] })
  sheet.columns = [
    { width: 12 },
    { width: 8 },
    { width: 18 },
    { width: 15 },
    { width: 15 },
    { width: 13 },
    { width: 13 },
    { width: 16 },
    { width: 20 },
    { width: 18 },
    { width: 40 },
  ]

  headerRow(sheet, 1, [
    'Дата',
    'Смена',
    'Продавец',
    'Касса',
    'Обычно бывает',
    'Покупателей',
    'Обычно бывает',
    'Как отработал',
    'Вывод',
    'Можно ли доверять',
    'Обстановка',
  ])

  let row = 2
  for (const s of c.shifts) {
    const context = [
      s.context.weather ? s.context.weather.split('.')[0] : null,
      ...s.context.days,
      ...s.context.periods,
    ]
      .filter(Boolean)
      .join('; ')

    const r = sheet.getRow(row)
    r.values = [
      s.date,
      s.shift,
      s.cashier || '—',
      s.revenue,
      s.expected_revenue,
      s.receipts,
      s.expected_receipts,
      s.score_text,
      s.verdict,
      s.confidence_text,
      context || 'обычный день',
    ]
    r.getCell(4).numFmt = MONEY_FMT
    r.getCell(5).numFmt = MONEY_FMT
    r.alignment = { vertical: 'middle' }
    r.getCell(11).alignment = { vertical: 'middle', wrapText: true }

    const verdictFill =
      s.verdict_tone === 'good' ? GOOD_FILL : s.verdict_tone === 'warn' ? WARN_FILL : null
    if (verdictFill) {
      r.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: verdictFill } }
    }

    row += 1
  }

  if (row > 2) {
    sheet.autoFilter = { from: 'A1', to: `K${row - 1}` }
    sheet.addConditionalFormatting({
      ref: `D2:D${row - 1}`,
      rules: [{ type: 'dataBar', color: { argb: 'FF16A34A' }, priority: 1 } as any],
    })
    sheet.addConditionalFormatting({
      ref: `F2:F${row - 1}`,
      rules: [{ type: 'dataBar', color: { argb: 'FF3B82F6' }, priority: 2 } as any],
    })
  }

  return sheet
}

// ─── Лист «Разбор» ──────────────────────────────────────────────────────────

function sheetDetail(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Разбор', { views: [{ showGridLines: false }] })
  sheet.columns = [{ width: 26 }, { width: 22 }, { width: 22 }, { width: 90 }]

  let row = 1
  for (const s of c.shifts) {
    sheet.mergeCells(`A${row}:D${row}`)
    const head = sheet.getCell(`A${row}`)
    head.value = `${s.date} · ${s.shift} · ${s.cashier || 'без продавца'} — ${s.verdict}, ${s.score_text} (${s.confidence_text})`
    head.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
    head.alignment = { vertical: 'middle' }
    sheet.getRow(row).height = 22
    row += 1

    const nums = sheet.getRow(row)
    nums.values = [
      `Касса: ${s.revenue.toLocaleString('ru-RU')} ₸`,
      `Обычно: ${s.expected_revenue == null ? '—' : s.expected_revenue.toLocaleString('ru-RU') + ' ₸'}`,
      `Покупателей: ${s.receipts}`,
      `Обычно: ${s.expected_receipts ?? '—'}`,
    ]
    nums.font = { size: 10, bold: true }
    row += 1

    if (s.headline) {
      sheet.mergeCells(`A${row}:D${row}`)
      const cell = sheet.getCell(`A${row}`)
      cell.value = s.headline
      cell.font = { bold: true, size: 11 }
      cell.alignment = { wrapText: true, vertical: 'top' }
      sheet.getRow(row).height = 20
      row += 1
    }

    for (const p of s.paragraphs) {
      sheet.mergeCells(`A${row}:D${row}`)
      const cell = sheet.getCell(`A${row}`)
      cell.value = p
      cell.alignment = { wrapText: true, vertical: 'top' }
      cell.font = { size: 10 }
      sheet.getRow(row).height = Math.max(18, Math.ceil(p.length / 110) * 15)
      row += 1
    }

    // Обстановка — рядом с выводом: половина ответа «почему такая касса»
    // именно в ней.
    const contextLines = [
      s.context.weather ? `Погода. ${s.context.weather}` : null,
      ...s.context.days.map((d) => `Календарь. ${d}`),
      ...s.context.periods.map((p) => `Учёба. ${p}`),
    ].filter(Boolean) as string[]

    if (contextLines.length === 0) {
      contextLines.push('Ни погоды, ни праздников, ни учебных периодов — кассу нечем объяснить, кроме работы.')
    }
    for (const line of contextLines) {
      sheet.mergeCells(`A${row}:D${row}`)
      const cell = sheet.getCell(`A${row}`)
      cell.value = line
      cell.alignment = { wrapText: true, vertical: 'top' }
      cell.font = { size: 10, color: { argb: 'FF475569' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MUTED_FILL } }
      row += 1
    }

    if (s.metrics.length > 0) {
      headerRow(sheet, row, ['Метрика', 'Было', 'Обычно бывает', 'Прочтение'])
      row += 1
      for (const m of s.metrics) {
        const r = sheet.getRow(row)
        r.values = [m.label, m.actual, m.expected, m.reading]
        r.getCell(4).alignment = { wrapText: true, vertical: 'top' }
        r.font = { size: 10 }
        const fill = m.tone === 'good' ? GOOD_FILL : m.tone === 'warn' ? WARN_FILL : null
        if (fill) r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
        r.height = Math.max(18, Math.ceil((m.reading || '').length / 110) * 15)
        row += 1
      }
    }

    for (const [label, text] of [
      ['Что это значит', s.conclusion],
      ['Что делать', s.action],
    ] as const) {
      if (!text) continue
      const r = sheet.getRow(row)
      r.values = [label, text]
      sheet.mergeCells(`B${row}:D${row}`)
      r.getCell(1).font = { bold: true, size: 10 }
      r.getCell(2).alignment = { wrapText: true, vertical: 'top' }
      r.height = Math.max(18, Math.ceil(text.length / 100) * 15)
      row += 1
    }

    for (const caveat of s.caveats) {
      sheet.mergeCells(`A${row}:D${row}`)
      const cell = sheet.getCell(`A${row}`)
      cell.value = `Где выводу нельзя доверять: ${caveat}`
      cell.font = { size: 9, color: { argb: 'FF92400E' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARN_FILL } }
      cell.alignment = { wrapText: true, vertical: 'top' }
      row += 1
    }

    row += 1
  }

  return sheet
}

// ─── Лист «Словарь» ─────────────────────────────────────────────────────────

function sheetGlossary(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Словарь', { views: [{ showGridLines: false }] })
  sheet.columns = [{ width: 34 }, { width: 100 }]

  headerRow(sheet, 1, ['Слово в отчёте', 'Что означает'])
  let row = 2
  for (const g of c.glossary) {
    const r = sheet.getRow(row)
    r.values = [g.term, g.meaning]
    r.getCell(1).font = { bold: true, size: 10 }
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    r.height = Math.max(18, Math.ceil(g.meaning.length / 95) * 15)
    row += 1
  }

  return sheet
}

// ─── Лист «Графики» ─────────────────────────────────────────────────────────

/**
 * Вставляет заранее нарисованные графики картинками.
 *
 * ExcelJS не умеет создавать нативные диаграммы Excel — это давнее
 * ограничение библиотеки, а не наш выбор. Поэтому графики рисуются в SVG,
 * снимаются в PNG тем же движком, что печатает PDF, и кладутся сюда
 * изображением. Внутриячеечные полоски на других листах остаются настоящим
 * условным форматированием: они живые и переживают фильтры.
 */
function sheetCharts(wb: ExcelJS.Workbook, images: { title: string; png: Buffer }[]) {
  if (images.length === 0) return null

  const sheet = wb.addWorksheet('Графики', { views: [{ showGridLines: false }] })
  sheet.columns = [{ width: 120 }]

  let row = 1
  for (const image of images) {
    const cell = sheet.getCell(`A${row}`)
    cell.value = image.title
    cell.font = { bold: true, size: 12 }
    row += 1

    const id = wb.addImage({ buffer: image.png as any, extension: 'png' })
    sheet.addImage(id, {
      tl: { col: 0, row: row - 1 },
      ext: { width: 900, height: 300 },
    })
    // Место под картинку: строки не растягиваются сами.
    row += 17
  }

  return sheet
}

// ─── Сборка ─────────────────────────────────────────────────────────────────

export async function buildSalesKpiWorkbook(
  contract: Contract,
  charts: { title: string; png: Buffer }[] = [],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Orda Control'
  wb.created = new Date()

  sheetSummary(wb, contract)
  sheetCashiers(wb, contract)
  sheetShifts(wb, contract)
  sheetCharts(wb, charts)
  sheetDetail(wb, contract)
  sheetGlossary(wb, contract)

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}
