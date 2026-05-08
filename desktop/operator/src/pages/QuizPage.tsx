/**
 * Квиз по знаниям для оператора.
 * 5 вопросов из базы знаний, 80% — порог сдачи.
 * Показывается раз в 7 дней при старте смены.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, XCircle, BookOpen, Award } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toastError, toastSuccess } from '@/lib/toast'
import type { AppConfig, OperatorSession } from '@/types'

type QuizQuestion = {
  index: number
  q: string
  choices: string[]
}

type QuizResult = {
  attempt_id: string
  score: number
  correct: number
  total: number
  passed: boolean
  wrongArticleIds: string[]
}

type QuizPageProps = {
  config: AppConfig
  session: OperatorSession
  onComplete: (passed: boolean) => void
  onSkip: () => void
}

async function pointFetch<T>(
  config: AppConfig,
  session: OperatorSession,
  path: string,
  method: 'GET' | 'POST',
  body?: any,
): Promise<T> {
  const res = await fetch(`${config.apiUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-point-device-token': config.deviceToken,
      'x-point-operator-id': session.operator.operator_id,
      'x-point-operator-auth-id': session.operator.auth_id,
      'x-point-company-id': session.company.id,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json as T
}

export default function QuizPage({ config, session, onComplete, onSkip }: QuizPageProps) {
  const [phase, setPhase] = useState<'loading' | 'taking' | 'submitting' | 'result'>('loading')
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [result, setResult] = useState<QuizResult | null>(null)

  useEffect(() => {
    void generate()
  }, [])

  async function generate() {
    try {
      const data = await pointFetch<{ ok: boolean; data: { attempt_id: string; questions: QuizQuestion[] } }>(
        config, session, '/api/point/quiz/generate', 'POST', {},
      )
      setAttemptId(data.data.attempt_id)
      setQuestions(data.data.questions)
      setPhase('taking')
    } catch (err: any) {
      toastError(err?.message || 'Не удалось сгенерировать квиз')
      onSkip()
    }
  }

  async function submit() {
    if (!attemptId) return
    setPhase('submitting')
    try {
      const data = await pointFetch<{ ok: boolean; data: QuizResult }>(
        config, session, '/api/point/quiz/submit', 'POST',
        { attempt_id: attemptId, answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v])) },
      )
      setResult(data.data)
      setPhase('result')
      if (data.data.passed) {
        toastSuccess(`Сдано! Оценка ${data.data.score}%`)
      } else {
        toastError(`Не сдано (${data.data.score}%). Перечитай статьи и попробуй снова.`)
      }
    } catch (err: any) {
      toastError(err?.message || 'Ошибка отправки')
      setPhase('taking')
    }
  }

  if (phase === 'loading') {
    return (
      <div className="grid h-screen place-items-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-emerald-500" />
          <p className="mt-4 text-sm text-slate-500">Готовлю вопросы...</p>
        </div>
      </div>
    )
  }

  if (phase === 'result' && result) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <Card className="w-full max-w-md p-8 text-center">
          {result.passed ? (
            <>
              <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-emerald-500/10">
                <Award className="h-10 w-10 text-emerald-500" />
              </div>
              <h2 className="mb-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">Сдано!</h2>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-rose-500/10">
                <XCircle className="h-10 w-10 text-rose-500" />
              </div>
              <h2 className="mb-2 text-2xl font-bold text-rose-600 dark:text-rose-400">Не сдано</h2>
            </>
          )}
          <p className="text-3xl font-bold tabular-nums">{result.score}%</p>
          <p className="text-sm text-slate-500 mt-1">
            Правильно: {result.correct} из {result.total}
          </p>
          {!result.passed && (
            <p className="mt-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              Перечитай статьи в кабинете оператора и попробуй снова через несколько минут.
            </p>
          )}
          <Button
            onClick={() => onComplete(result.passed)}
            className="mt-6 w-full bg-emerald-500 text-white hover:bg-emerald-600"
          >
            Продолжить
          </Button>
        </Card>
      </div>
    )
  }

  if (phase === 'submitting') {
    return (
      <div className="grid h-screen place-items-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-emerald-500" />
          <p className="mt-4 text-sm text-slate-500">Проверяю ответы...</p>
        </div>
      </div>
    )
  }

  // Phase: taking
  const q = questions[currentIdx]
  if (!q) return null
  const allAnswered = questions.every((_, i) => answers[i] !== undefined)
  const progress = ((currentIdx + 1) / questions.length) * 100

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-emerald-500" />
            <h1 className="text-lg font-bold">Тест знаний</h1>
          </div>
          <p className="text-sm tabular-nums text-slate-500">
            {currentIdx + 1} / {questions.length}
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <Card className="w-full max-w-2xl p-6">
          <p className="mb-6 text-lg font-semibold">{q.q}</p>
          <div className="space-y-3">
            {q.choices.map((choice, i) => {
              const isSelected = answers[currentIdx] === i
              return (
                <button
                  key={i}
                  onClick={() => setAnswers((cur) => ({ ...cur, [currentIdx]: i }))}
                  className={`flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
                  }`}
                >
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                  }`}>
                    {String.fromCharCode(65 + i)}
                  </div>
                  <span className="flex-1 text-sm">{choice}</span>
                  {isSelected && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                </button>
              )
            })}
          </div>

          {/* Navigation */}
          <div className="mt-6 flex justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              disabled={currentIdx === 0}
            >
              ← Назад
            </Button>
            {currentIdx < questions.length - 1 ? (
              <Button
                onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
                disabled={answers[currentIdx] === undefined}
                className="bg-emerald-500 text-white hover:bg-emerald-600"
              >
                Далее →
              </Button>
            ) : (
              <Button
                onClick={() => void submit()}
                disabled={!allAnswered}
                className="bg-emerald-500 text-white hover:bg-emerald-600"
              >
                Завершить
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
