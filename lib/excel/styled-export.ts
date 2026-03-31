/**
 * Styled Excel export utility using ExcelJS.
 * Creates professional-looking reports with colors, borders, and formatting.
 */
import ExcelJS from 'exceljs'

// ─── Color palette ─────────────────────────────────────────────────────────────
const COLORS = {
  headerBg: '0F172A',      // dark navy header
  headerText: 'FFFFFF',
  bodyText: '0F172A',
  mutedText: '475569',
  sectionBg: '1E3A5F',     // section header
  sectionText: 'FFFFFF',
  subheaderBg: '2D5A8E',
  subheaderText: 'FFFFFF',
  totalsBg: 'FFF3CD',      // light yellow totals
  totalsText: '7C5800',
  positive: '15803D',      // green for profit
  negative: 'DC2626',      // red for loss
  rowEven: 'F8FAFC',       // alternating rows
  rowOdd: 'FFFFFF',
  border: 'CBD5E1',
  metricBg: 'EFF6FF',      // light blue metrics
  metricText: '1D4ED8',
  warnBg: 'FEF3C7',
  dangerBg: 'FEE2E2',
  goodBg: 'DCFCE7',
  neutralBg: 'F8FAFC',
  panelBg: 'FFFFFF',
  chartGrid: 'E2E8F0',
  accentBlue: '2563EB',
  accentEmerald: '059669',
  accentAmber: 'D97706',
  accentRed: 'DC2626',
}

const FONT_NAME = 'Arial'
const CONTENTS_SHEET_NAME = 'Содержание'
const RAW_PREFIX = 'raw-'

// ─── Helpers ───────────────────────────────────────────────────────────────────
function argbOf(hex: string) { return `FF${hex.toUpperCase()}` }

function columnLetter(index: number) {
  let result = ''
  let current = index
  while (current > 0) {
    const modulo = (current - 1) % 26
    result = String.fromCharCode(65 + modulo) + result
    current = Math.floor((current - 1) / 26)
  }
  return result
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function truncateLabel(value: string, max = 20) {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value
}

function formatChartValue(value: number, format: DashboardValueFormat = 'number') {
  if (format === 'percent') return `${value.toFixed(1)}%`

  const abs = Math.abs(value)
  const suffix = format === 'money' ? ' ₸' : ''
  const sign = value < 0 ? '-' : ''

  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)} млн${suffix}`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)} тыс${suffix}`
  return `${sign}${Math.round(abs).toLocaleString('ru-RU')}${suffix}`
}

function paletteForTone(tone: DashboardTone = 'neutral') {
  switch (tone) {
    case 'good':
      return { bg: COLORS.goodBg, accent: COLORS.accentEmerald }
    case 'warn':
      return { bg: COLORS.warnBg, accent: COLORS.accentAmber }
    case 'danger':
      return { bg: COLORS.dangerBg, accent: COLORS.accentRed }
    default:
      return { bg: COLORS.metricBg, accent: COLORS.accentBlue }
  }
}

function headerStyle(bgHex: string, textHex = 'FFFFFF', size = 10): Partial<ExcelJS.Style> {
  return {
    font: { name: FONT_NAME, bold: true, size, color: { argb: argbOf(textHex) } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(bgHex) } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: {
      top: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      bottom: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      left: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      right: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
    },
  }
}

function dataStyle(rowIndex: number, bold = false, align: ExcelJS.Alignment['horizontal'] = 'left'): Partial<ExcelJS.Style> {
  const bg = rowIndex % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd
  return {
    font: { name: FONT_NAME, bold, size: 10 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(bg) } },
    alignment: { horizontal: align, vertical: 'middle' },
    border: {
      top: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      bottom: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      left: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      right: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
    },
  }
}

function totalsStyle(): Partial<ExcelJS.Style> {
  return {
    font: { name: FONT_NAME, bold: true, size: 10, color: { argb: argbOf(COLORS.totalsText) } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(COLORS.totalsBg) } },
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: {
      top: { style: 'medium', color: { argb: argbOf('94A3B8') } },
      bottom: { style: 'medium', color: { argb: argbOf('94A3B8') } },
      left: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      right: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
    },
  }
}

// ─── Title sheet setup ─────────────────────────────────────────────────────────
export function addTitleRow(ws: ExcelJS.Worksheet, title: string, subtitle: string, colCount: number) {
  // Merge title across all columns
  ws.mergeCells(1, 1, 1, colCount)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = title
  titleCell.style = {
    font: { name: FONT_NAME, bold: true, size: 14, color: { argb: argbOf(COLORS.headerText) } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(COLORS.headerBg) } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  }
  ws.getRow(1).height = 32

  ws.mergeCells(2, 1, 2, colCount)
  const subCell = ws.getCell(2, 1)
  subCell.value = subtitle
  subCell.style = {
    font: { name: FONT_NAME, size: 10, italic: true, color: { argb: argbOf('94A3B8') } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(COLORS.headerBg) } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  }
  ws.getRow(2).height = 18
}

