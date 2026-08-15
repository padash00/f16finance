/**
 * Разбор смен и продавцов в Excel.
 *
 * Это документ, а не перенесённый в таблицу PDF. Разница принципиальная: в PDF
 * текст льётся сплошняком, а здесь у каждого листа своя работа, у каждой
 * таблицы — шапка, рамки и фильтр, у каждого числа — свой формат. По такому
 * файлу можно строить свои сводные, а не только читать.
 *
 *   Отчёт      — титул, оглавление, главное за период, срезы по неделям и дням
 *   Продавцы   — оценка людей и разбор их метрик
 *   Смены      — все числа с фильтром: касса, чеки, метрики, погода, календарь
 *   По дням    — сводка на каждый день: отсюда строят свои графики
 *   Разбор     — текст по каждой смене, но структурой, а не простынёй
 *   Графики    — картинки: касса против нормы, покупатели, продавцы
 *   Словарь    — что означает каждое слово отчёта
 *
 * Полоски и цветовые шкалы в ячейках — настоящее условное форматирование
 * Excel: они живые, пересчитываются при правке и переживают фильтры. Отдельные
 * графики лежат картинками: ExcelJS не умеет создавать нативные диаграммы, это
 * ограничение библиотеки.
 */

import ExcelJS from 'exceljs'

import type { buildShiftReportContract } from '@/lib/reports/build-shift-report-contract'

type Contract = ReturnType<typeof buildShiftReportContract>

// ─── Палитра ────────────────────────────────────────────────────────────────
// Те же цвета, что на экране портала: отчёт не должен выглядеть чужим.

const NAVY = 'FF0F2038' // фирменный тёмно-синий
const GREEN = 'FF16A34A'
const INK = 'FF0F2038'
const BODY = 'FF334155'
const MUTED = 'FF64748B'
const LINE = 'FFE2E8F0'

const FILL_HEAD = NAVY
const FILL_BAND = 'FFF1F5F9' // шапка раздела
const FILL_SOFT = 'FFF8FAFC' // подложка блока
const FILL_GOOD = 'FFDCFCE7'
const FILL_WARN = 'FFFEF3C7'

const FONT = 'Segoe UI'

// Прочерк вместо нуля: «нормы не было» и «ноль тенге» — разные вещи.
const MONEY_0 = '# ##0" ₸";-# ##0" ₸";"—"'
const PERCENT = '+0%;-0%;"как обычно"'
const NUMBER = '# ##0;-# ##0;"—"'
const DECIMAL = '0.00;-0.00;"—"'

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: LINE } },
  left: { style: 'thin', color: { argb: LINE } },
  bottom: { style: 'thin', color: { argb: LINE } },
  right: { style: 'thin', color: { argb: LINE } },
}

/**
 * Полоска внутри ячейки.
 *
 * `cfvo` обязателен: без границ шкалы писатель ExcelJS падает на
 * `undefined.forEach` уже при сохранении, и отчёт не собирается вовсе.
 * Минимум шкалы — ноль, а не наименьшее значение: иначе самая слабая смена
 * выглядела бы пустой строкой, будто продаж не было совсем.
 */
function dataBarRule(color: string, priority: number) {
  return {
    type: 'dataBar' as const,
    priority,
    color: { argb: color },
    cfvo: [{ type: 'num' as const, value: 0 }, { type: 'max' as const }],
    showValue: true,
    gradient: false,
  }
}

function colorScaleRule(priority: number) {
  return {
    type: 'colorScale' as const,
    priority,
    cfvo: [{ type: 'min' as const }, { type: 'num' as const, value: 0 }, { type: 'max' as const }],
    color: [{ argb: 'FFFCA5A5' }, { argb: 'FFFFFFFF' }, { argb: 'FF86EFAC' }],
  }
}

// ─── Кирпичики документа ────────────────────────────────────────────────────

/** Заголовок раздела: номер, название и объяснение под ним. */
function section(sheet: ExcelJS.Worksheet, row: number, no: string, title: string, hint: string, span: number) {
  sheet.mergeCells(row, 1, row, span)
  const cell = sheet.getCell(row, 1)
  cell.value = `${no}. ${title}`
  cell.font = { name: FONT, bold: true, size: 12, color: { argb: INK } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_BAND } }
  cell.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(row).height = 22
  row += 1

  if (hint) {
    sheet.mergeCells(row, 1, row, span)
    const note = sheet.getCell(row, 1)
    note.value = hint
    note.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } }
    note.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
    sheet.getRow(row).height = Math.max(16, Math.ceil(hint.length / 120) * 14)
    row += 1
  }

  return row + 1
}

/** Шапка таблицы: тёмная плашка, белый текст, перенос слов. */
function tableHead(sheet: ExcelJS.Worksheet, row: number, titles: string[], from = 1) {
  titles.forEach((title, i) => {
    const cell = sheet.getCell(row, from + i)
    cell.value = title
    cell.font = { name: FONT, bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEAD } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = THIN
  })
  sheet.getRow(row).height = 30
  return row + 1
}

