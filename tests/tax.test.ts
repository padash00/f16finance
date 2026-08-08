import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MRP,
  MZP,
  SELF_SOCIAL_MONTHLY,
  SIMPLIFIED_LIMIT,
  VAT_THRESHOLD,
  computeEmployeeTax,
  computePayrollTaxes,
  computeTaxBurden,
  computeTaxSummary,
  computeYearOutlook,
  monthlyTaxableRevenue,
  normalizeRate,
} from '@/lib/domain/tax'

const income = (date: string, amount: number, companyId: string | null = null) => ({
  date,
  company_id: companyId,
  cash_amount: amount,
  kaspi_amount: 0,
  online_amount: 0,
  card_amount: 0,
})

// ─── Константы 2026 ─────────────────────────────────────────────────────────

test('соцплатёж «за себя» — сумма четырёх взносов от 1 МЗП', () => {
  assert.equal(SELF_SOCIAL_MONTHLY, 21_675)
})

test('пороги считаются в МРП', () => {
  assert.equal(VAT_THRESHOLD, 10_000 * MRP)
  assert.equal(SIMPLIFIED_LIMIT, 600_000 * MRP)
})

// ─── Налогооблагаемый оборот ────────────────────────────────────────────────

test('оборот складывается из всех способов оплаты', () => {
  const months = monthlyTaxableRevenue([
    { date: '2026-08-01', cash_amount: 100, kaspi_amount: 50, online_amount: 30, card_amount: 20 },
  ])
  assert.deepEqual(months, [{ month: '2026-08', revenue: 200 }])
})

test('месяцы идут по возрастанию', () => {
  const months = monthlyTaxableRevenue([
    income('2026-09-01', 300),
    income('2026-07-15', 100),
    income('2026-08-20', 200),
  ])
  assert.deepEqual(months.map((m) => m.month), ['2026-07', '2026-08', '2026-09'])
})

test('исключённая точка не попадает в налогооблагаемый оборот', () => {
  const months = monthlyTaxableRevenue(
    [income('2026-08-01', 1_000, 'main'), income('2026-08-02', 400, 'extra')],
    ['extra'],
  )
  assert.deepEqual(months, [{ month: '2026-08', revenue: 1_000 }])
})

test('строки без точки учитываются всегда', () => {
  // company_id пуст у ручных вводов; исключать их по списку точек нельзя,
  // иначе выручка молча пропала бы из декларации.
  const months = monthlyTaxableRevenue([income('2026-08-01', 500, null)], ['extra'])
  assert.deepEqual(months, [{ month: '2026-08', revenue: 500 }])
})

// ─── Налог за период ────────────────────────────────────────────────────────

test('ИПН считается по ставке от оборота', () => {
  const summary = computeTaxSummary([income('2026-08-01', 1_000_000)], { rate: 2 })
  assert.equal(summary.revenue, 1_000_000)
  assert.equal(summary.ipn, 20_000)
})

test('соцплатежи умножаются на число месяцев с выручкой', () => {
  const summary = computeTaxSummary([income('2026-07-01', 500), income('2026-08-01', 500)], { rate: 2 })
  assert.equal(summary.monthsCount, 2)
  assert.equal(summary.selfSocial, SELF_SOCIAL_MONTHLY * 2)
})

test('период без выручки не начисляет соцплатежи', () => {
  const summary = computeTaxSummary([], { rate: 2 })
  assert.equal(summary.monthsCount, 0)
  assert.equal(summary.selfSocial, 0)
  assert.equal(summary.total, 0)
  assert.equal(summary.effectiveRate, 0)
})

test('эффективная ставка считается от оборота', () => {
  const summary = computeTaxSummary([income('2026-08-01', 1_000_000)], { rate: 2 })
  // 20 000 ИПН + 21 675 соцплатежей от миллиона оборота.
  assert.equal(summary.total, 41_675)
  assert.equal(Math.round(summary.effectiveRate * 10_000) / 10_000, 4.1675)
})

