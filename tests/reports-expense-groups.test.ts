import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupExpensesByArticle } from '@/lib/reports/expense-groups'

const expense = (date: string, category: string | null, cash: number, kaspi = 0) => ({
  date,
  category,
  cash_amount: cash,
  kaspi_amount: kaspi,
})

const run = (
  expenses: ReturnType<typeof expense>[],
  categoryGroups: Record<string, string | null> = {},
) =>
  groupExpensesByArticle({
    expenses,
    dateFrom: '2026-08-08',
    dateTo: '2026-08-14',
    prevFrom: '2026-08-01',
    prevTo: '2026-08-07',
    categoryGroups,
  })

test('аванс входит в ФОТ, а не отдельной статьёй — как в ОПиУ', () => {
  const articles = run([expense('2026-08-10', 'Зарплата', 100_000), expense('2026-08-11', 'Аванс', 30_000)])
  assert.equal(articles.length, 1)
  assert.equal(articles[0].group, 'payroll')
  assert.equal(articles[0].amount, 130_000)
})

test('явная статья из справочника важнее угадывания по названию', () => {
  const articles = run([expense('2026-08-10', 'Закуп напитков', 50_000)], { 'закуп напитков': 'cogs' })
  assert.equal(articles[0].group, 'cogs')
})

test('без справочника категория без признаков — операционные', () => {
  const articles = run([expense('2026-08-10', 'Аренда', 400_000, 50_000)])
  assert.equal(articles[0].group, 'operating')
  assert.equal(articles[0].amount, 450_000)
})

test('прошлый период копится отдельно и не попадает в категории', () => {
  const articles = run([expense('2026-08-03', 'Аренда', 300_000), expense('2026-08-09', 'Аренда', 350_000)])
  assert.equal(articles[0].amount, 350_000)
  assert.equal(articles[0].prevAmount, 300_000)
  assert.deepEqual(articles[0].categories, [{ name: 'Аренда', amount: 350_000 }])
})

test('порядок статей — как в цепочке ОПиУ, вне цепочки в конце', () => {
  const articles = run(
    [
      expense('2026-08-10', 'Покупка оборудования', 1),
      expense('2026-08-10', 'Аренда', 1),
      expense('2026-08-10', 'Себестоимость', 1),
      expense('2026-08-10', 'Зарплата', 1),
    ],
  )
  assert.deepEqual(articles.map((a) => a.group), ['cogs', 'operating', 'payroll', 'capex'])
  assert.equal(articles.at(-1)?.offChain, true)
  assert.equal(articles[0].offChain, false)
})

test('строки вне обоих периодов и нулевые суммы пропускаются', () => {
  const articles = run([expense('2026-07-01', 'Аренда', 999), expense('2026-08-10', 'Аренда', 0)])
  assert.equal(articles.length, 0)
})