// ─── Section header ────────────────────────────────────────────────────────────
export function addSectionHeader(ws: ExcelJS.Worksheet, rowNum: number, label: string, colCount: number) {
  ws.mergeCells(rowNum, 1, rowNum, colCount)
  const cell = ws.getCell(rowNum, 1)
  cell.value = label
  cell.style = {
    font: { name: FONT_NAME, bold: true, size: 10, color: { argb: argbOf(COLORS.sectionText) } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(COLORS.sectionBg) } },
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
  }
  ws.getRow(rowNum).height = 20
}

// ─── Main export builder ───────────────────────────────────────────────────────
export interface SheetColumn {
  header: string
  key: string
  width: number
  type?: 'money' | 'percent' | 'text' | 'number'
  align?: ExcelJS.Alignment['horizontal']
}

export interface SheetRow {
  [key: string]: number | string | boolean | null | undefined
  _isTotals?: boolean
  _isSection?: boolean
  _sectionLabel?: string
}

type AutoInsightMetric = {
  label: string
  value: string
  tone?: DashboardTone
}

type AutoChartConfig = {
  title: string
  points: DashboardChartPoint[]
  valueFormat: DashboardValueFormat
}

export type DashboardTone = 'neutral' | 'good' | 'warn' | 'danger'
export type DashboardValueFormat = 'money' | 'number' | 'percent'

export interface DashboardMetric {
  label: string
  value: string
  hint?: string
  tone?: DashboardTone
}

export interface DashboardChartPoint {
  label: string
  value: number
}

export interface DashboardChart {
  title: string
  subtitle?: string
  type: 'bar' | 'line'
  points: DashboardChartPoint[]
  tone?: DashboardTone
  valueFormat?: DashboardValueFormat
}

export interface DashboardSheetOptions {
  sheetName: string
  title: string
  subtitle: string
  metrics: DashboardMetric[]
  charts?: DashboardChart[]
  highlights?: string[]
}

type ExportSheetMeta = {
  kind: 'table' | 'dashboard'
  sheetName: string
  title: string
  subtitle: string
  rowCount?: number
  rawSheetName?: string
  columns?: SheetColumn[]
  rows?: SheetRow[]
}

const workbookMeta = new WeakMap<ExcelJS.Workbook, ExportSheetMeta[]>()
const finalizedWorkbooks = new WeakSet<ExcelJS.Workbook>()

function getWorkbookMeta(wb: ExcelJS.Workbook) {
  const existing = workbookMeta.get(wb)
  if (existing) return existing
  const next: ExportSheetMeta[] = []
  workbookMeta.set(wb, next)
  return next
}

function registerWorkbookSheet(wb: ExcelJS.Workbook, meta: ExportSheetMeta) {
  const items = getWorkbookMeta(wb)
  const index = items.findIndex((item) => item.sheetName === meta.sheetName)
  if (index >= 0) {
    items[index] = meta
    return
  }
  items.push(meta)
}

