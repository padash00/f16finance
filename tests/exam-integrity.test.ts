import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { analyzeOpenAnswer, textSimilarity } from '../lib/server/exam-integrity'

const HUMAN_ANSWER =
  'сначала зафиксирую поломку в тех журнале, потом скажу старшему. клиента пересажу на свободное место и извинюсь за ожидание'

describe('признаки несамостоятельного ответа', () => {
  it('обычный ответ оператора не помечается', () => {
    const report = analyzeOpenAnswer({ text: HUMAN_ANSWER, seconds: 90 })
    assert.equal(report.risk, 0)
    assert.equal(report.signals.length, 0)
  })

  it('длинный текст за секунды — вставка', () => {
    const report = analyzeOpenAnswer({ text: 'а'.repeat(600), seconds: 8 })
    assert.ok(report.risk > 0)
    assert.equal(report.signals[0].code, 'speed')
  })

  it('складный, но медленно написанный ответ не наказывается', () => {
    // Один стилистический признак без жёстких сигналов — не повод для пометки.
    const text = 'В первую очередь я зафиксирую поломку, кроме того сообщу старшему смены.'
    const report = analyzeOpenAnswer({ text, seconds: 240 })
    assert.equal(report.risk, 0)
  })

  it('совпадение с ответом коллеги видно', () => {
    const report = analyzeOpenAnswer({
      text: HUMAN_ANSWER,
      seconds: 200,
      others: [{ operatorName: 'Азат', text: HUMAN_ANSWER }],
    })
    assert.ok(report.risk >= 30)
    assert.ok(report.signals.some((signal) => signal.code === 'duplicate'))
  })

  it('оформление статьёй плюс скорость дают высокий риск', () => {
    const text = [
      '**Порядок действий:**',
      '1. Зафиксировать поломку в журнале',
      '2. Сообщить старшему смены',
      '3. Пересадить клиента на свободное место',
      'Таким образом, важно отметить, что клиент не должен ждать.',
    ].join('\n')
    const report = analyzeOpenAnswer({ text, seconds: 5 })
    assert.ok(report.risk >= 40)
  })

  it('без времени ответа скорость не оценивается', () => {
    const report = analyzeOpenAnswer({ text: 'а'.repeat(600), seconds: null })
    assert.equal(report.chars_per_second, null)
    assert.ok(!report.signals.some((signal) => signal.code === 'speed'))
  })

  it('похожесть текстов считается по словам', () => {
    assert.ok(textSimilarity('проверю кассу и сообщу старшему', 'проверю кассу и сообщу старшему') > 0.9)
    assert.ok(textSimilarity('проверю кассу', 'уберу зал и помою пол') < 0.2)
  })
})
