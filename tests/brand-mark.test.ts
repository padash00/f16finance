import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isCustomBrand } from '../lib/core/site'

/**
 * Знак Orda Point показывается только там, где продукт наш.
 *
 * Ловушка в том, что наша же установка задаёт NEXT_PUBLIC_SITE_NAME — и
 * правило «переменная задана → бренд чужой» спрятало бы собственный знак у
 * себя, тихо и без ошибок.
 */
describe('чей знак показывать в шапке', () => {
  it('наша установка с явным именем — знак наш', () => {
    assert.equal(isCustomBrand('Orda Point', ''), false)
    assert.equal(isCustomBrand('Orda Control', ''), false)
  })

  it('имя не задано — тоже наш', () => {
    assert.equal(isCustomBrand('', ''), false)
  })

  it('чужое имя — буквы вместо знака', () => {
    assert.equal(isCustomBrand('CyberClub Manager', ''), true)
  })

  it('заданная марка перевешивает имя: буквы выбрали руками', () => {
    assert.equal(isCustomBrand('Orda Point', 'ОК'), true)
  })

  it('«Ordanova» — не наш: сверяем слово целиком, а не начало строки', () => {
    assert.equal(isCustomBrand('Ordanova', ''), true)
  })
})
