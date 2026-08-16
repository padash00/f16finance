/**
 * Ротация вопросов.
 *
 * Главное, что здесь защищается: еженедельный экзамен не должен повторяться.
 * Если за месяц вопросы одни и те же, люди выучивают ответы, экзамен перестаёт
 * проверять и начинает раздражать — это хуже, чем не проверять вовсе.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  blockedHashes,
  pickWithRotation,
  questionHash,
  type AskedQuestion,
} from '@/lib/domain/exam-rotation'

const NOW = new Date('2026-08-16T00:00:00Z')

function daysAgo(days: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function asked(q: string, days: number, correct: boolean | null = true): AskedQuestion {
  return { question_hash: questionHash({ q }), asked_on: daysAgo(days), was_correct: correct }
}

test('один и тот же вопрос узнаётся при другом регистре и пробелах', () => {
  // Модель переставляет пробелы и регистр от билета к билету. Без нормализации
  // повтор считался бы новым вопросом.
  assert.equal(
    questionHash({ q: 'Сколько стоит рамен?' }),
    questionHash({ q: '  сколько   стоит   РАМЕН?  ' }),
  )
})

test('заданный на прошлой неделе вопрос не повторяется', () => {
  const blocked = blockedHashes([asked('Сколько стоит рамен?', 7)], NOW)
  assert.ok(blocked.has(questionHash({ q: 'Сколько стоит рамен?' })))
})

test('через месяц вопрос возвращается', () => {
  const blocked = blockedHashes([asked('Сколько стоит рамен?', 30)], NOW)
  assert.equal(blocked.size, 0)
})

test('вопрос с ошибкой возвращается вдвое раньше', () => {
  // Смысл повтора — закрыть пробел, а не переспросить то, что человек знает.
  const wrong = blockedHashes([asked('Что делать при недостаче?', 16, false)], NOW)
  const right = blockedHashes([asked('Что делать при недостаче?', 16, true)], NOW)

  assert.equal(wrong.size, 0, 'ошибочный через 16 дней уже можно задать')
  assert.equal(right.size, 1, 'верно отвеченный ещё рано')
})

test('в билет идут невиданные вопросы', () => {
  const pool = ['A', 'B', 'C', 'D', 'E'].map((q) => ({ q }))
  const history = [asked('A', 3), asked('B', 5)]

  const picked = pickWithRotation(pool, 3, history, NOW).map((x) => x.q)

  assert.equal(picked.length, 3)
  assert.ok(!picked.includes('A'))
  assert.ok(!picked.includes('B'))
})

test('если свежих не хватило, билет всё равно полный', () => {
  // Короткий билет хуже повторного вопроса: экзамен из двух вопросов не
  // проверяет ничего.
  const pool = ['A', 'B', 'C', 'D'].map((q) => ({ q }))
  const history = [asked('A', 1), asked('B', 1), asked('C', 1)]

  const picked = pickWithRotation(pool, 3, history, NOW)

  assert.equal(picked.length, 3)
})

test('маленький пул отдаётся целиком', () => {
  const pool = ['A', 'B'].map((q) => ({ q }))
  assert.equal(pickWithRotation(pool, 5, [asked('A', 1)], NOW).length, 2)
})

test('без истории отбор работает как раньше', () => {
  const pool = ['A', 'B', 'C', 'D', 'E'].map((q) => ({ q }))
  assert.equal(pickWithRotation(pool, 3, [], NOW).length, 3)
})

test('два человека получают разные билеты', () => {
  // Одинаковый билет у всей смены — это переписка в чате, а не экзамен.
  const pool = Array.from({ length: 20 }, (_, i) => ({ q: `Вопрос ${i}` }))

  const first = pickWithRotation(pool, 8, [], NOW).map((x) => x.q).join()
  const second = pickWithRotation(pool, 8, [], NOW).map((x) => x.q).join()

  assert.notEqual(first, second)
})
