'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageCircleQuestion, RefreshCw } from 'lucide-react'

type Group = {
  article_id: string
  title: string
  severity: string | null
  count: number
  operators: number
  last_at: string
  samples: Array<{ question: string; operator: string | null; created_at: string }>
}

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * Что операторам непонятно.
 *
 * Каждый вопрос здесь — сотрудник, который открыл правило и не смог по нему
 * работать. Владелец обычно уверен, что написал ясно; этот список — обратная
 * связь с точки, которую иначе никто не принесёт.
 */
export default function QuestionsPanel() {
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(true)
  const [groups, setGroups] = useState<Group[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/knowledge/questions', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось загрузить вопросы')
      setAvailable(payload.data?.available !== false)
      setGroups(payload.data?.groups || [])
      setTotal(Number(payload.data?.total || 0))
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаю вопросы операторов…
      </div>
    )
  }

  if (!available) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
        Сбор вопросов ещё не включён: примените миграцию{' '}
        <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">20260814_knowledge_questions</code>. До этого
        кнопка «объясни проще» у операторов работает, но вопросы не сохраняются.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <MessageCircleQuestion className="h-4 w-4 text-sky-500" />
          {groups.length > 0 ? (
            <span>
              Вопросов: <b>{total}</b> по {groups.length} правилам
            </span>
          ) : (
            <span>Пока никто не просил объяснить правило</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Обновить
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
          Здесь появятся правила, по которым операторы жмут «Не понял — объясни проще». Чем чаще
          спрашивают об одном и том же, тем вероятнее, что текст стоит переписать.
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <article
              key={group.article_id}
              className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/50"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{group.title}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Спрашивали {group.count} раз · {group.operators} чел. · последний раз {formatDate(group.last_at)}
                  </p>
                </div>
                {group.samples.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === group.article_id ? null : group.article_id)}
                    className="shrink-0 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                  >
                    {openId === group.article_id ? 'Скрыть вопросы' : 'Что спрашивали'}
                  </button>
                )}
              </div>

              {openId === group.article_id && (
                <ul className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
                  {group.samples.map((sample, index) => (
                    <li key={index} className="text-slate-700 dark:text-slate-300">
                      «{sample.question}»
                      <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                        — {sample.operator || 'оператор'}, {formatDate(sample.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
