import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchInChunks } from '@/lib/server/fetch-in-chunks'

// Имитация PostgREST: таблица из `total` строк и потолок `maxRows` на ответ
const fakeTable = (total: number, maxRows = 1000) => {
  const calls: Array<[number, number]> = []
  const fetchRange = async (from: number, to: number) => {
    calls.push([from, to])
    const end = Math.min(to, from + maxRows - 1, total - 1)
    const out: number[] = []
    for (let i = from; i <= end; i++) out.push(i)
    return out
  }
  return { calls, fetchRange }
}

test('5000 строк при потолке сервера 1000 приходят целиком', async () => {
  const table = fakeTable(4200)
  const rows = await fetchInChunks({ page: 0, pageSize: 5000, fetchRange: table.fetchRange })
  assert.equal(rows.length, 4200)
  assert.equal(rows[0], 0)
  assert.equal(rows.at(-1), 4199)
  assert.equal(new Set(rows).size, 4200)
})

test('без запасных запросов: чтение останавливается на неполном куске', async () => {
  const table = fakeTable(2500)
  await fetchInChunks({ page: 0, pageSize: 5000, fetchRange: table.fetchRange })
  assert.deepEqual(table.calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ])
})

test('страница больше первой начинается со своего смещения', async () => {
  const table = fakeTable(10_000)
  const rows = await fetchInChunks({ page: 2, pageSize: 1500, fetchRange: table.fetchRange })
  assert.equal(rows.length, 1500)
  assert.equal(rows[0], 3000)
  assert.equal(rows.at(-1), 4499)
})

test('маленькая страница — один запрос ровно на её размер', async () => {
  const table = fakeTable(100)
  const rows = await fetchInChunks({ page: 0, pageSize: 10, fetchRange: table.fetchRange })
  assert.equal(rows.length, 10)
  assert.deepEqual(table.calls, [[0, 9]])
})