test('ИПН периода считается от общего оборота, а не суммой месячных', () => {
  const summary = computeTaxSummary([income('2026-07-01', 55), income('2026-08-01', 55)], { rate: 3 })
  // Помесячно вышло бы 2 + 2 = 4, от общего оборота — 3.
  assert.equal(summary.ipn, 3)
})

test('ставка вне 2–6 % приводится к границе', () => {
  assert.equal(normalizeRate(0), 2)
  assert.equal(normalizeRate(10), 6)
  assert.equal(normalizeRate(4), 4)
  assert.equal(normalizeRate('чепуха'), 2)
  assert.equal(normalizeRate(undefined), 2)
})

// ─── Пороги ─────────────────────────────────────────────────────────────────

test('прогноз растягивает оборот с начала года на 365 дней', () => {
  const outlook = computeYearOutlook(10_000_000, 100)
  assert.equal(outlook.projected, 36_500_000)
  assert.equal(outlook.vatRisk, false)
  assert.equal(outlook.vatRemaining, VAT_THRESHOLD - 10_000_000)
})

test('темп, выводящий за порог НДС, поднимает флаг', () => {
  const outlook = computeYearOutlook(10_000_000, 50)
  assert.equal(outlook.projected, 73_000_000)
  assert.equal(outlook.vatRisk, true)
})

test('порог, уже пройденный по факту, не даёт отрицательного остатка', () => {
  const outlook = computeYearOutlook(VAT_THRESHOLD + 1_000_000, 300)
  assert.equal(outlook.vatRemaining, 0)
  assert.equal(outlook.vatRisk, true)
})

// ─── Налоги за работников ───────────────────────────────────────────────────

test('оклад до 25 МРП получает льготу 90 % по ИПН', () => {
  const tax = computeEmployeeTax(100_000)
  assert.equal(tax.opv, 10_000)
  assert.equal(tax.vosms, 2_000)
  // Без льготы вышло бы 2 745.
  assert.equal(tax.ipn, 275)
  assert.equal(tax.withheld, 12_275)
  assert.equal(tax.employerTop, 10_000)
  assert.equal(tax.net, 87_725)
  assert.equal(tax.totalCost, 110_000)
})

test('оклад выше 25 МРП платит ИПН полностью', () => {
  const tax = computeEmployeeTax(200_000)
  assert.equal(tax.ipn, 11_545)
  assert.equal(tax.withheld, 35_545)
  assert.equal(tax.monthlyTax, 55_545)
})

test('ОПВ и СО считаются от ограниченной базы', () => {
  const tax = computeEmployeeTax(5_000_000)
  assert.equal(tax.opv, Math.round(50 * MZP * 0.1))
  assert.equal(tax.so, Math.round(7 * MZP * 0.035))
})

test('свод по работникам складывает всех', () => {
  const payroll = computePayrollTaxes([100_000, 200_000])
  assert.equal(payroll.employees, 2)
  assert.equal(payroll.gross, 300_000)
  assert.equal(payroll.monthlyTax, 22_275 + 55_545)
})

test('без работников свод пустой, а не сломанный', () => {
  const payroll = computePayrollTaxes([])
  assert.equal(payroll.employees, 0)
  assert.equal(payroll.monthlyTax, 0)
})

// ─── Полная нагрузка ────────────────────────────────────────────────────────

test('нагрузка складывает ИПН, соцплатежи и налоги за работников', () => {
  const summary = computeTaxSummary([income('2026-07-01', 500_000), income('2026-08-01', 500_000)], { rate: 2 })
  const burden = computeTaxBurden(summary, 22_275)

  assert.equal(burden.ipn, 20_000)
  assert.equal(burden.selfSocial, SELF_SOCIAL_MONTHLY * 2)
  // Работники платятся каждый месяц периода, а не один раз.
  assert.equal(burden.payrollTaxes, 44_550)
  assert.equal(burden.total, 20_000 + 43_350 + 44_550)
})

test('без оборота эффективная ставка нагрузки равна нулю', () => {
  const burden = computeTaxBurden(computeTaxSummary([], { rate: 2 }), 22_275)
  assert.equal(burden.total, 0)
  assert.equal(burden.effectiveRate, 0)
})