/** Строка данных с рамками и чередованием фона — так таблица читается. */
function dataRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  values: (string | number | null)[],
  options: { striped?: boolean; from?: number } = {},
) {
  const from = options.from ?? 1
  values.forEach((value, i) => {
    const cell = sheet.getCell(row, from + i)
    cell.value = value as any
    cell.font = { name: FONT, size: 10, color: { argb: BODY } }
    cell.border = THIN
    cell.alignment = { vertical: 'middle' }
    if (options.striped) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SOFT } }
    }
  })
  return sheet.getRow(row)
}

function fillCell(sheet: ExcelJS.Worksheet, row: number, col: number, argb: string) {
  sheet.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function toneFill(delta: number | null | undefined): string | null {
  if (delta == null) return null
  if (delta >= 5) return FILL_GOOD
  if (delta <= -5) return FILL_WARN
  return null
}

/** Отклонение факта от нормы в долях. null — нормы не было. */
function ratio(actual: number, expected: number | null | undefined): number | null {
  if (expected == null || expected <= 0) return null
  return actual / expected - 1
}

// ─── Лист «Отчёт» ───────────────────────────────────────────────────────────

function sheetReport(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Отчёт', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  sheet.properties.tabColor = { argb: NAVY }
  sheet.columns = [
    { width: 26 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 44 },
  ]

  // ── Титул ────────────────────────────────────────────────────────────────
  sheet.mergeCells('A1:F1')
  const title = sheet.getCell('A1')
  title.value = c.meta.title.toUpperCase()
  title.font = { name: FONT, bold: true, size: 20, color: { argb: 'FFFFFFFF' } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  title.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(1).height = 40

  sheet.mergeCells('A2:F2')
  const strip = sheet.getCell('A2')
  strip.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
  sheet.getRow(2).height = 4

  sheet.mergeCells('A3:F3')
  const sub = sheet.getCell('A3')
  sub.value = `${c.meta.subtitle} · ${c.meta.period}`
  sub.font = { name: FONT, bold: true, size: 12, color: { argb: INK } }
  sub.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(3).height = 22

  sheet.mergeCells('A4:F4')
  const gen = sheet.getCell('A4')
  gen.value = `Сформирован ${c.meta.generated} · Orda Control · ${c.meta.brandNote}`
  gen.font = { name: FONT, size: 9, color: { argb: MUTED } }
  gen.alignment = { vertical: 'middle', indent: 1 }

  let row = 6

  // ── Оглавление ───────────────────────────────────────────────────────────
  row = section(sheet, row, '0', 'Содержание', 'Каждый лист отвечает на свой вопрос.', 6)
  const contents: [string, string][] = [
    ['Продавцы', 'кто как работает с покупателем и что ему подтянуть'],
    ['Смены', 'все числа с фильтром: касса, чеки, метрики, погода, календарь'],
    ['По дням', 'сводка на каждый день — отсюда строят свои графики'],
    ['Разбор', 'что произошло в каждой смене, словами'],
    ['Графики', 'касса против нормы, покупатели, отклонения продавцов'],
    ['Словарь', 'что означает каждое слово отчёта'],
  ]
  row = tableHead(sheet, row, ['Лист', 'На какой вопрос отвечает'], 1)
  sheet.mergeCells(row - 1, 2, row - 1, 6)
  for (const [name, purpose] of contents) {
    const r = dataRow(sheet, row, [name, purpose])
    sheet.mergeCells(row, 2, row, 6)
    r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
    row += 1
  }
  row += 1

  // ── Главное за период ────────────────────────────────────────────────────
  const t = c.summary.totals
  row = section(
    sheet,
    row,
    '1',
    'Главное за период',
    'Выручка и чеки — это спрос. Оценка работы продавцов лежит на своём листе: касса зависит от того, сколько людей зашло, а это не заслуга человека за прилавком.',
    6,
  )
  row = tableHead(sheet, row, ['Показатель', 'Значение', 'Пояснение'])
  sheet.mergeCells(row - 1, 3, row - 1, 6)

  const mainRows: [string, string | number, string, string?][] = [
    ['Смен разобрано', t.shifts, c.meta.period],
    ['Выручка', t.revenue, `${t.receipts.toLocaleString('ru-RU')} чеков`, 'money'],
    ['Средний чек', t.avg_ticket ?? '—', 'выручка, делённая на число чеков', 'money'],
    ['Продавцов', c.cashiers.length, 'с указанным именем в чеках'],
  ]
  for (const [label, value, hint, fmt] of mainRows) {
    const r = dataRow(sheet, row, [label, value as any, hint])
    sheet.mergeCells(row, 3, row, 6)
    r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
    r.getCell(2).font = { name: FONT, bold: true, size: 12, color: { argb: INK } }
    r.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' }
    if (fmt === 'money') r.getCell(2).numFmt = MONEY_0
    r.getCell(3).font = { name: FONT, size: 9, color: { argb: MUTED } }
    row += 1
  }
  row += 1

  // ── Из чего состоял период ───────────────────────────────────────────────
  row = section(
    sheet,
    row,
    '2',
    'Из чего состоял период',
    '«Мало покупателей» — не в укор продавцу: зашло меньше обычного. «Вопрос к продавцу» — наоборот: люди были, а отдача ниже нормы.',
    6,
  )
  row = tableHead(sheet, row, ['Вывод', 'Смен', 'Доля', 'Что это значит'])
  sheet.mergeCells(row - 1, 4, row - 1, 6)

  const verdictFrom = row
  for (const v of t.verdicts) {
    const r = dataRow(sheet, row, [v.label, v.count, t.shifts > 0 ? v.count / t.shifts : 0, v.hint])
    sheet.mergeCells(row, 4, row, 6)
    r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
    r.getCell(3).numFmt = '0%'
    r.getCell(4).font = { name: FONT, size: 9, color: { argb: MUTED } }
    r.getCell(4).alignment = { vertical: 'middle', wrapText: true }
    if (v.label === 'Сильная смена') fillCell(sheet, row, 1, FILL_GOOD)
    if (v.label === 'Вопрос к продавцу') fillCell(sheet, row, 1, FILL_WARN)
    row += 1
  }
  if (row > verdictFrom) {
    sheet.addConditionalFormatting({
      ref: `B${verdictFrom}:B${row - 1}`,
      rules: [dataBarRule(GREEN, 1) as any],
    })
  }
  row += 1

  // ── Лучшая и слабая смена ────────────────────────────────────────────────
  const h = c.summary.highlights
  if (h.best || h.worst) {
    row = section(
      sheet,
      row,
      '3',
      'Смена месяца и смена для разбора',
      'Выбраны по работе с покупателем, а не по кассе: по кассе «лучшей» всегда оказывалась бы самая людная пятница.',
      6,
    )
    row = tableHead(sheet, row, ['Смена', 'Дата', 'Часть суток', 'Продавец', 'Как отработал', 'Касса'])
    for (const [label, item] of [
      ['Лучшая', h.best],
      ['Слабая', h.worst],
    ] as const) {
      if (!item) continue
      const r = dataRow(sheet, row, [
        label,
        item.date,
        item.shift,
        item.cashier || '—',
        item.score_text,
        item.revenue,
      ])
      r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
      r.getCell(6).numFmt = MONEY_0
      fillCell(sheet, row, 5, label === 'Лучшая' ? FILL_GOOD : FILL_WARN)
      row += 1
    }
    row += 1
  }

  // ── Недели ───────────────────────────────────────────────────────────────
  row = section(
    sheet,
    row,
    '4',
    'По неделям',
    'Отклонение считается от нормы для таких же смен, а не от предыдущей недели: иначе праздничная неделя всегда выглядела бы провалом следующей.',
    6,
  )
  row = tableHead(sheet, row, ['Неделя', 'Смен', 'Выручка', 'Обычно бывает', 'Отклонение', 'Чеков'])
  const weeksFrom = row
  for (const w of c.summary.weeks) {
    const delta = ratio(w.revenue, w.expected)
    const r = dataRow(sheet, row, [w.label, w.shifts, w.revenue, w.expected, delta, w.receipts])
    r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
    r.getCell(3).numFmt = MONEY_0
    r.getCell(4).numFmt = MONEY_0
    r.getCell(5).numFmt = PERCENT
    r.getCell(6).numFmt = NUMBER
    const fill = toneFill(delta == null ? null : delta * 100)
    if (fill) fillCell(sheet, row, 5, fill)
    row += 1
  }
  if (row > weeksFrom) {
    sheet.addConditionalFormatting({
      ref: `C${weeksFrom}:C${row - 1}`,
      rules: [dataBarRule(GREEN, 2) as any],
    })
  }
  row += 1

  // ── Дни недели ───────────────────────────────────────────────────────────
  row = section(
    sheet,
    row,
    '5',
    'По дням недели',
    'Показывает, какие дни у точки сильные, а какие слабые. Это про спрос, а не про людей: смены распределяются по графику, а не по желанию продавца.',
    6,
  )
  row = tableHead(sheet, row, ['День недели', 'Смен', 'Выручка', 'Средняя за смену', 'Чеков', 'Средний чек'])
  const weekdaysFrom = row
  for (const d of c.summary.weekdays) {
    const perShift = d.shifts > 0 ? Math.round(d.revenue / d.shifts) : null
    const avgTicket = d.receipts > 0 ? Math.round(d.revenue / d.receipts) : null
    const r = dataRow(sheet, row, [d.label, d.shifts, d.revenue, perShift, d.receipts, avgTicket])
    r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
    r.getCell(3).numFmt = MONEY_0
    r.getCell(4).numFmt = MONEY_0
    r.getCell(5).numFmt = NUMBER
    r.getCell(6).numFmt = MONEY_0
    row += 1
  }
  if (row > weekdaysFrom) {
    sheet.addConditionalFormatting({
      ref: `D${weekdaysFrom}:D${row - 1}`,
      rules: [dataBarRule('FF3B82F6', 3) as any],
    })
  }
  row += 1

  // ── День против ночи ─────────────────────────────────────────────────────
  if (c.summary.parts.length > 0) {
    row = section(sheet, row, '6', 'День против ночи', 'Две смены живут в разном потоке и в разной погоде — сравнивать их напрямую нельзя.', 6)
    row = tableHead(sheet, row, ['Смена', 'Смен', 'Выручка', 'Средняя за смену', 'Чеков', 'Средний чек'])
    for (const p of c.summary.parts) {
      const perShift = p.shifts > 0 ? Math.round(p.revenue / p.shifts) : null
      const avgTicket = p.receipts > 0 ? Math.round(p.revenue / p.receipts) : null
      const r = dataRow(sheet, row, [p.label, p.shifts, p.revenue, perShift, p.receipts, avgTicket])
      r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
      r.getCell(3).numFmt = MONEY_0
      r.getCell(4).numFmt = MONEY_0
      r.getCell(5).numFmt = NUMBER
      r.getCell(6).numFmt = MONEY_0
      row += 1
    }
    row += 1
  }

  // ── Качество данных ──────────────────────────────────────────────────────
  if (c.summary.notes?.length) {
    row = section(sheet, row, '7', 'Что мешало считать точно', 'Отчёт обязан сказать, чего в данных не хватало: иначе его цифры выглядят надёжнее, чем они есть.', 6)
    for (const note of c.summary.notes) {
      sheet.mergeCells(row, 1, row, 6)
      const cell = sheet.getCell(row, 1)
      cell.value = `•  ${note}`
      cell.font = { name: FONT, size: 10, color: { argb: 'FF92400E' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_WARN } }
      cell.alignment = { vertical: 'top', wrapText: true, indent: 1 }
      cell.border = THIN
      sheet.getRow(row).height = Math.max(20, Math.ceil(note.length / 130) * 15)
      row += 1
    }
    row += 1
  }

  // ── Метод ────────────────────────────────────────────────────────────────
  row = section(sheet, row, '8', 'Как это считается', '', 6)
  sheet.mergeCells(row, 1, row + 4, 6)
  const method = sheet.getCell(row, 1)
  method.value = c.summary.method
  method.font = { name: FONT, size: 10, color: { argb: BODY } }
  method.alignment = { vertical: 'top', wrapText: true, indent: 1 }
  method.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SOFT } }
  method.border = THIN

  return sheet
}

