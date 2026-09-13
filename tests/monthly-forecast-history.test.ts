import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMonthlyForecast } from '@/lib/analysis/monthly-forecast'

// «История по месяцам» на /analysis должна сходиться с /reports: там расходы —
// все строки журнала. Прогноз при этом учится только на регулярных расходах.

test('история месяца: все расходы как в отчётах, прибыль после них; регулярный расход отдельно', () => {
  const result = buildMonthlyForecast(
    [{ date: '2026-08-10', cash: 1_000_000 }],
    [
      { date: '2026-08-01', category: 'Аренда', cash: 300_000 }, // постоянные
      { date: '2026-08-05', category: 'Себестоимость', cash: 200_000 }, // переменные
      { date: '2026-08-07', category: 'Покупка оборудования', cash: 150_000 }, // CAPEX — разовые
      { date: '2026-08-20', category: 'Доля партнёра', cash: 100_000 }, // распределение прибыли
    ],
    '2026-09-14',
  )
  const august = result.months.find((m) => m.month === '2026-08')!
  assert.equal(august.expense, 500_000, 'регулярный расход — для прогноза')
  assert.equal(august.oneOff, 150_000)
  assert.equal(august.distribution, 100_000)
  assert.equal(august.totalExpense, 750_000, 'все расходы — как в /reports')
  assert.equal(august.netProfit, 250_000)
  assert.equal(Math.round(august.marginPct), 25)
})

test('статья из справочника организации важнее названия', () => {
  const result = buildMonthlyForecast(
    [{ date: '2026-08-10', cash: 1_000_000 }],
    [{ date: '2026-08-02', category: 'Закуп напитков', cash: 400_000 }],
    '2026-09-14',
    { 'закуп напитков': 'cogs' },
  )
  const august = result.months.find((m) => m.month === '2026-08')!
  assert.equal(august.variable, 400_000)
  assert.equal(august.fixed, 0)
})
