'use client'

import { useRef, useState } from 'react'
import { FileUp, Loader2, X } from 'lucide-react'

type Company = { id: string; name: string }

type PreviewArticle = {
  key: string
  title: string
  category: string
  summary: string
  content: string
  severity: string
  requires_confirmation: boolean
  tags: string[]
  point: string | null
  company_id: string | null
}

type PreviewChecklist = {
  key: string
  title: string
  description: string
  schedule_type: string
  recurrence_minutes: number | null
  blocks_shift: boolean
  point: string | null
  company_id: string | null
  items: Array<{ title: string; answer_type: string; is_required: boolean; requires_photo: boolean }>
}

type Preview = {
  file_name: string
  chars: number
  chunks: number
  companies: Company[]
  articles: PreviewArticle[]
  checklists: PreviewChecklist[]
}

const SEVERITY_LABEL: Record<string, string> = {
  info: 'инфо',
  normal: 'обычное',
  warning: 'важное',
  critical: 'критичное',
}

const SCHEDULE_LABEL: Record<string, string> = {
  opening: 'открытие',
  periodic: 'обход',
  closing: 'закрытие',
  onboarding: 'онбординг',
  handover: 'пересменка',
}

/**
 * Импорт готового регламента в базу знаний.
 *
 * У клуба регламент обычно уже написан в Word, и переносить его руками — это
 * два-три часа копипаста. Здесь документ разбирается на статьи и чек-листы,
 * но ничего не пишется в базу, пока владелец не отметит, что публиковать:
 * модель ошибается, и разбор — это черновик, а не готовая правда.
 */
export default function ImportDocumentDialog({
  onApplied,
}: {
  onApplied: (data: unknown, summary: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [companyByKey, setCompanyByKey] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement | null>(null)

  function reset() {
    setPreview(null)
    setSelected({})
    setCompanyByKey({})
    setError(null)
  }

  async function parseFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/admin/knowledge/import', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось разобрать документ')

      const data = payload.data as Preview
      setPreview(data)
      const nextSelected: Record<string, boolean> = {}
      const nextCompanies: Record<string, string> = {}
      for (const article of data.articles) {
        nextSelected[article.key] = true
        nextCompanies[article.key] = article.company_id || ''
      }
      for (const checklist of data.checklists) {
        nextSelected[checklist.key] = true
        nextCompanies[checklist.key] = checklist.company_id || ''
      }
      setSelected(nextSelected)
      setCompanyByKey(nextCompanies)
    } catch (e: any) {
      setError(e?.message || 'Ошибка разбора')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const articles = preview.articles
        .filter((item) => selected[item.key])
        .map((item) => ({
          title: item.title,
          category: item.category,
          summary: item.summary,
          content: item.content,
          severity: item.severity,
          requires_confirmation: item.requires_confirmation,
          tags: item.tags,
          company_id: companyByKey[item.key] || null,
        }))
      const checklists = preview.checklists
        .filter((item) => selected[item.key])
        .map((item) => ({
          title: item.title,
          description: item.description,
          schedule_type: item.schedule_type,
          recurrence_minutes: item.recurrence_minutes,
          blocks_shift: item.blocks_shift,
          company_id: companyByKey[item.key] || null,
          items: item.items,
        }))

      if (!articles.length && !checklists.length) {
        throw new Error('Не отмечено ни одного материала')
      }

      const response = await fetch('/api/admin/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'applyImport', payload: { articles, checklists } }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось добавить материалы')

      const r = payload.result || {}
      const parts = [
        `статей: ${r.createdArticles || 0}`,
        `чек-листов: ${r.createdChecklists || 0}`,
        r.skippedArticles ? `пропущено дублей: ${r.skippedArticles}` : '',
      ].filter(Boolean)
      onApplied(payload.data, `Импорт завершён — ${parts.join(', ')}`)
      setOpen(false)
      reset()
    } catch (e: any) {
      setError(e?.message || 'Ошибка импорта')
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
      >
        <FileUp className="h-4 w-4" />
        Импорт документа
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Импорт регламента</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Загрузите готовый документ (.docx, .md или .txt). Система разберёт его на статьи и
                  чек-листы, а вы отметите, что публиковать.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:text-slate-900 dark:border-slate-700 dark:hover:text-slate-100"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
              {error && (
                <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
                  {error}
                </div>
              )}

              {!preview ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-900/40">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".docx,.md,.txt"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void parseFile(file)
                      event.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60 dark:bg-white dark:text-slate-900"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                    {busy ? 'Читаю документ…' : 'Выбрать файл'}
                  </button>
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Большой регламент разбирается частями — это занимает до пары минут.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                    <b>{preview.file_name}</b> — нашлось статей: {preview.articles.length}, чек-листов:{' '}
                    {preview.checklists.length}. Отмечено: {selectedCount}.
                  </div>

                  {preview.articles.length > 0 && (
                    <section>
                      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Статьи
                      </h3>
                      <div className="mt-2 space-y-2">
                        {preview.articles.map((item) => (
                          <label
                            key={item.key}
                            className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50"
                          >
                            <input
                              type="checkbox"
                              checked={!!selected[item.key]}
                              onChange={(event) =>
                                setSelected((prev) => ({ ...prev, [item.key]: event.target.checked }))
                              }
                              className="mt-1 h-4 w-4"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {item.category}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {SEVERITY_LABEL[item.severity] || item.severity}
                                </span>
                                {item.point ? (
                                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">
                                    точка: {item.point}
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                    общее
                                  </span>
                                )}
                                {item.requires_confirmation && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                                    нужно подтверждение
                                  </span>
                                )}
                              </div>
                              {item.summary && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.summary}</p>
                              )}
                              <select
                                value={companyByKey[item.key] || ''}
                                onChange={(event) =>
                                  setCompanyByKey((prev) => ({ ...prev, [item.key]: event.target.value }))
                                }
                                className="mt-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                              >
                                <option value="">Все точки</option>
                                {preview.companies.map((company) => (
                                  <option key={company.id} value={company.id}>
                                    {company.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </label>
                        ))}
                      </div>
                    </section>
                  )}

                  {preview.checklists.length > 0 && (
                    <section>
                      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Чек-листы
                      </h3>
                      <div className="mt-2 space-y-2">
                        {preview.checklists.map((item) => (
                          <label
                            key={item.key}
                            className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50"
                          >
                            <input
                              type="checkbox"
                              checked={!!selected[item.key]}
                              onChange={(event) =>
                                setSelected((prev) => ({ ...prev, [item.key]: event.target.checked }))
                              }
                              className="mt-1 h-4 w-4"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {SCHEDULE_LABEL[item.schedule_type] || item.schedule_type}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {item.items.length} пунктов
                                </span>
                                {item.point ? (
                                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">
                                    точка: {item.point}
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                    общее
                                  </span>
                                )}
                                {item.blocks_shift && (
                                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
                                    блокирует смену
                                  </span>
                                )}
                              </div>
                              {item.description && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.description}</p>
                              )}
                              <select
                                value={companyByKey[item.key] || ''}
                                onChange={(event) =>
                                  setCompanyByKey((prev) => ({ ...prev, [item.key]: event.target.value }))
                                }
                                className="mt-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                              >
                                <option value="">Все точки</option>
                                {preview.companies.map((company) => (
                                  <option key={company.id} value={company.id}>
                                    {company.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </label>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>

            {preview && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                >
                  Другой файл
                </button>
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={busy || selectedCount === 0}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Добавить в базу ({selectedCount})
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