// ─── Лист «Продавцы» ────────────────────────────────────────────────────────

function sheetCashiers(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Продавцы', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  sheet.properties.tabColor = { argb: GREEN }
  sheet.columns = [
    { width: 18 },
    { width: 15 },
    { width: 16 },
    { width: 18 },
    { width: 8 },
    { width: 10 },
    { width: 16 },
    { width: 32 },
    { width: 32 },
  ]

  sheet.mergeCells('A1:I1')
  const head = sheet.getCell('A1')
  head.value = `ПРОДАВЦЫ · ${c.meta.subtitle} · ${c.meta.period}`
  head.font = { name: FONT, bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  head.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(1).height = 28

  sheet.mergeCells('A2:I2')
  const hint = sheet.getCell('A2')
  hint.value =
    'Оценка человека, а не смены. Выручка — справка: она зависит от того, сколько людей зашло. Оценивается то, что продавец делает с каждым покупателем.'
  hint.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } }
  hint.alignment = { vertical: 'middle', indent: 1 }

  let row = tableHead(sheet, 3, [
    'Продавец',
    'Статус',
    'Как отработал',
    'Можно ли доверять',
    'Смен',
    'Чеков',
    'Выручка',
    'Сильные стороны',
    'Стоит подтянуть',
  ])

  const from = row
  c.cashiers.forEach((p, i) => {
    const r = dataRow(
      sheet,
      row,
      [
        p.name,
        p.status,
        p.score_text,
        p.confidence_text,
        p.shifts,
        p.receipts,
        p.revenue,
        p.strengths.join(', ') || '—',
        p.weaknesses.join(', ') || '—',
      ],
      { striped: i % 2 === 1 },
    )
    r.getCell(1).font = { name: FONT, bold: true, size: 10.5, color: { argb: INK } }
    r.getCell(6).numFmt = NUMBER
    r.getCell(7).numFmt = MONEY_0
    r.getCell(8).alignment = { vertical: 'middle', wrapText: true }
    r.getCell(9).alignment = { vertical: 'middle', wrapText: true }
    r.height = 22

    const statusFill =
      p.status === 'Топ' || p.status === 'Сильный'
        ? FILL_GOOD
        : p.status === 'Нужна помощь'
          ? FILL_WARN
          : null
    if (statusFill) fillCell(sheet, row, 2, statusFill)
    row += 1
  })

  if (row > from) {
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: row - 1, column: 9 } }
    sheet.addConditionalFormatting({ ref: `G${from}:G${row - 1}`, rules: [dataBarRule(GREEN, 1) as any] })
    sheet.addConditionalFormatting({ ref: `E${from}:E${row - 1}`, rules: [dataBarRule('FF3B82F6', 2) as any] })
  }

  // ── Метрики ──────────────────────────────────────────────────────────────
  row += 2
  row = section(
    sheet,
    row,
    'Δ',
    'Метрики: отклонение от нормы',
    'Норма — то, что обычно бывает в похожих сменах. Ноль означает «работает как обычно для этой точки», а не «плохо».',
    9,
  )
  row = tableHead(sheet, row, ['Продавец', 'Метрика', 'Отклонение', 'Как читать'])
  sheet.mergeCells(row - 1, 4, row - 1, 9)

  const metricsFrom = row
  for (const p of c.cashiers) {
    for (const m of p.metrics) {
      const numeric = Number(String(m.delta_text).replace(/[^\d+-]/g, ''))
      const value = Number.isFinite(numeric) ? numeric / 100 : null
      const r = dataRow(sheet, row, [
        p.name,
        m.label,
        value,
        value == null
          ? 'нормы для сравнения не нашлось'
          : Math.abs(numeric) < 1
            ? 'работает как обычно'
            : numeric > 0
              ? `выше обычного на ${Math.abs(numeric)}%`
              : `ниже обычного на ${Math.abs(numeric)}%`,
      ])
      sheet.mergeCells(row, 4, row, 9)
      r.getCell(3).numFmt = PERCENT
      r.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' }
      r.getCell(4).font = { name: FONT, size: 9, color: { argb: MUTED } }
      row += 1
    }
  }

  if (row > metricsFrom) {
    sheet.addConditionalFormatting({
      ref: `C${metricsFrom}:C${row - 1}`,
      rules: [colorScaleRule(3) as any],
    })
  }

  return sheet
}

