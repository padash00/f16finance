/**
 * Styled Excel export utility using ExcelJS.
 * Creates professional-looking reports with colors, borders, and formatting.
 */
import ExcelJS from 'exceljs'

// ─── Color palette ─────────────────────────────────────────────────────────────
const COLORS = {
  headerBg: '0F172A',      // dark navy header
  headerText: 'FFFFFF',
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
}

const FONT_NAME = 'Arial'

// ─── Helpers ───────────────────────────────────────────────────────────────────
function argbOf(hex: string) { return `FF${hex.toUpperCase()}` }

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

function moneyFmt(v: number, colStyle?: Partial<ExcelJS.Style>): Partial<ExcelJS.CellValue> & { style?: Partial<ExcelJS.Style> } {
  const isNeg = v < 0
  return {
    value: v,
    style: {
      ...colStyle,
      numFmt: '#,##0 ₸',
      font: {
        ...colStyle?.font,
        name: FONT_NAME,
        color: { argb: isNeg ? argbOf(COLORS.negative) : undefined },
      },
    } as any,
  } as any
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
  [key: string]: number | string | null | undefined
  _isTotals?: boolean
  _isSection?: boolean
  _sectionLabel?: string
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

  // Title rows
  addTitleRow(ws, title, subtitle, colCount)

  // Column headers row (row 4, row 3 = empty gap)
  ws.getRow(3).height = 6
  const headerRow = ws.getRow(4)
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
  rows.forEach((row) => {
    const wsRowNum = 5 + dataRowIdx

    if (row._isSection) {
      addSectionHeader(ws, wsRowNum, row._sectionLabel || '', colCount)
      ws.getRow(wsRowNum).height = 20
      dataRowIdx++
      return
    }

    const wsRow = ws.getRow(wsRowNum)
    wsRow.height = 18
    const isTotals = row._isTotals === true

    columns.forEach((col, colIdx) => {
      const cell = wsRow.getCell(colIdx + 1)
      const rawVal = row[col.key]

      if (isTotals) {
        const s = totalsStyle()
        if (col.type === 'money') {
          cell.value = typeof rawVal === 'number' ? rawVal : null
          cell.numFmt = '#,##0 ₸'
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
    dataRowIdx++
  })

  // Freeze panes (keep headers visible)
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }]

  return ws
}

// ─── Download helper (browser) ─────────────────────────────────────────────────
export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
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
  return wb
}