function safeSheetName(name: string, fallback: string) {
  const sanitized = name.replace(/[\\/*?:[\]]/g, ' ').trim() || fallback
  return sanitized.slice(0, 31)
}

function rawSheetNameFor(sheetName: string) {
  return safeSheetName(`${RAW_PREFIX}${sheetName}`, `${RAW_PREFIX}sheet`)
}

function styleHyperlinkCell(cell: ExcelJS.Cell, align: ExcelJS.Alignment['horizontal'] = 'right') {
  cell.font = {
    name: FONT_NAME,
    size: 10,
    bold: true,
    underline: true,
    color: { argb: argbOf(COLORS.accentBlue) },
  }
  cell.alignment = { horizontal: align, vertical: 'middle' }
}

function applyConditionalFormatting(
  ws: ExcelJS.Worksheet,
  columns: SheetColumn[],
  dataStartRow: number,
  dataEndRow: number,
) {
  if (dataEndRow < dataStartRow) return

  columns.forEach((column, index) => {
    const columnIndex = index + 1
    const ref = `${columnLetter(columnIndex)}${dataStartRow}:${columnLetter(columnIndex)}${dataEndRow}`

    if (column.type === 'money' || column.type === 'number') {
      ws.addConditionalFormatting({
        ref,
        rules: [
          {
            type: 'cellIs',
            operator: 'lessThan',
            formulae: ['0'],
            priority: 2,
            style: {
              font: { color: { argb: argbOf(COLORS.negative) }, bold: true },
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argbOf(COLORS.dangerBg) }, fgColor: { argb: argbOf(COLORS.dangerBg) } },
            },
          },
          {
            type: 'cellIs',
            operator: 'greaterThan',
            formulae: ['0'],
            priority: 1,
            style: {
              font: { color: { argb: argbOf(COLORS.positive) } },
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argbOf(COLORS.goodBg) }, fgColor: { argb: argbOf(COLORS.goodBg) } },
            },
          },
        ],
      })
      return
    }

    if (column.type === 'percent') {
      ws.addConditionalFormatting({
        ref,
        rules: [
          {
            type: 'cellIs',
            operator: 'greaterThan',
            formulae: ['0.79'],
            priority: 1,
            style: {
              font: { color: { argb: argbOf(COLORS.positive) }, bold: true },
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argbOf(COLORS.goodBg) }, fgColor: { argb: argbOf(COLORS.goodBg) } },
            },
          },
          {
            type: 'cellIs',
            operator: 'lessThan',
            formulae: ['0.3'],
            priority: 2,
            style: {
              font: { color: { argb: argbOf(COLORS.accentAmber) }, bold: true },
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argbOf(COLORS.warnBg) }, fgColor: { argb: argbOf(COLORS.warnBg) } },
            },
          },
        ],
      })
    }
  })
}

function buildRawSheet(wb: ExcelJS.Workbook, meta: ExportSheetMeta) {
  if (meta.kind !== 'table' || !meta.columns || !meta.rows) return
  if (wb.getWorksheet(meta.rawSheetName || '')) return

  const rawSheet = wb.addWorksheet(meta.rawSheetName || rawSheetNameFor(meta.sheetName), {
    properties: { tabColor: { argb: argbOf(COLORS.mutedText) } },
  })
  rawSheet.state = 'hidden'

  const rawColumns = [
    { header: 'row_type', key: '__rowType', width: 14 },
    { header: 'section_label', key: '__sectionLabel', width: 22 },
    ...meta.columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: Math.max(14, Math.min(column.width, 26)),
    })),
  ]

  rawSheet.columns = rawColumns
  rawSheet.getRow(1).font = { name: FONT_NAME, bold: true }
  rawSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(COLORS.neutralBg) } }

  meta.rows.forEach((row) => {
    const rowType = row._isSection ? 'section' : row._isTotals ? 'total' : 'data'
    rawSheet.addRow({
      __rowType: rowType,
      __sectionLabel: row._sectionLabel ?? '',
      ...meta.columns?.reduce<Record<string, number | string | boolean | null | undefined>>((acc, column) => {
        acc[column.key] = row[column.key]
        return acc
      }, {}),
    })
  })

  rawSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  rawSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: rawColumns.length },
  }
}

function populateContentsSheet(wb: ExcelJS.Workbook, items: ExportSheetMeta[]) {
  const ws = wb.getWorksheet(CONTENTS_SHEET_NAME) || wb.addWorksheet(CONTENTS_SHEET_NAME, {
    properties: { tabColor: { argb: argbOf(COLORS.sectionBg) } },
  })

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.value = null
      cell.style = {}
    })
  })

  ws.columns = [
    { width: 24 },
    { width: 30 },
    { width: 48 },
    { width: 14 },
    { width: 18 },
  ]

  addTitleRow(ws, 'Содержание книги', `Сгенерировано: ${new Date().toLocaleString('ru-RU')}`, 5)
  ws.getRow(3).height = 8

  const introCell = ws.getCell(4, 1)
  ws.mergeCells(4, 1, 4, 5)
  introCell.value = 'Быстрая навигация по отчёту, дашбордам и скрытым raw-data листам.'
  introCell.style = {
    font: { name: FONT_NAME, size: 10, color: { argb: argbOf(COLORS.mutedText) } },
    alignment: { horizontal: 'left', vertical: 'middle' },
  }

  const headerRow = ws.getRow(6)
  ;['Лист', 'Тип', 'Описание', 'Строк', 'Raw-data'].forEach((title, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = title
    cell.style = headerStyle(COLORS.subheaderBg, COLORS.subheaderText, 9)
  })
  headerRow.height = 24

  let rowIndex = 7
  items
    .filter((item) => item.sheetName !== CONTENTS_SHEET_NAME)
    .forEach((item, index) => {
      const row = ws.getRow(rowIndex)
      const baseStyle = dataStyle(index, false, 'left')

      row.getCell(1).value = { text: item.sheetName, hyperlink: `#'${item.sheetName}'!A1` }
      row.getCell(2).value = item.kind === 'dashboard' ? 'Дашборд' : 'Таблица'
      row.getCell(3).value = `${item.title}${item.subtitle ? ` | ${item.subtitle}` : ''}`
      row.getCell(4).value = item.rowCount ?? null
      row.getCell(5).value = item.rawSheetName ? `Скрыт: ${item.rawSheetName}` : '—'

      for (let cellIndex = 1; cellIndex <= 5; cellIndex += 1) {
        row.getCell(cellIndex).style = {
          ...baseStyle,
          alignment: { horizontal: cellIndex === 4 ? 'right' : 'left', vertical: 'middle', wrapText: true },
        }
      }
      styleHyperlinkCell(row.getCell(1), 'left')
      row.height = 22
      rowIndex += 1
    })

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 6 }]
  ws.autoFilter = {
    from: { row: 6, column: 1 },
    to: { row: 6, column: 5 },
  }
  ws.pageSetup.printTitlesRow = '6:6'
}

function finalizeWorkbook(wb: ExcelJS.Workbook) {
  if (finalizedWorkbooks.has(wb)) return

  const items = getWorkbookMeta(wb)
  items
    .filter((item) => item.kind === 'table')
    .forEach((item) => buildRawSheet(wb, item))

  populateContentsSheet(wb, items)
  finalizedWorkbooks.add(wb)
}

export function buildStyledSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  title: string,
  subtitle: string,
  columns: SheetColumn[],
  rows: SheetRow[],
) {
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    properties: { tabColor: { argb: argbOf(COLORS.headerBg) } },
  })

  const colCount = columns.length
  const dataRows = rows.filter((row) => !row._isSection && !row._isTotals)

  const autoMetrics: AutoInsightMetric[] = (() => {
    const metrics: AutoInsightMetric[] = [{ label: 'Строк', value: String(dataRows.length), tone: 'neutral' }]
    const numericColumns = columns.filter((column) => column.type === 'money' || column.type === 'number' || column.type === 'percent')

    for (const column of numericColumns.slice(0, 3)) {
      const values = dataRows
        .map((row) => row[column.key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

      if (values.length === 0) continue

      if (column.type === 'percent') {
        const avg = values.reduce((sum, value) => sum + value, 0) / values.length
        metrics.push({ label: `Среднее: ${column.header}`, value: `${avg.toFixed(1)}%`, tone: avg >= 0 ? 'neutral' : 'danger' })
        continue
      }

      const total = values.reduce((sum, value) => sum + value, 0)
      const tone: DashboardTone = total > 0 ? 'good' : total < 0 ? 'danger' : 'neutral'
      metrics.push({
        label: column.header,
        value: column.type === 'money' ? formatChartValue(total, 'money') : formatChartValue(total, 'number'),
        tone,
      })
    }

    return metrics.slice(0, Math.min(4, Math.max(1, colCount)))
  })()

  const autoChart: AutoChartConfig | null = (() => {
    const labelColumn = columns.find((column) => column.type === 'text') || columns[0]
    const metricColumn = columns.find((column) => column.type === 'money')
      || columns.find((column) => column.type === 'number')
      || columns.find((column) => column.type === 'percent')

    if (!labelColumn || !metricColumn) return null

    const points = dataRows
      .map((row) => {
        const labelValue = row[labelColumn.key]
        const metricValue = row[metricColumn.key]
        return {
          label: typeof labelValue === 'string' ? labelValue : String(labelValue ?? ''),
          value: typeof metricValue === 'number' ? metricValue : null,
        }
      })
      .filter((point): point is { label: string; value: number } => Boolean(point.label) && point.value !== null)

    if (points.length < 2) return null

    const shouldKeepOrder = /дата|date|day|день/i.test(labelColumn.header)
    const normalized = shouldKeepOrder
      ? points.slice(0, 8)
      : [...points].sort((left, right) => Math.abs(right.value) - Math.abs(left.value)).slice(0, 8)

    return {
      title: `${metricColumn.header} по ${labelColumn.header.toLowerCase()}`,
      points: normalized.map((point) => ({ label: point.label, value: point.value })),
      valueFormat: metricColumn.type === 'money' ? 'money' : metricColumn.type === 'percent' ? 'percent' : 'number',
    }
  })()

  // Title rows
  addTitleRow(ws, title, subtitle, colCount)

  ws.getRow(3).height = 6
  const tocCell = ws.getCell(3, colCount)
  tocCell.value = { text: 'Оглавление', hyperlink: `#'${CONTENTS_SHEET_NAME}'!A1` }
  styleHyperlinkCell(tocCell)

  if (autoMetrics.length > 0) {
    const cardsCount = Math.min(autoMetrics.length, Math.max(1, colCount))
    const baseSpan = Math.max(1, Math.floor(colCount / cardsCount))

    autoMetrics.forEach((metric, index) => {
      const startColumn = 1 + index * baseSpan
      const endColumn = index === cardsCount - 1 ? colCount : Math.min(colCount, startColumn + baseSpan - 1)
      ws.mergeCells(4, startColumn, 6, endColumn)
      const cell = ws.getCell(4, startColumn)
      styleDashboardCard(cell, { label: metric.label, value: metric.value, tone: metric.tone })
    })

    ws.getRow(4).height = 20
    ws.getRow(5).height = 20
    ws.getRow(6).height = 20
  }

  let headerRowNumber = autoMetrics.length > 0 ? 8 : 4

  if (autoChart && typeof document !== 'undefined') {
    ws.mergeCells(headerRowNumber, 1, headerRowNumber, colCount)
    const chartTitleCell = ws.getCell(headerRowNumber, 1)
    chartTitleCell.value = autoChart.title
    chartTitleCell.style = {
      font: { name: FONT_NAME, bold: true, size: 11, color: { argb: argbOf(COLORS.bodyText) } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(COLORS.neutralBg) } },
      alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
      border: {
        top: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
        bottom: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
        left: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
        right: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      },
    }

    const chartImageId = wb.addImage({
      base64: renderBarChartToPngDataUrl(autoChart),
      extension: 'png',
    })
    const chartEndColumn = Math.min(colCount, Math.max(4, colCount))
    ws.addImage(chartImageId, `A${headerRowNumber + 1}:${columnLetter(chartEndColumn)}${headerRowNumber + 6}`)
    headerRowNumber += 8
  }

  const headerRow = ws.getRow(headerRowNumber)
  headerRow.height = 28
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.style = headerStyle(COLORS.subheaderBg, COLORS.subheaderText, 9)
    cell.style.alignment = { horizontal: col.align || (col.type === 'money' || col.type === 'number' || col.type === 'percent' ? 'right' : 'left'), vertical: 'middle', wrapText: true }
  })

  // Set column widths
  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width
  })

  // Data rows
  let dataRowIdx = 0
  let currentDataStartRow: number | null = null
  const conditionalRanges: Array<{ start: number; end: number }> = []
  rows.forEach((row) => {
    const wsRowNum = headerRowNumber + 1 + dataRowIdx

    if (row._isSection) {
      if (currentDataStartRow !== null && wsRowNum - 1 >= currentDataStartRow) {
        conditionalRanges.push({ start: currentDataStartRow, end: wsRowNum - 1 })
      }
      currentDataStartRow = null
      addSectionHeader(ws, wsRowNum, row._sectionLabel || '', colCount)
      ws.getRow(wsRowNum).height = 20
      dataRowIdx++
      return
    }

    const wsRow = ws.getRow(wsRowNum)
    wsRow.height = 18
    const isTotals = row._isTotals === true
    if (!isTotals && currentDataStartRow === null) {
      currentDataStartRow = wsRowNum
    }

    columns.forEach((col, colIdx) => {
      const cell = wsRow.getCell(colIdx + 1)
      const rawVal = row[col.key]

      if (isTotals) {
        const s = totalsStyle()
        if (col.type === 'money' || col.type === 'number') {
          const hasFormulaWindow = currentDataStartRow !== null && wsRowNum - 1 >= currentDataStartRow
          if (typeof rawVal === 'number' && hasFormulaWindow) {
            const colLetter = columnLetter(colIdx + 1)
            cell.value = {
              formula: `SUM(${colLetter}${currentDataStartRow}:${colLetter}${wsRowNum - 1})`,
              result: rawVal,
            }
          } else {
            cell.value = typeof rawVal === 'number' ? rawVal : null
          }
          if (col.type === 'money') {
            cell.numFmt = '#,##0 ₸'
          } else {
            cell.numFmt = '#,##0'
          }
          if (typeof rawVal === 'number' && rawVal < 0) {
            s.font = { ...s.font, color: { argb: argbOf(COLORS.negative) } }
          }
        } else if (col.type === 'percent') {
          cell.value = typeof rawVal === 'number' ? rawVal / 100 : null
          cell.numFmt = '0.0%'
        } else {
          cell.value = rawVal ?? null
          s.alignment = { horizontal: 'left', vertical: 'middle' }
        }
        cell.style = s
      } else {
        const s = dataStyle(dataRowIdx, false, col.align || (col.type === 'money' || col.type === 'number' || col.type === 'percent' ? 'right' : 'left'))
        if (col.type === 'money') {
          cell.value = typeof rawVal === 'number' ? rawVal : null
          cell.numFmt = '#,##0 ₸'
          if (typeof rawVal === 'number' && rawVal < 0) {
            s.font = { ...s.font, color: { argb: argbOf(COLORS.negative) } }
          } else if (typeof rawVal === 'number' && rawVal > 0 && col.key.toLowerCase().includes('profit')) {
            s.font = { ...s.font, color: { argb: argbOf(COLORS.positive) } }
          }
        } else if (col.type === 'percent') {
          cell.value = typeof rawVal === 'number' ? rawVal / 100 : null
          cell.numFmt = '0.0%'
        } else if (col.type === 'number') {
          cell.value = typeof rawVal === 'number' ? rawVal : null
          cell.numFmt = '#,##0'
        } else {
          cell.value = rawVal ?? null
        }
        cell.style = s
      }
    })
    if (isTotals) {
      if (currentDataStartRow !== null && wsRowNum - 1 >= currentDataStartRow) {
        conditionalRanges.push({ start: currentDataStartRow, end: wsRowNum - 1 })
      }
      currentDataStartRow = null
    }
    dataRowIdx++
  })
  if (currentDataStartRow !== null) {
    conditionalRanges.push({ start: currentDataStartRow, end: headerRowNumber + dataRowIdx })
  }

  // Freeze panes (keep headers visible)
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRowNumber }]
  ws.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: colCount },
  }
  ws.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`
  ws.pageSetup.fitToHeight = 0
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
  ws.pageSetup.printArea = `A1:${columnLetter(colCount)}${headerRowNumber + dataRowIdx}`
  conditionalRanges.forEach((range) => applyConditionalFormatting(ws, columns, range.start, range.end))

  registerWorkbookSheet(wb, {
    kind: 'table',
    sheetName,
    title,
    subtitle,
    rowCount: rows.filter((row) => !row._isSection && !row._isTotals).length,
    rawSheetName: rawSheetNameFor(sheetName),
    columns,
    rows,
  })

  return ws
}

// ─── Download helper (browser) ─────────────────────────────────────────────────
export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  finalizeWorkbook(wb)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function createWorkbook(company = 'Orda Control'): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = company
  wb.lastModifiedBy = company
  wb.created = new Date()
  wb.modified = new Date()
  wb.addWorksheet(CONTENTS_SHEET_NAME, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    properties: { tabColor: { argb: argbOf(COLORS.sectionBg) } },
  })
  registerWorkbookSheet(wb, {
    kind: 'dashboard',
    sheetName: CONTENTS_SHEET_NAME,
    title: 'Содержание книги',
    subtitle: '',
  })
  return wb
}

function generateHorizontalBarChartSvg(chart: DashboardChart, width: number, height: number) {
  const palette = paletteForTone(chart.tone)
  const points = chart.points.slice(0, 6)

  if (points.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#FFFFFF" rx="20"/>
      <text x="50%" y="50%" text-anchor="middle" font-family="${FONT_NAME}" font-size="22" fill="#64748B">Нет данных для диаграммы</text>
    </svg>`
  }

  const top = 26
  const left = 170
  const right = 110
  const rowHeight = (height - top - 24) / points.length
  const maxValue = Math.max(...points.map((point) => Math.abs(point.value)), 1)
  const chartWidth = width - left - right

  const bars = points.map((point, index) => {
    const y = top + index * rowHeight
    const barHeight = Math.max(14, rowHeight * 0.46)
    const barY = y + rowHeight / 2 - barHeight / 2
    const barWidth = Math.max(6, (Math.abs(point.value) / maxValue) * chartWidth)
    const fill = point.value >= 0 ? palette.accent : COLORS.accentRed

    return `
      <text x="${left - 12}" y="${barY + barHeight / 2 + 5}" text-anchor="end" font-family="${FONT_NAME}" font-size="15" fill="#0F172A">${escapeXml(truncateLabel(point.label, 22))}</text>
      <rect x="${left}" y="${barY}" width="${chartWidth}" height="${barHeight}" rx="9" fill="#E2E8F0"/>
      <rect x="${left}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="9" fill="#${fill}"/>
      <text x="${left + chartWidth + 12}" y="${barY + barHeight / 2 + 5}" font-family="${FONT_NAME}" font-size="14" fill="#334155">${escapeXml(formatChartValue(point.value, chart.valueFormat))}</text>
    `
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#FFFFFF" rx="20"/>
    ${bars}
  </svg>`
}

function generateLineChartSvg(chart: DashboardChart, width: number, height: number) {
  const palette = paletteForTone(chart.tone)
  const points = chart.points

  if (points.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#FFFFFF" rx="20"/>
      <text x="50%" y="50%" text-anchor="middle" font-family="${FONT_NAME}" font-size="22" fill="#64748B">Нет данных для диаграммы</text>
    </svg>`
  }

  const top = 22
  const right = 26
  const bottom = 42
  const left = 64
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const minValue = Math.min(...points.map((point) => point.value), 0)
  const maxValue = Math.max(...points.map((point) => point.value), 0)
  const valueRange = Math.max(1, maxValue - minValue)
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0
  const labelEvery = points.length > 10 ? Math.ceil(points.length / 6) : 1

  const coordinates = points.map((point, index) => {
    const x = left + stepX * index
    const y = top + (maxValue - point.value) / valueRange * plotHeight
    return { x, y, point }
  })

  const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
  const areaPath = `${linePath} L${coordinates[coordinates.length - 1]?.x ?? left},${top + plotHeight} L${coordinates[0]?.x ?? left},${top + plotHeight} Z`
  const zeroY = top + (maxValue - 0) / valueRange * plotHeight
  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const y = top + (plotHeight / 3) * index
    return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="#${COLORS.chartGrid}" stroke-width="1"/>`
  }).join('')

  const labels = coordinates.map((point, index) => {
    if (index % labelEvery !== 0 && index !== points.length - 1) return ''
    return `<text x="${point.x}" y="${height - 14}" text-anchor="middle" font-family="${FONT_NAME}" font-size="12" fill="#64748B">${escapeXml(truncateLabel(point.point.label, 12))}</text>`
  }).join('')

  const dots = coordinates.map((point) => {
    const fill = point.point.value >= 0 ? palette.accent : COLORS.accentRed
    return `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#${fill}" stroke="#FFFFFF" stroke-width="2"/>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#FFFFFF" rx="20"/>
    ${gridLines}
    <line x1="${left}" y1="${zeroY}" x2="${left + plotWidth}" y2="${zeroY}" stroke="#CBD5E1" stroke-width="1.5" stroke-dasharray="6 6"/>
    <path d="${areaPath}" fill="#${palette.bg}" opacity="0.9"/>
    <path d="${linePath}" fill="none" stroke="#${palette.accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    <text x="${left}" y="${top - 6}" font-family="${FONT_NAME}" font-size="12" fill="#64748B">${escapeXml(formatChartValue(maxValue, chart.valueFormat))}</text>
    <text x="${left}" y="${top + plotHeight + 18}" font-family="${FONT_NAME}" font-size="12" fill="#64748B">${escapeXml(formatChartValue(minValue, chart.valueFormat))}</text>
    ${labels}
  </svg>`
}

async function svgToPngDataUrl(svg: string, width: number, height: number) {
  if (typeof document === 'undefined') {
    throw new Error('PNG conversion is only available in the browser')
  }

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = () => reject(new Error('Failed to render chart SVG'))
      nextImage.src = url
    })

    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')

    ctx.scale(scale, scale)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)

    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function styleDashboardCard(cell: ExcelJS.Cell, metric: DashboardMetric) {
  const palette = paletteForTone(metric.tone)
  cell.value = [metric.label, metric.value, metric.hint].filter(Boolean).join('\n')
  cell.style = {
    font: { name: FONT_NAME, bold: true, size: 12, color: { argb: argbOf(COLORS.bodyText) } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(palette.bg) } },
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
    border: {
      top: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      bottom: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      left: { style: 'medium', color: { argb: argbOf(palette.accent) } },
      right: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
    },
  }
}

function renderBarChartToPngDataUrl(chart: AutoChartConfig) {
  const canvas = document.createElement('canvas')
  const width = 980
  const height = 280
  canvas.width = width * 2
  canvas.height = height * 2

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas is not available')
  }

  ctx.scale(2, 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const left = 190
  const right = 110
  const top = 24
  const rowHeight = (height - top - 26) / chart.points.length
  const barHeight = Math.max(14, rowHeight * 0.46)
  const chartWidth = width - left - right
  const maxValue = Math.max(...chart.points.map((point) => Math.abs(point.value)), 1)

  ctx.font = `14px ${FONT_NAME}`
  ctx.textBaseline = 'middle'

  chart.points.forEach((point, index) => {
    const y = top + index * rowHeight
    const barY = y + rowHeight / 2 - barHeight / 2
    const barWidth = Math.max(8, (Math.abs(point.value) / maxValue) * chartWidth)

    ctx.fillStyle = '#E2E8F0'
    ctx.beginPath()
    ctx.roundRect(left, barY, chartWidth, barHeight, 9)
    ctx.fill()

    ctx.fillStyle = point.value >= 0 ? `#${COLORS.accentBlue}` : `#${COLORS.accentRed}`
    ctx.beginPath()
    ctx.roundRect(left, barY, barWidth, barHeight, 9)
    ctx.fill()

    ctx.fillStyle = '#0F172A'
    ctx.textAlign = 'right'
    ctx.fillText(truncateLabel(point.label, 24), left - 12, barY + barHeight / 2)

    ctx.fillStyle = '#334155'
    ctx.textAlign = 'left'
    ctx.fillText(formatChartValue(point.value, chart.valueFormat), left + chartWidth + 12, barY + barHeight / 2)
  })

  return canvas.toDataURL('image/png')
}

export async function buildDashboardSheet(wb: ExcelJS.Workbook, options: DashboardSheetOptions) {
  const ws = wb.addWorksheet(options.sheetName, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    properties: { tabColor: { argb: argbOf(COLORS.headerBg) } },
  })

  const columnCount = 12
  for (let index = 1; index <= columnCount; index += 1) {
    ws.getColumn(index).width = 14
  }

  addTitleRow(ws, options.title, options.subtitle, columnCount)
  ws.getRow(3).height = 8
  const tocCell = ws.getCell(3, columnCount)
  tocCell.value = { text: 'Оглавление', hyperlink: `#'${CONTENTS_SHEET_NAME}'!A1` }
  styleHyperlinkCell(tocCell)

  const cardsPerRow = 4
  const cardSpan = 3
  let currentRow = 4

  options.metrics.forEach((metric, index) => {
    const cardRow = currentRow + Math.floor(index / cardsPerRow) * 4
    const cardColumn = 1 + (index % cardsPerRow) * cardSpan
    const cardEndColumn = cardColumn + cardSpan - 1
    ws.mergeCells(cardRow, cardColumn, cardRow + 2, cardEndColumn)
    const cell = ws.getCell(cardRow, cardColumn)
    styleDashboardCard(cell, metric)
    ws.getRow(cardRow).height = 22
    ws.getRow(cardRow + 1).height = 22
    ws.getRow(cardRow + 2).height = 22
  })

  const metricRows = Math.max(1, Math.ceil(options.metrics.length / cardsPerRow))
  currentRow += metricRows * 4

  const charts = options.charts || []
  const chartWidth = 760
  const chartHeight = 320

  for (let index = 0; index < charts.length; index += 1) {
    const chart = charts[index]
    const rowGroup = Math.floor(index / 2)
    const fullWidth = charts.length % 2 === 1 && index === charts.length - 1 && charts.length > 1
    const startColumn = fullWidth ? 1 : index % 2 === 0 ? 1 : 7
    const endColumn = fullWidth ? 12 : index % 2 === 0 ? 6 : 12
    const titleRow = currentRow + rowGroup * 15
    const imageTopRow = titleRow + 1
    const imageBottomRow = imageTopRow + 10

    ws.mergeCells(titleRow, startColumn, titleRow, endColumn)
    const titleCell = ws.getCell(titleRow, startColumn)
    titleCell.value = chart.subtitle ? `${chart.title}\n${chart.subtitle}` : chart.title
    titleCell.style = {
      font: { name: FONT_NAME, bold: true, size: 11, color: { argb: argbOf(COLORS.bodyText) } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(COLORS.neutralBg) } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
      border: {
        top: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
        bottom: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
        left: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
        right: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
      },
    }
    ws.getRow(titleRow).height = chart.subtitle ? 28 : 22

    const svg = chart.type === 'line'
      ? generateLineChartSvg(chart, chartWidth, chartHeight)
      : generateHorizontalBarChartSvg(chart, chartWidth, chartHeight)

    const imageId = wb.addImage({
      base64: await svgToPngDataUrl(svg, chartWidth, chartHeight),
      extension: 'png',
    })

    ws.addImage(imageId, `${columnLetter(startColumn)}${imageTopRow}:${columnLetter(endColumn)}${imageBottomRow}`)
  }

  currentRow += Math.max(0, Math.ceil(charts.length / 2) * 15)

  if (options.highlights?.length) {
    addSectionHeader(ws, currentRow, 'Ключевые выводы', columnCount)
    currentRow += 1

    options.highlights.forEach((highlight) => {
      ws.mergeCells(currentRow, 1, currentRow, columnCount)
      const cell = ws.getCell(currentRow, 1)
      cell.value = `• ${highlight}`
      cell.style = {
        font: { name: FONT_NAME, size: 10, color: { argb: argbOf(COLORS.bodyText) } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(COLORS.panelBg) } },
        alignment: { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 },
        border: {
          bottom: { style: 'thin', color: { argb: argbOf(COLORS.border) } },
        },
      }
      ws.getRow(currentRow).height = 20
      currentRow += 1
    })
  }

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }]
  ws.pageSetup.fitToHeight = 0
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
  ws.pageSetup.printArea = `A1:${columnLetter(columnCount)}${Math.max(currentRow, 20)}`
  registerWorkbookSheet(wb, {
    kind: 'dashboard',
    sheetName: options.sheetName,
    title: options.title,
    subtitle: options.subtitle,
  })
  return ws
}