// ─── Лист «Смены» ───────────────────────────────────────────────────────────

function sheetShifts(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Смены', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 3, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  sheet.properties.tabColor = { argb: 'FF3B82F6' }

  const columns = [
    ['Дата', 12],
    ['День недели', 13],
    ['Смена', 8],
    ['Продавец', 15],
    ['Часов', 8],
    ['Касса', 14],
    ['Обычно бывает', 14],
    ['Откл. кассы', 12],
    ['Покупателей', 12],
    ['Обычно бывает', 13],
    ['Откл. потока', 12],
    ['Средний чек', 13],
    ['Товаров на чек', 13],
    ['Допродажи', 11],
    ['Как отработал', 15],
    ['Вывод', 18],
    ['Можно ли доверять', 17],
    ['Погода', 16],
    ['Мин °C', 8],
    ['Макс °C', 8],
    ['Осадки, мм', 11],
    ['Окно смены', 13],
    ['Праздник', 24],
    ['Учебный период', 30],
  ] as const

  sheet.columns = columns.map(([, width]) => ({ width }))

  sheet.mergeCells(1, 1, 1, columns.length)
  const head = sheet.getCell(1, 1)
  head.value = `СМЕНЫ · ${c.meta.subtitle} · ${c.meta.period}`
  head.font = { name: FONT, bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  head.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(1).height = 28

  sheet.mergeCells(2, 1, 2, columns.length)
  const hint = sheet.getCell(2, 1)
  hint.value =
    'Каждая строка — одна смена. Погода посчитана в часы этой смены, а не за сутки: ночная смена не видела дневной жары. Колонки можно фильтровать и строить свои сводные.'
  hint.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } }
  hint.alignment = { vertical: 'middle', indent: 1 }

  let row = tableHead(sheet, 3, columns.map(([label]) => label))
  const from = row

  c.shifts.forEach((s, i) => {
    const revenueDelta = ratio(s.revenue, s.expected_revenue)
    const receiptsDelta = ratio(s.receipts, s.expected_receipts)

    const r = dataRow(
      sheet,
      row,
      [
        s.date,
        s.weekday,
        s.shift,
        s.cashier || '—',
        s.duration_hours,
        s.revenue,
        s.expected_revenue,
        revenueDelta,
        s.receipts,
        s.expected_receipts,
        receiptsDelta,
        s.avg_ticket,
        s.items_per_receipt,
        s.attach_rate,
        s.score_text,
        s.verdict,
        s.confidence_text,
        s.weather_label,
        s.temperature_min,
        s.temperature_max,
        s.precipitation_mm,
        s.weather_window,
        s.holidays_text,
        s.periods_text,
      ],
      { striped: i % 2 === 1 },
    )

    r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
    r.getCell(5).numFmt = '0.0;;"—"'
    r.getCell(6).numFmt = MONEY_0
    r.getCell(7).numFmt = MONEY_0
    r.getCell(8).numFmt = PERCENT
    r.getCell(9).numFmt = NUMBER
    r.getCell(10).numFmt = NUMBER
    r.getCell(11).numFmt = PERCENT
    r.getCell(12).numFmt = MONEY_0
    r.getCell(13).numFmt = DECIMAL
    r.getCell(14).numFmt = '0%;;"—"'
    r.getCell(19).numFmt = '0;-0;"—"'
    r.getCell(20).numFmt = '0;-0;"—"'
    r.getCell(21).numFmt = '0.0;;"—"'
    r.getCell(23).alignment = { vertical: 'middle', wrapText: true }
    r.getCell(24).alignment = { vertical: 'middle', wrapText: true }

    const verdictFill =
      s.verdict_tone === 'good' ? FILL_GOOD : s.verdict_tone === 'warn' ? FILL_WARN : null
    if (verdictFill) fillCell(sheet, row, 16, verdictFill)

    const scoreFill = toneFill(
      s.score_text.startsWith('лучше') ? 10 : s.score_text.startsWith('слабее') ? -10 : 0,
    )
    if (scoreFill) fillCell(sheet, row, 15, scoreFill)

    row += 1
  })

  if (row > from) {
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: row - 1, column: columns.length } }
    sheet.addConditionalFormatting({ ref: `F${from}:F${row - 1}`, rules: [dataBarRule(GREEN, 1) as any] })
    sheet.addConditionalFormatting({ ref: `I${from}:I${row - 1}`, rules: [dataBarRule('FF3B82F6', 2) as any] })
    sheet.addConditionalFormatting({ ref: `H${from}:H${row - 1}`, rules: [colorScaleRule(3) as any] })
    sheet.addConditionalFormatting({ ref: `K${from}:K${row - 1}`, rules: [colorScaleRule(4) as any] })
  }

  return sheet
}

