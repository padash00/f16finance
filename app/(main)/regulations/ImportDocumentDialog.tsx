'use client'

import { useRef, useState } from 'react'
import { FileUp, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

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
  exists: boolean
  existing_version: number | null
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [updateExisting, setUpdateExisting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function reset() {
    setPreview(null)
    setSelected({})
    setCompanyByKey({})
    setExpanded({})
    setError(null)
  }

  /**
   * Два шага: сервер сначала достаёт текст и режет его на части, потом каждая
   * часть разбирается отдельным запросом. Так виден прогресс, а длинный
   * регламент не упирается в таймаут одной функции.
   */
  async function parseFile(file: File) {
    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/admin/knowledge/import', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось прочитать документ')

      const chunks: string[] = payload.data?.chunks || []
      const companies: Company[] = payload.data?.companies || []
      const collectedArticles: PreviewArticle[] = []
      const collectedChecklists: PreviewChecklist[] = []
      const nextSelected: Record<string, boolean> = {}
      const nextCompanies: Record<string, string> = {}

      setProgress({ done: 0, total: chunks.length })

      for (let index = 0; index < chunks.length; index += 1) {
        const chunkResponse = await fetch('/api/admin/knowledge/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chunk: chunks[index], offset: index }),
        })
        const chunkPayload = await chunkResponse.json()
        if (!chunkResponse.ok) throw new Error(chunkPayload?.error || 'Не удалось разобрать фрагмент')

        for (const article of chunkPayload.data?.articles || []) {
          // Один и тот же раздел может попасть в два куска — берём первый.
          if (collectedArticles.some((row) => row.title.toLowerCase() === article.title.toLowerCase())) continue
          collectedArticles.push(article)
          nextSelected[article.key] = true
          nextCompanies[article.key] = article.company_id || ''
        }
        for (const checklist of chunkPayload.data?.checklists || []) {
          if (collectedChecklists.some((row) => row.title.toLowerCase() === checklist.title.toLowerCase())) continue
          collectedChecklists.push(checklist)
          nextSelected[checklist.key] = true
          nextCompanies[checklist.key] = checklist.company_id || ''
        }

        setProgress({ done: index + 1, total: chunks.length })
        setPreview({
          file_name: payload.data?.file_name || file.name,
          chars: payload.data?.chars || 0,
          companies,
          articles: [...collectedArticles],
          checklists: [...collectedChecklists],
        })
        setSelected({ ...nextSelected })
        setCompanyByKey({ ...nextCompanies })
      }

      if (!collectedArticles.length && !collectedChecklists.length) {
        throw new Error('В документе не нашлось материалов для базы знаний')
      }
    } catch (e: any) {
      setError(e?.message || 'Ошибка разбора')
    } finally {
      setBusy(false)
      setProgress(null)
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
        body: JSON.stringify({
          action: 'applyImport',
          payload: { articles, checklists, update_existing: updateExisting },
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось добавить материалы')

      const r = payload.result || {}
      const parts = [
        `создано статей: ${r.createdArticles || 0}`,
        r.updatedArticles ? `обновлено: ${r.updatedArticles}` : '',
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
  const existingCount = (preview?.articles || []).filter((item) => item.exists).length

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

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="!max-w-[900px] flex max-h-[88vh] flex-col gap-0 overflow-hidden border-slate-200 bg-card p-0 text-slate-900 dark:border-slate-800 dark:text-slate-100"
        >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div className="min-w-0">
                <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100">
                  Импорт регламента
                </DialogTitle>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Готовый документ .docx, .md или .txt разбирается на статьи и чек-листы. В базу
                  попадёт только то, что вы отметите.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground transition hover:border-slate-400 hover:text-slate-900 dark:hover:border-slate-500 dark:hover:text-slate-100"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {error && (
                <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
                  {error}
                </div>
              )}

              {!preview ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface-muted p-7 text-center">
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
                  <FileUp className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium text-foreground">Выберите файл регламента</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    .docx, .md, .txt · до 8 МБ. Большой документ разбирается частями — до пары минут.
                  </p>
                  <Button type="button" size="sm" disabled={busy} onClick={() => fileRef.current?.click()} className="mt-4">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                    {busy ? 'Разбираю…' : 'Выбрать файл'}
                  </Button>
                  {progress && (
                    <div className="mx-auto mt-4 max-w-sm">
                      <div className="h-1.5 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Разобрано {progress.done} из {progress.total} частей
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                    <b>{preview.file_name}</b> — нашлось статей: {preview.articles.length}, чек-листов:{' '}
                    {preview.checklists.length}. Отмечено: {selectedCount}.
                    {progress && progress.done < progress.total && (
                      <div className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Разбираю дальше: {progress.done} из {progress.total} частей
                      </div>
                    )}
                    {existingCount > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                        <span className="text-xs">
                          {existingCount} статей уже есть в базе — это новая редакция того же регламента?
                        </span>
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
                          <input
                            type="checkbox"
                            checked={updateExisting}
                            onChange={(event) => setUpdateExisting(event.target.checked)}
                            className="h-4 w-4"
                          />
                          Обновить их текстом из документа
                        </label>
                      </div>
                    )}
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
                              {item.exists && (
                                <span className="mt-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
                                  уже в базе, редакция {item.existing_version}
                                </span>
                              )}
                              {item.summary && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.summary}</p>
                              )}
                              {item.content && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
                                  }}
                                  className="mt-1 text-xs font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-300"
                                >
                                  {expanded[item.key] ? 'Скрыть текст' : 'Показать текст — проверить цифры'}
                                </button>
                              )}
                              {expanded[item.key] && (
                                <div
                                  className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300 [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_strong]:font-semibold [&_table]:my-1 [&_td]:border [&_td]:border-slate-200 [&_td]:px-1.5 [&_th]:border [&_th]:border-slate-200 [&_th]:px-1.5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                                  dangerouslySetInnerHTML={{ __html: item.content }}
                                />
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
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault()
                                  setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
                                }}
                                className="mt-1 text-xs font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-300"
                              >
                                {expanded[item.key] ? 'Скрыть пункты' : 'Показать пункты'}
                              </button>
                              {expanded[item.key] && (
                                <ol className="mt-2 list-decimal space-y-0.5 rounded-xl border border-slate-200 bg-slate-50 p-3 pl-7 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                                  {item.items.map((row, rowIndex) => (
                                    <li key={rowIndex}>
                                      {row.title}
                                      {row.requires_photo ? ' · фото' : ''}
                                    </li>
                                  ))}
                                </ol>
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
                <Button type="button" variant="outline" size="sm" onClick={reset}>
                  Другой файл
                </Button>
                <Button type="button" size="sm" onClick={() => void apply()} disabled={busy || selectedCount === 0}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Добавить в базу ({selectedCount})
                </Button>
              </div>
            )}
        </DialogContent>
      </Dialog>
    </>
  )
}
