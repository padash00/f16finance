import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  confidenceOf,
  expandHolidays,
  holidaysNeedingDates,
  loadPublicHolidays,
  isHolidayWeekend,
  loadEducationCalendar,
  periodTypeOf,
  splitEducationCalendar,
  strengthToIndex,
} from '@/lib/server/kz-education-calendar'

test('справочник читается и покрывает два учебных года', () => {
  const entries = loadEducationCalendar()
  assert.ok(entries.length > 40, `записей: ${entries.length}`)
  assert.ok(entries.every((e) => e.start_date <= e.end_date), 'даты не должны идти задом наперёд')
})

test('оценка влияния переводится в узкий диапазон', () => {
  // Это чужая оценка, а не наши измерения, поэтому шаг мелкий и с границами.
  assert.equal(strengthToIndex(0), 1)
  assert.equal(strengthToIndex(4), 1.2)
  assert.equal(strengthToIndex(-3), 0.85)
  // За границы месячного индекса не выходим ни при каких значениях.
  assert.equal(strengthToIndex(100), 1.2)
  assert.equal(strengthToIndex(-100), 0.85)
})

test('надёжность дат зависит от статуса проверки', () => {
  assert.equal(confidenceOf('confirmed'), 1)
  assert.ok(confidenceOf('preliminary') < 1)
  assert.ok(confidenceOf('estimated') < confidenceOf('preliminary'))
})

test('длинные выходные уходят в календарь дней, а не в учебные периоды', () => {
  // Иначе один и тот же Новый год попал бы в две части месячного индекса.
  const { periods, holidayWeekends } = splitEducationCalendar(loadEducationCalendar())
  assert.ok(holidayWeekends.length > 0)
  assert.ok(holidayWeekends.every((e) => isHolidayWeekend(e)))
  assert.ok(periods.every((e) => !isHolidayWeekend(e)))
  assert.equal(periods.length + holidayWeekends.length, loadEducationCalendar().length)
})

test('длинным считается только короткий праздничный промежуток', () => {
  const base = {
    name: 'Новый год — праздничные выходные',
    type: 'Другое',
    education_group: 'all',
    audience: 'все',
    verification_status: 'confirmed',
    source_name: 'x',
    source_url: 'x',
    description: 'x',
    demand_effect: 'positive',
    demand_strength: 3,
  }
  assert.equal(isHolidayWeekend({ ...base, start_date: '2027-01-01', end_date: '2027-01-04' }), true)
  // Месячный «праздник» — это уже не выходные, а что-то другое.
  assert.equal(isHolidayWeekend({ ...base, start_date: '2027-01-01', end_date: '2027-02-01' }), false)
  // Каникулы остаются учебным периодом, даже если короткие.
  assert.equal(
    isHolidayWeekend({ ...base, type: 'Каникулы', name: 'Школы — осенние каникулы', start_date: '2026-10-26', end_date: '2026-11-01' }),
    false,
  )
})

test('типы справочника ложатся на типы модуля', () => {
  const entries = loadEducationCalendar()
  const allowed = new Set([
    'SEMESTER',
    'VACATION',
    'EXAMS',
    'ADMISSION',
    'START_OF_YEAR',
    'END_OF_YEAR',
    'SUMMER_BREAK',
    'CUSTOM',
  ])
  for (const e of entries) {
    assert.ok(allowed.has(periodTypeOf(e)), `${e.type} → ${periodTypeOf(e)}`)
  }
})

// ─── Праздники ─────────────────────────────────────────────────────────────

test('праздники разворачиваются в дни, переносы и длинные выходные', () => {
  const days = expandHolidays(loadPublicHolidays())
  const types = new Set(days.map((d) => d.day_type))

  assert.ok(types.has('PUBLIC_HOLIDAY'))
  assert.ok(types.has('TRANSFERRED_DAY_OFF'), 'переносы выходных обязаны попадать в календарь')
  assert.ok(types.has('LONG_WEEKEND'))
  assert.ok(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day)), 'все даты должны быть датами')
})

test('День Конституции стоит на 15 марта, а не на 30 августа', () => {
  // С 01.07.2026 праздник перенесён. Старый справочник kz_holidays об этом
  // не знает, поэтому источником служит именно этот набор.
  const days = expandHolidays(loadPublicHolidays())
  const constitution = days.filter((d) => d.name.includes('Конституции'))

  assert.ok(constitution.length > 0)
  assert.ok(constitution.some((d) => d.day === '2027-03-15'))
  assert.ok(!constitution.some((d) => d.day.endsWith('-08-30')))
})

test('короткий отдых не считается длинными выходными', () => {
  const days = expandHolidays([
    {
      name: 'Однодневный праздник',
      category: 'state_holiday',
      official_start_date: '2026-12-16',
      official_end_date: '2026-12-16',
      audience: 'all',
      non_working_day: true,
      five_day_week: {
        holiday_dates: ['2026-12-16'],
        transfer_days_off: [],
        continuous_rest_period: { start: '2026-12-16', end: '2026-12-16', days: 1 },
      },
      verification_status: 'confirmed',
      source_name: 'x',
      source_url: 'x',
    },
  ])

  assert.equal(days.filter((d) => d.day_type === 'LONG_WEEKEND').length, 0)
  assert.equal(days.length, 1)
})

test('праздник без дат не попадает в календарь, но виден отдельно', () => {
  // Курбан айт: дата плавает по лунному календарю, составитель честно
  // пометил его как требующий подтверждения.
  const pending = holidaysNeedingDates(loadPublicHolidays())
  assert.ok(pending.length > 0)
  assert.ok(pending.some((e) => e.name.toLowerCase().includes('курбан')))

  const days = expandHolidays(loadPublicHolidays())
  assert.ok(!days.some((d) => d.name.toLowerCase().includes('курбан')))
})

test('непроверенные праздники помечаются как непроверенные', () => {
  const days = expandHolidays(loadPublicHolidays())
  const preliminary = days.filter((d) => !d.verified)
  // В справочнике часть дат предварительные — они не должны выглядеть
  // подтверждёнными.
  assert.ok(preliminary.length > 0)
})
