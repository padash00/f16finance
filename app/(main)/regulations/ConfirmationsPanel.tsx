'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldQuestion } from 'lucide-react'

type Article = {
  id: string
  title: string
  slug: string
  version: number
  severity: string
  requires_confirmation: boolean
  is_published: boolean
}

type Confirmation = {
  article_id: string
  article_version: number
  staff_id: string
  confirmed_at: string
}

type Staff = {
  id: string
  full_name: string | null
  short_name: string | null
  role: string | null
}

function staffName(person: Staff) {
  return (person.short_name || person.full_name || '').trim() || 'Без имени'
}

/**
 * Кто прочитал обязательные правила.
 *
 * Подтверждения привязаны к версии статьи: правка текста поднимает версию, и
 * подтверждение старой редакции больше не считается. Иначе «ознакомлен» год
 * назад закрывало бы правило, которое с тех пор переписали дважды.
 */
export default function ConfirmationsPanel() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [confirmations, setConfirmations] = useState<Confirmation[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [onlyPending, setOnlyPending] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/knowledge/confirmations', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.detail || payload?.error || 'Не удалось загрузить статусы')
      setArticles(payload.data?.articles || [])
      setConfirmations(payload.data?.confirmations || [])
      setStaff(payload.data?.staff || [])
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Подтверждения считаются только по текущей версии статьи. */
  const confirmedKeys = useMemo(() => {
    const versionByArticle = new Map(articles.map((article) => [article.id, Number(article.version || 1)]))
    const set = new Set<string>()
    for (const row of confirmations) {
      if (Number(row.article_version) !== versionByArticle.get(row.article_id)) continue
      set.add(`${row.article_id}:${row.staff_id}`)
    }
    return set
  }, [articles, confirmations])

  const rows = useMemo(() => {
    return articles.map((article) => {
      const pending = staff.filter((person) => !confirmedKeys.has(`${article.id}:${person.id}`))
      return { article, pending, confirmed: staff.length - pending.length }
    })
  }, [articles, staff, confirmedKeys])

  const visibleRows = onlyPending ? rows.filter((row) => row.pending.length > 0) : rows
  const totalPending = rows.reduce((sum, row) => sum + row.pending.length, 0)

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаю статусы подтверждений…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex items-center gap-2 text-sm">
          {totalPending > 0 ? (
            <>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-slate-700 dark:text-slate-200">
                Не подтверждено: <b>{totalPending}</b> из {articles.length * staff.length} по {staff.length}{' '}
                сотрудникам
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-slate-700 dark:text-slate-200">Все обязательные правила подтверждены</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(event) => setOnlyPending(event.target.checked)}
              className="h-4 w-4"
            />
            Только с долгами
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Обновить
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {articles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
          Нет опубликованных статей с флагом «требует подтверждения». Поставьте его тем правилам, на
          которые вы будете ссылаться в спорной ситуации.
        </div>
      ) : staff.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
          В организации нет активных сотрудников — подтверждать некому.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRows.map(({ article, pending, confirmed }) => (
            <article
              key={article.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/50"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{article.title}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Редакция {article.version}
                    {article.severity === 'critical' ? ' · критичное правило' : ''}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    pending.length === 0
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200'
                  }`}
                >
                  {confirmed} из {staff.length} подтвердили
                </span>
              </div>

              {pending.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Не подтвердили
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pending.map((person) => (
                      <span
                        key={person.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                      >
                        {staffName(person)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}

          {visibleRows.length === 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
              <ShieldQuestion className="h-4 w-4" />
              Долгов нет — снимите галочку «Только с долгами», чтобы увидеть все правила.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
