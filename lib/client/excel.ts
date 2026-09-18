'use client'

/**
 * Excel в браузере через exceljs.
 *
 * Раньше здесь была библиотека `xlsx` (SheetJS) — у неё открытые уязвимости
 * (prototype pollution и ReDoS при разборе файла), которые автор не чинит, а
 * разбор чужого прайса от поставщика — как раз тот случай, когда файл
 * недоверенный. `exceljs` в проекте уже был (серверные выгрузки), поэтому
 * оставили одну библиотеку на всё.
 *
 * Ограничение: exceljs не читает старый формат .xls (Excel 97-2003). Такой
 * файл просим пересохранить как .xlsx — сообщение об этом ниже.
 */

export type ExcelCell = string | number

/** Выгрузить таблицу в .xlsx и отдать файл браузеру */
export async function downloadXlsx(params: {
  fileName: string
  sheetName: string
  /** Строки над шапкой (заголовок документа), необязательно */
  titleRows?: ExcelCell[][]
  headers: string[]
  rows: ExcelCell[][]
  /** Ширины колонок в символах, по порядку */
  columnWidths?: number[]
}): Promise<void> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(params.sheetName)

  for (const row of params.titleRows || []) sheet.addRow(row)
  const headerRow = sheet.addRow(params.headers)
  headerRow.font = { bold: true }
  for (const row of params.rows) sheet.addRow(row)

  if (params.columnWidths?.length) {
    params.columnWidths.forEach((width, idx) => {
      sheet.getColumn(idx + 1).width = width
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = params.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** Текст ошибки для старого формата .xls */
export const XLS_LEGACY_MESSAGE = 'Старый формат .xls не читается. Откройте файл в Excel и сохраните как .xlsx.'

/**
 * Прочитать первый лист файла как таблицу строк.
 * Поддержка: .xlsx и .csv. Для .xls бросает понятную ошибку.
 */
export async function readSheetRows(file: File): Promise<ExcelCell[][]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'xls') throw new Error(XLS_LEGACY_MESSAGE)

  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const buffer = await file.arrayBuffer()

  if (ext === 'csv') {
    // csv читаем сами: Workbook.csv.read в браузере тянет поток Node
    const text = new TextDecoder('utf-8').decode(buffer)
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.split(/;|,|\t/).map((cell) => cell.trim().replace(/^"|"$/g, '')))
  }

  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

  const rows: ExcelCell[][] = []
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : []
    rows.push(
      values.map((value) => {
        if (value == null) return ''
        if (typeof value === 'number' || typeof value === 'string') return value
        // Формулы и богатый текст приходят объектами
        const rich = value as { result?: unknown; text?: unknown; richText?: Array<{ text?: string }> }
        if (rich.richText) return rich.richText.map((part) => part.text || '').join('')
        if (rich.result != null) return String(rich.result)
        if (rich.text != null) return String(rich.text)
        return String(value)
      }),
    )
  })
  return rows
}
