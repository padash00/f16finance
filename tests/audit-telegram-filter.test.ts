import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatAuditEvent } from '../lib/core/event-formatter'
import { deservesTelegram } from '../lib/core/audit-telegram'

/** Событие → уходит ли оно в Telegram. */
function shouldSend(entityType: string, action: string, payload: Record<string, unknown> = {}) {
  const formatted = formatAuditEvent({ entityType, action, payload, actorLabel: '' })
  return deservesTelegram(formatted, action)
}

describe('что уходит в Telegram из журнала', () => {
  it('рутина по экзаменам не шлётся — она забивала чат', () => {
    assert.equal(shouldSend('operator_exam', 'operator_exam.send'), false)
    assert.equal(shouldSend('operator_exam', 'operator_exam.draft'), false)
  })

  it('обычное сохранение и просмотр тоже молчат', () => {
    assert.equal(shouldSend('knowledge-article', 'create'), false)
    assert.equal(shouldSend('checklist-template', 'update'), false)
  })

  it('удаление данных требует внимания владельца', () => {
    assert.equal(shouldSend('knowledge-article', 'delete'), true)
    assert.equal(shouldSend('organization', 'delete-organization'), true)
  })

  it('события безопасности уходят всегда', () => {
    assert.equal(shouldSend('auth-session', 'login'), true)
  })
})

describe('как журнал называет незнакомые события', () => {
  it('вместо кодов таблицы — русские слова', () => {
    const formatted = formatAuditEvent({
      entityType: 'operator_exam',
      action: 'operator_exam.send',
      payload: {},
      actorLabel: 'Падаш Олжас',
    })
    assert.equal(formatted.title, 'Падаш Олжас — экзамен оператора: отправка')
  })

  it('совсем неизвестный тип хотя бы читается', () => {
    const formatted = formatAuditEvent({
      entityType: 'some_new_thing',
      action: 'some_new_thing.update',
      payload: {},
      actorLabel: 'Аноним',
    })
    assert.equal(formatted.title, 'Аноним — some new thing: изменение')
  })
})