// ─── Лист «По дням» ─────────────────────────────────────────────────────────

/**
 * Сводка на каждый день.
 *
 * Отдельный лист нужен ровно затем, чтобы владелец мог выделить две колонки и
 * вставить свой график: на листе смен две строки на один день, и Excel рисует
 * по ним ерунду.
 */
function sheetByDay(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('По дням', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
  })
  sheet.properties.tabColor = { argb: 'FF8B5CF6' }
  sheet.columns = [
    { width: 12 },
    { width: 13 },
    { width: 8 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 13 },
    { width: 13 },
    { width: 18 },
  ]

  sheet.mergeCells('A1:J1')
  const head = sheet.getCell('A1')
  head.value = `ПО ДНЯМ · ${c.meta.period}`
  head.font = { name: FONT, bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  head.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(1).height = 28

  sheet.mergeCells('A2:J2')
  const hint = sheet.getCell('A2')
  hint.value =
    'Одна строка — один день. Выделите нужные колонки и вставьте свой график: здесь для этого всё готово.'
  hint.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } }
  hint.alignment = { vertical: 'middle', indent: 1 }

  let row = tableHead(sheet, 3, [
    'Дата',
    'День недели',
    'Смен',
    'Касса',
    'Обычно бывает',
    'Покупателей',
    'Обычно бывает',
    'Средний чек',
    'Погода',
    'Календарь',
  ])

  const byDay = new Map<
    string,
    {
      weekday: string
      shifts: number
      revenue: number
      expected: number | null
      receipts: number
      expectedReceipts: number | null
      weather: string | null
      calendar: string | null
    }
  >()

  for (const s of c.shifts) {
    const cur =
      byDay.get(s.date) ||
      {
        weekday: s.weekday,
        shifts: 0,
        revenue: 0,
        expected: null,
        receipts: 0,
        expectedReceipts: null,
        weather: null,
        calendar: null,
      }
    cur.shifts += 1
    cur.revenue += s.revenue
    cur.receipts += s.receipts
    if (s.expected_revenue != null) cur.expected = (cur.expected ?? 0) + s.expected_revenue
    if (s.expected_receipts != null) cur.expectedReceipts = (cur.expectedReceipts ?? 0) + s.expected_receipts
    // Погода дневной смены как погода дня: ночную видит меньше покупателей.
    if (!cur.weather && s.shift === 'день') cur.weather = s.weather_label
    if (!cur.weather) cur.weather = s.weather_label
    cur.calendar = cur.calendar || [s.holidays_text, s.periods_text].filter(Boolean).join('; ') || null
    byDay.set(s.date, cur)
  }

  const from = row
  ;[...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, d], i) => {
      const avgTicket = d.receipts > 0 ? Math.round(d.revenue / d.receipts) : null
      const r = dataRow(
        sheet,
        row,
        [
          date,
          d.weekday,
          d.shifts,
          d.revenue,
          d.expected,
          d.receipts,
          d.expectedReceipts,
          avgTicket,
          d.weather,
          d.calendar,
        ],
        { striped: i % 2 === 1 },
      )
      r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
      r.getCell(4).numFmt = MONEY_0
      r.getCell(5).numFmt = MONEY_0
      r.getCell(6).numFmt = NUMBER
      r.getCell(7).numFmt = NUMBER
      r.getCell(8).numFmt = MONEY_0
      r.getCell(10).alignment = { vertical: 'middle', wrapText: true }
      row += 1
    })

  if (row > from) {
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: row - 1, column: 10 } }
    sheet.addConditionalFormatting({ ref: `D${from}:D${row - 1}`, rules: [dataBarRule(GREEN, 1) as any] })
    sheet.addConditionalFormatting({ ref: `F${from}:F${row - 1}`, rules: [dataBarRule('FF3B82F6', 2) as any] })
  }

  return sheet
}

