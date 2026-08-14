import ExcelJS from 'exceljs'

/**
 * Отчёт по эффективности операторов.
 *
 * Первый лист — «Итог»: он отвечает словами, кто как отработал, без чтения
 * таблиц. Владельцу нужен вывод, а не массив чисел; цифры лежат дальше для
 * тех, кто хочет проверить.
 *
 * Ячейки с выполнением нормы залиты цветом: зелёный — сделал больше нормы,
 * жёлтый — рядом, красный — просел. По такому листу видно за секунду, а не
 * за пять минут сравнения столбцов.
 */
function weekday(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1).getDay()
}

const SHIFT_LABEL: Record<string, string> = { day: 'День', night: 'Ночь' }
const WEEKDAY_LABEL = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

const FILL_GOOD = 'FFD9F2E3'
const FILL_WARN = 'FFFDF0D5'
const FILL_BAD = 'FFFBE0DE'
const FILL_HEAD = 'FF10312A'

function isWeekend(iso: string): boolean {
  const day = weekday(iso)
  return day === 0 || day === 6
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/** Словесная оценка: цифра 88% ничего не говорит, «просел» — говорит. */
function verdict(percent: number): string {
  if (percent >= 110) return 'Отлично'
  if (percent >= 100) return 'Норма выполнена'
  if (percent >= 95) return 'Чуть ниже нормы'
  if (percent >= 85) return 'Просел'
  return 'Сильно просел'
}

function fillFor(percent: number): string {
  if (percent >= 100) return FILL_GOOD
  if (percent >= 95) return FILL_WARN
  return FILL_BAD
}

const EXCEL_MONEY_FMT = '# ##0 " ₸"'

type FlatShift = {
  date: string
  shift: string
  company_id: string
  actual: number
  expected: number
  pi: number
  source: string
  operator: string
}

export type ReportOperator = {
  operator_name: string
  operator_short_name: string | null
  shifts: number
  total_revenue: number
  avg_revenue_per_shift: number
  pi: number
  qualifying: boolean
  expected_total: number
  shift_details: Array<{
    date: string
    shift: string
    company_id: string
    actual: number
    expected: number
    pi: number
    source: string
  }>
}

export async function buildPerformanceReport(params: {
  rows: ReportOperator[]
  bonusPct: number
  companies: Record<string, string>
  period: { from: string; to: string }
}): Promise<Buffer> {
  const { rows, bonusPct, period } = params
  const companyName = (id: string) => params.companies[id] || '—'

  const details: FlatShift[] = rows
    .flatMap((operator) =>
      operator.shift_details.map((shift) => ({
        ...shift,
        operator: operator.operator_short_name || operator.operator_name,
      })),
    )
    .sort((left, right) => left.date.localeCompare(right.date) || left.shift.localeCompare(right.shift))

  const book = new ExcelJS.Workbook()
  book.creator = 'Orda'
  book.created = new Date()

  /** Шапка таблицы: тёмная плашка, белый текст, закреплённая строка. */
  const styleHeader = (sheet: any) => {
    const header = sheet.getRow(1)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEAD } }
    header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    header.height = 28
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
  }

  const paintPercent = (sheet: any, columnKey: string) => {
    const hasColumn = (sheet.columns || []).some((column: any) => column?.key === columnKey)
    if (!hasColumn) return
    sheet.eachRow((row: any, index: number) => {
      if (index === 1) return
      const cell = row.getCell(columnKey)
      const value = Number(cell.value)
      if (!Number.isFinite(value) || value === 0) return
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillFor(value) } }
      cell.numFmt = '0"%"'
      cell.font = { bold: true }
    })
  }

  const paintMoney = (sheet: any, keys: string[]) => {
    // Колонки бонуса может не быть: при выключенном проценте её не добавляют,
    // а getCell по несуществующему ключу exceljs принимает за букву столбца и
    // падает — из-за этого весь отчёт отдавал 500.
    const existing = new Set(
      (sheet.columns || []).map((column: any) => column?.key).filter(Boolean),
    )
    sheet.eachRow((row: any, index: number) => {
      if (index === 1) return
      for (const key of keys) {
        if (!existing.has(key)) continue
        const cell = row.getCell(key)
        if (typeof cell.value === 'number') cell.numFmt = EXCEL_MONEY_FMT
      }
    })
  }

  // ── Общие цифры периода ─────────────────────────────────────────────────
  const totalActual = details.reduce((sum, shift) => sum + shift.actual, 0)
  const totalExpected = details.reduce((sum, shift) => sum + shift.expected, 0)
  const totalPercent = totalExpected > 0 ? Math.round((totalActual / totalExpected) * 100) : 0

  const operatorStats = rows
    .map((operator) => {
      const expected = operator.expected_total
      const actuals = operator.shift_details.map((shift) => shift.actual)
      const workShifts = operator.shift_details.filter((shift) => !isWeekend(shift.date))
      const weekendShifts = operator.shift_details.filter((shift) => isWeekend(shift.date))
      const percent = expected > 0 ? Math.round((operator.total_revenue / expected) * 100) : 0
      return {
        name: operator.operator_short_name || operator.operator_name,
        shifts: operator.shifts,
        expected: Math.round(expected),
        actual: Math.round(operator.total_revenue),
        diff: Math.round(operator.total_revenue - expected),
        percent,
        avg: Math.round(operator.avg_revenue_per_shift),
        min: actuals.length ? Math.round(Math.min(...actuals)) : 0,
        max: actuals.length ? Math.round(Math.max(...actuals)) : 0,
        med: median(actuals),
        workAvg: average(workShifts.map((shift) => shift.actual)),
        weekendAvg: average(weekendShifts.map((shift) => shift.actual)),
        points: Array.from(new Set(operator.shift_details.map((shift) => companyName(shift.company_id)))),
        qualifying: operator.qualifying,
        pi: operator.pi,
      }
    })
    .sort((left, right) => right.percent - left.percent)

  // Худший день недели по сети: считаем по всем сменам сразу.
  const weekdayTotals = new Map<number, { actual: number; expected: number; shifts: number }>()
  for (const shift of details) {
    const day = weekday(shift.date)
    const entry = weekdayTotals.get(day) || { actual: 0, expected: 0, shifts: 0 }
    entry.actual += shift.actual
    entry.expected += shift.expected
    entry.shifts += 1
    weekdayTotals.set(day, entry)
  }
  const weekdayRanked = Array.from(weekdayTotals.entries())
    .map(([day, entry]) => ({
      day,
      percent: entry.expected > 0 ? Math.round((entry.actual / entry.expected) * 100) : 0,
      shifts: entry.shifts,
    }))
    .sort((left, right) => right.percent - left.percent)

  // ── Лист 1: Итог словами ────────────────────────────────────────────────
  const summary = book.addWorksheet('Итог')
  summary.columns = [{ width: 34 }, { width: 20 }, { width: 20 }, { width: 16 }, { width: 46 }]

  const title = summary.addRow([`Эффективность операторов за ${period.from} — ${period.to}`])
  title.font = { bold: true, size: 14 }
  summary.mergeCells('A1:E1')
  summary.addRow([])

  const totalRow = summary.addRow([
    'Всего по периоду',
    `Смен: ${details.length}`,
    `Ожидалось: ${totalExpected.toLocaleString('ru-RU')} ₸`,
    `Сделано: ${totalActual.toLocaleString('ru-RU')} ₸`,
    `${verdict(totalPercent)} — ${totalPercent}% нормы (${totalActual >= totalExpected ? '+' : ''}${(totalActual - totalExpected).toLocaleString('ru-RU')} ₸)`,
  ])
  totalRow.font = { bold: true }
  totalRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillFor(totalPercent) } }
  summary.addRow([])

  const bestDay = weekdayRanked[0]
  const worstDay = weekdayRanked[weekdayRanked.length - 1]
  if (bestDay && worstDay) {
    summary.addRow(['Лучший день недели', WEEKDAY_LABEL[bestDay.day], `${bestDay.percent}% нормы`, `смен: ${bestDay.shifts}`])
    summary.addRow(['Слабый день недели', WEEKDAY_LABEL[worstDay.day], `${worstDay.percent}% нормы`, `смен: ${worstDay.shifts}`])
    summary.addRow([])
  }

  const peopleTitle = summary.addRow(['Кто как отработал'])
  peopleTitle.font = { bold: true, size: 12 }
  const peopleHead = summary.addRow(['Оператор', 'Смен', 'Выполнение', 'Отклонение', 'Что это значит'])
  peopleHead.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  peopleHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEAD } }

  for (const person of operatorStats) {
    const weekendHint =
      person.workAvg > 0 && person.weekendAvg > 0
        ? person.weekendAvg > person.workAvg * 1.1
          ? ' Сильнее в выходные.'
          : person.workAvg > person.weekendAvg * 1.1
            ? ' Сильнее в будни.'
            : ''
        : ''
    const row = summary.addRow([
      person.name + (person.qualifying ? '' : ' (мало смен)'),
      person.shifts,
      person.percent,
      person.diff,
      `${verdict(person.percent)}.${weekendHint} Средняя смена ${person.avg.toLocaleString('ru-RU')} ₸, разброс ${person.min.toLocaleString('ru-RU')}–${person.max.toLocaleString('ru-RU')} ₸.`,
    ])
    row.getCell(3).numFmt = '0"%"'
    row.getCell(3).font = { bold: true }
    row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillFor(person.percent) } }
    row.getCell(4).numFmt = EXCEL_MONEY_FMT
  }

  // ── Лист 2: операторы в цифрах ──────────────────────────────────────────
  const people = book.addWorksheet('Операторы')
  people.columns = [
    { header: 'Оператор', key: 'name', width: 20 },
    { header: 'Смен', key: 'shifts', width: 8 },
    { header: 'Точки', key: 'points', width: 24 },
    { header: 'Ожидалось', key: 'expected', width: 15 },
    { header: 'Сделал', key: 'actual', width: 15 },
    { header: 'Отклонение', key: 'diff', width: 15 },
    { header: 'Выполнение', key: 'percent', width: 13 },
    { header: 'Оценка', key: 'verdict', width: 18 },
    { header: 'Средняя смена', key: 'avg', width: 15 },
    { header: 'Мин. смена', key: 'min', width: 14 },
    { header: 'Макс. смена', key: 'max', width: 14 },
    { header: 'Медиана', key: 'med', width: 14 },
    { header: 'Будни, средняя', key: 'workAvg', width: 16 },
    { header: 'Выходные, средняя', key: 'weekendAvg', width: 18 },
    ...(bonusPct > 0 ? [{ header: `Бонус ${bonusPct}%`, key: 'bonus', width: 14 }] : []),
  ]
  for (const person of operatorStats) {
    people.addRow({
      name: person.name,
      shifts: person.shifts,
      points: person.points.join(' · '),
      expected: person.expected,
      actual: person.actual,
      diff: person.diff,
      percent: person.percent,
      verdict: verdict(person.percent),
      avg: person.avg,
      min: person.min,
      max: person.max,
      med: person.med,
      workAvg: person.workAvg,
      weekendAvg: person.weekendAvg,
      ...(bonusPct > 0 ? { bonus: Math.round(Math.max(0, person.diff) * bonusPct / 100) } : {}),
    })
  }
  styleHeader(people)
  paintPercent(people, 'percent')
  paintMoney(people, ['expected', 'actual', 'diff', 'avg', 'min', 'max', 'med', 'workAvg', 'weekendAvg', 'bonus'])

  // ── Лист 3: дни недели ──────────────────────────────────────────────────
  const weekdaySheet = book.addWorksheet('Дни недели')
  weekdaySheet.columns = [
    { header: 'Точка', key: 'point', width: 18 },
    { header: 'День', key: 'day', width: 10 },
    { header: 'Тип дня', key: 'kind', width: 12 },
    { header: 'Смен', key: 'shifts', width: 8 },
    { header: 'Ожидалось', key: 'expected', width: 15 },
    { header: 'Сделано', key: 'actual', width: 15 },
    { header: 'Выполнение', key: 'percent', width: 13 },
    { header: 'Средняя смена', key: 'avg', width: 15 },
    { header: 'Мин.', key: 'min', width: 13 },
    { header: 'Макс.', key: 'max', width: 13 },
  ]
  const byWeekday = new Map<string, { actual: number[]; expected: number }>()
  for (const shift of details) {
    const key = `${shift.company_id}|${weekday(shift.date)}`
    const entry = byWeekday.get(key) || { actual: [], expected: 0 }
    entry.actual.push(shift.actual)
    entry.expected += shift.expected
    byWeekday.set(key, entry)
  }
  const weekdayList = Array.from(byWeekday.entries())
    .map(([key, entry]) => {
      const [companyId, dayRaw] = key.split('|')
      const day = Number(dayRaw)
      const total = entry.actual.reduce((sum, value) => sum + value, 0)
      return {
        point: companyName(companyId),
        day,
        kind: day === 0 || day === 6 ? 'Выходной' : 'Будни',
        shifts: entry.actual.length,
        expected: Math.round(entry.expected),
        actual: Math.round(total),
        percent: entry.expected > 0 ? Math.round((total / entry.expected) * 100) : 0,
        avg: average(entry.actual),
        min: Math.round(Math.min(...entry.actual)),
        max: Math.round(Math.max(...entry.actual)),
      }
    })
    .sort(
      (left, right) =>
        left.point.localeCompare(right.point) || WEEKDAY_ORDER.indexOf(left.day) - WEEKDAY_ORDER.indexOf(right.day),
    )
  for (const item of weekdayList) weekdaySheet.addRow({ ...item, day: WEEKDAY_LABEL[item.day] })
  styleHeader(weekdaySheet)
  paintPercent(weekdaySheet, 'percent')
  paintMoney(weekdaySheet, ['expected', 'actual', 'avg', 'min', 'max'])

  // ── Лист 4: календарь по дням ───────────────────────────────────────────
  const daySheet = book.addWorksheet('По дням')
  daySheet.columns = [
    { header: 'Дата', key: 'date', width: 13 },
    { header: 'День', key: 'weekday', width: 9 },
    { header: 'Тип дня', key: 'kind', width: 11 },
    { header: 'Смен', key: 'shifts', width: 8 },
    { header: 'Кто работал', key: 'who', width: 28 },
    { header: 'Ожидалось', key: 'expected', width: 15 },
    { header: 'Касса за день', key: 'actual', width: 16 },
    { header: 'Выполнение', key: 'percent', width: 13 },
  ]
  const byDate = new Map<string, { actual: number; expected: number; shifts: number; who: Set<string> }>()
  for (const shift of details) {
    const entry = byDate.get(shift.date) || { actual: 0, expected: 0, shifts: 0, who: new Set<string>() }
    entry.actual += shift.actual
    entry.expected += shift.expected
    entry.shifts += 1
    entry.who.add(shift.operator)
    byDate.set(shift.date, entry)
  }
  for (const [date, entry] of Array.from(byDate.entries()).sort((l, r) => l[0].localeCompare(r[0]))) {
    daySheet.addRow({
      date,
      weekday: WEEKDAY_LABEL[weekday(date)],
      kind: isWeekend(date) ? 'Выходной' : 'Будни',
      shifts: entry.shifts,
      who: Array.from(entry.who).join(' · '),
      expected: Math.round(entry.expected),
      actual: Math.round(entry.actual),
      percent: entry.expected > 0 ? Math.round((entry.actual / entry.expected) * 100) : 0,
    })
  }
  styleHeader(daySheet)
  paintPercent(daySheet, 'percent')
  paintMoney(daySheet, ['expected', 'actual'])

  // ── Лист 5: смены ───────────────────────────────────────────────────────
  const shiftSheet = book.addWorksheet('Смены')
  shiftSheet.columns = [
    { header: 'Дата', key: 'date', width: 13 },
    { header: 'День', key: 'weekday', width: 9 },
    { header: 'Тип дня', key: 'kind', width: 11 },
    { header: 'Точка', key: 'point', width: 18 },
    { header: 'Смена', key: 'shift', width: 10 },
    { header: 'Оператор', key: 'operator', width: 18 },
    { header: 'Ожидалось', key: 'expected', width: 15 },
    { header: 'Сделал', key: 'actual', width: 15 },
    { header: 'Отклонение', key: 'diff', width: 15 },
    { header: 'Выполнение', key: 'percent', width: 13 },
    { header: 'Оценка', key: 'verdict', width: 18 },
  ]
  for (const shift of details) {
    const percent = shift.expected > 0 ? Math.round((shift.actual / shift.expected) * 100) : 0
    shiftSheet.addRow({
      date: shift.date,
      weekday: WEEKDAY_LABEL[weekday(shift.date)],
      kind: isWeekend(shift.date) ? 'Выходной' : 'Будни',
      point: companyName(shift.company_id),
      shift: SHIFT_LABEL[shift.shift] || shift.shift,
      operator: shift.operator,
      expected: Math.round(shift.expected),
      actual: Math.round(shift.actual),
      diff: Math.round(shift.actual - shift.expected),
      percent,
      verdict: verdict(percent),
    })
  }
  styleHeader(shiftSheet)
  paintPercent(shiftSheet, 'percent')
  paintMoney(shiftSheet, ['expected', 'actual', 'diff'])

  // ── Лист 6: точки ───────────────────────────────────────────────────────
  const pointSheet = book.addWorksheet('Точки')
  pointSheet.columns = [
    { header: 'Точка', key: 'point', width: 18 },
    { header: 'Смен', key: 'shifts', width: 8 },
    { header: 'Дневных', key: 'day', width: 10 },
    { header: 'Ночных', key: 'night', width: 10 },
    { header: 'Ожидалось', key: 'expected', width: 15 },
    { header: 'Сделано', key: 'actual', width: 15 },
    { header: 'Выполнение', key: 'percent', width: 13 },
    { header: 'Средняя смена', key: 'avg', width: 15 },
    { header: 'Будни, средняя', key: 'workAvg', width: 16 },
    { header: 'Выходные, средняя', key: 'weekendAvg', width: 18 },
  ]
  const byCompany = new Map<
    string,
    { actual: number[]; expected: number; day: number; night: number; work: number[]; weekend: number[] }
  >()
  for (const shift of details) {
    const entry =
      byCompany.get(shift.company_id) || { actual: [], expected: 0, day: 0, night: 0, work: [], weekend: [] }
    entry.actual.push(shift.actual)
    entry.expected += shift.expected
    if (shift.shift === 'night') entry.night += 1
    else entry.day += 1
    if (isWeekend(shift.date)) entry.weekend.push(shift.actual)
    else entry.work.push(shift.actual)
    byCompany.set(shift.company_id, entry)
  }
  for (const [companyId, entry] of byCompany) {
    const total = entry.actual.reduce((sum, value) => sum + value, 0)
    pointSheet.addRow({
      point: companyName(companyId),
      shifts: entry.actual.length,
      day: entry.day,
      night: entry.night,
      expected: Math.round(entry.expected),
      actual: Math.round(total),
      percent: entry.expected > 0 ? Math.round((total / entry.expected) * 100) : 0,
      avg: average(entry.actual),
      workAvg: average(entry.work),
      weekendAvg: average(entry.weekend),
    })
  }
  styleHeader(pointSheet)
  paintPercent(pointSheet, 'percent')
  paintMoney(pointSheet, ['expected', 'actual', 'avg', 'workAvg', 'weekendAvg'])

  const buffer = await book.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
