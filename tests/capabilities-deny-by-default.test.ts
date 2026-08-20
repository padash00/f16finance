import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DENY_BY_DEFAULT_CAPABILITIES,
  getAllCapabilityIds,
  isDenyByDefault,
} from '../lib/core/capabilities'

/**
 * Права «только явно» держатся на совпадении строки с каталогом.
 *
 * Если право переименуют — скажем, `valuation.view` станет `valuation.read`, —
 * набор «только явно» продолжит ссылаться на несуществующее имя и молча
 * перестанет работать. Оценка стоимости бизнеса откроется всему штату по
 * умолчанию, и заметить это будет не по чему: ошибки нет, отказа нет, страница
 * просто есть у всех.
 */
describe('права, которые выдаются только явно', () => {
  it('каждое такое право есть в каталоге', () => {
    const catalog = new Set(getAllCapabilityIds())
    for (const capability of DENY_BY_DEFAULT_CAPABILITIES) {
      assert.ok(
        catalog.has(capability),
        `права «${capability}» нет в каталоге — набор «только явно» ссылается в пустоту`,
      )
    }
  })

  it('оценка бизнеса не достаётся по умолчанию', () => {
    assert.equal(isDenyByDefault('valuation.view'), true)
  })

  it('обычное право остаётся обычным', () => {
    assert.equal(isDenyByDefault('income.view'), false)
  })
})