// ─── Лист «Разбор» ──────────────────────────────────────────────────────────

/**
 * Текст по каждой смене — но структурой, а не простынёй.
 *
 * Раньше здесь было восемьсот строк объединённых ячеек: тот же PDF, только в
 * таблице. Теперь у каждой смены свой номер, своя шапка и своя таблица
 * показателей, а текст лежит в одной колонке фиксированной ширины — его видно
 * целиком и он не растягивает соседние.
 */
function sheetDetail(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Разбор', { views: [{ showGridLines: false }] })
  sheet.properties.tabColor = { argb: 'FFF59E0B' }
  sheet.columns = [{ width: 4 }, { width: 24 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 78 }]

  sheet.mergeCells('A1:F1')
  const head = sheet.getCell('A1')
  head.value = `РАЗБОР КАЖДОЙ СМЕНЫ · ${c.meta.period}`
  head.font = { name: FONT, bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  head.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(1).height = 28

  let row = 3

  c.shifts.forEach((s, index) => {
    // ── Шапка смены ────────────────────────────────────────────────────────
    sheet.mergeCells(row, 1, row, 6)
    const title = sheet.getCell(row, 1)
    title.value = `${index + 1}.  ${s.date}, ${s.weekday}, ${s.shift} — ${s.cashier || 'без продавца'}`
    title.font = { name: FONT, bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    title.alignment = { vertical: 'middle', indent: 1 }
    sheet.getRow(row).height = 24
    row += 1

    sheet.mergeCells(row, 1, row, 6)
    const badges = sheet.getCell(row, 1)
    badges.value = `${s.verdict}  ·  ${s.score_text}  ·  ${s.confidence_text}`
    badges.font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
    badges.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: s.verdict_tone === 'good' ? FILL_GOOD : s.verdict_tone === 'warn' ? FILL_WARN : FILL_BAND },
    }
    badges.alignment = { vertical: 'middle', indent: 1 }
    row += 2

    // ── Цифры смены ────────────────────────────────────────────────────────
    row = tableHead(sheet, row, ['Показатель', 'Было', 'Обычно бывает', 'Отклонение', 'Что это значит'], 2)

    const factRows: [string, number | null, number | null, string, string][] = [
      [
        'Касса',
        s.revenue,
        s.expected_revenue,
        MONEY_0,
        'Зависит и от продавца, и от числа покупателей.',
      ],
      [
        'Покупателей',
        s.receipts,
        s.expected_receipts,
        NUMBER,
        'Число чеков. Это спрос: привести людей в магазин продавец не может.',
      ],
    ]
    for (const [label, actual, expected, fmt, meaning] of factRows) {
      const delta = actual == null ? null : ratio(actual, expected)
      const r = dataRow(sheet, row, [label, actual, expected, delta, meaning], { from: 2 })
      r.getCell(2).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
      r.getCell(3).numFmt = fmt
      r.getCell(4).numFmt = fmt
      r.getCell(5).numFmt = PERCENT
      r.getCell(6).font = { name: FONT, size: 9, color: { argb: MUTED } }
      r.getCell(6).alignment = { vertical: 'middle', wrapText: true }
      const fill = toneFill(delta == null ? null : delta * 100)
      if (fill) fillCell(sheet, row, 5, fill)
      row += 1
    }
    row += 1

    // ── Метрики ────────────────────────────────────────────────────────────
    if (s.metrics.length > 0) {
      row = tableHead(sheet, row, ['Метрика', 'Было', 'Обычно бывает', 'Отклонение', 'Как это читать'], 2)
      for (const m of s.metrics) {
        const r = dataRow(sheet, row, [m.label, m.actual, m.expected, m.delta_text, m.reading], { from: 2 })
        r.getCell(2).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
        r.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' }
        r.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
        r.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' }
        r.getCell(6).font = { name: FONT, size: 9, color: { argb: BODY } }
        r.getCell(6).alignment = { vertical: 'top', wrapText: true }
        r.height = Math.max(18, Math.ceil((m.reading || '').length / 90) * 14)
        const fill = m.tone === 'good' ? FILL_GOOD : m.tone === 'warn' ? FILL_WARN : null
        if (fill) fillCell(sheet, row, 5, fill)
        row += 1
      }
      row += 1
    }

    // ── Обстановка ─────────────────────────────────────────────────────────
    const contextLines: [string, string][] = []
    if (s.context.weather) contextLines.push(['Погода', s.context.weather])
    for (const d of s.context.days) contextLines.push(['Календарь', d])
    for (const p of s.context.periods) contextLines.push(['Учёба', p])
    if (contextLines.length === 0) {
      contextLines.push([
        'Обстановка',
        'Ни погоды, ни праздников, ни учебных периодов — кассу нечем объяснить, кроме работы.',
      ])
    }

    row = tableHead(sheet, row, ['Обстановка', 'Что было'], 2)
    sheet.mergeCells(row - 1, 3, row - 1, 6)
    for (const [label, text] of contextLines) {
      const r = dataRow(sheet, row, [label, text], { from: 2 })
      sheet.mergeCells(row, 3, row, 6)
      r.getCell(2).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
      r.getCell(3).alignment = { vertical: 'top', wrapText: true }
      r.height = Math.max(18, Math.ceil(text.length / 130) * 14)
      row += 1
    }
    row += 1

    // ── Словами ────────────────────────────────────────────────────────────
    const narrative: [string, string][] = []
    if (s.headline) narrative.push(['Коротко', s.headline])
    s.paragraphs.forEach((p, i) => narrative.push([i === 0 ? 'Подробно' : '', p]))
    if (s.conclusion) narrative.push(['Что это значит', s.conclusion])
    if (s.action) narrative.push(['Что делать', s.action])

    for (const [label, text] of narrative) {
      const r = dataRow(sheet, row, [label, text], { from: 2 })
      sheet.mergeCells(row, 3, row, 6)
      r.getCell(2).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
      r.getCell(3).font = { name: FONT, size: 10, color: { argb: BODY } }
      r.getCell(3).alignment = { vertical: 'top', wrapText: true }
      r.height = Math.max(18, Math.ceil(text.length / 130) * 15)
      row += 1
    }

    for (const caveat of s.caveats) {
      const r = dataRow(sheet, row, ['Осторожно', caveat], { from: 2 })
      sheet.mergeCells(row, 3, row, 6)
      r.getCell(2).font = { name: FONT, bold: true, size: 9, color: { argb: 'FF92400E' } }
      r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_WARN } }
      r.getCell(3).font = { name: FONT, size: 9, color: { argb: 'FF92400E' } }
      r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_WARN } }
      r.getCell(3).alignment = { vertical: 'top', wrapText: true }
      row += 1
    }

    row += 2
  })

  return sheet
}

// ─── Лист «Графики» ─────────────────────────────────────────────────────────

function sheetCharts(wb: ExcelJS.Workbook, c: Contract, images: { title: string; png: Buffer }[]) {
  if (images.length === 0) return null

  const sheet = wb.addWorksheet('Графики', { views: [{ showGridLines: false }] })
  sheet.properties.tabColor = { argb: 'FF0EA5E9' }
  sheet.columns = [{ width: 130 }]

  sheet.getCell('A1').value = `ГРАФИКИ · ${c.meta.subtitle} · ${c.meta.period}`
  sheet.getCell('A1').font = { name: FONT, bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  sheet.getCell('A1').alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(1).height = 28

  sheet.getCell('A2').value =
    'Картинки, а не диаграммы Excel: библиотека сборки не умеет создавать нативные графики. Свой график можно построить на листе «По дням».'
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } }

  let row = 4
  for (const image of images) {
    const cell = sheet.getCell(`A${row}`)
    cell.value = image.title
    cell.font = { name: FONT, bold: true, size: 11, color: { argb: INK } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_BAND } }
    cell.alignment = { vertical: 'middle', indent: 1 }
    sheet.getRow(row).height = 20
    row += 1

    const id = wb.addImage({ buffer: image.png as any, extension: 'png' })
    sheet.addImage(id, { tl: { col: 0, row: row - 1 }, ext: { width: 900, height: 300 } })
    row += 17
  }

  return sheet
}

// ─── Лист «Словарь» ─────────────────────────────────────────────────────────

function sheetGlossary(wb: ExcelJS.Workbook, c: Contract) {
  const sheet = wb.addWorksheet('Словарь', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] })
  sheet.properties.tabColor = { argb: 'FF64748B' }
  sheet.columns = [{ width: 34 }, { width: 110 }]

  sheet.mergeCells('A1:B1')
  const head = sheet.getCell('A1')
  head.value = 'СЛОВАРЬ ОТЧЁТА'
  head.font = { name: FONT, bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  head.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(1).height = 28

  sheet.mergeCells('A2:B2')
  const hint = sheet.getCell('A2')
  hint.value = 'В отчёте нет слова, которое нельзя объяснить кассиру за десять секунд. Здесь все объяснения.'
  hint.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } }
  hint.alignment = { vertical: 'middle', indent: 1 }

  let row = tableHead(sheet, 3, ['Слово в отчёте', 'Что означает'])
  c.glossary.forEach((g, i) => {
    const r = dataRow(sheet, row, [g.term, g.meaning], { striped: i % 2 === 1 })
    r.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: INK } }
    r.getCell(2).alignment = { vertical: 'top', wrapText: true }
    r.height = Math.max(20, Math.ceil(g.meaning.length / 105) * 15)
    row += 1
  })

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
  wb.title = `${contract.meta.title} · ${contract.meta.period}`

  sheetReport(wb, contract)
  sheetCashiers(wb, contract)
  sheetShifts(wb, contract)
  sheetByDay(wb, contract)
  sheetCharts(wb, contract, charts)
  sheetDetail(wb, contract)
  sheetGlossary(wb, contract)

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}
