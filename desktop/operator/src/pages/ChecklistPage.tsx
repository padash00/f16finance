'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Camera,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Coins,
  ImagePlus,
  LogOut,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import * as api from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { toastError, toastSuccess } from '@/lib/toast'
import type {
  AppConfig,
  BootstrapData,
  OperatorSession,
  PointChecklistAnswer,
  PointChecklistItem,
  PointChecklistRun,
  PointChecklistTemplate,
  PointKnowledgeArticle,
  PointKnowledgeContext,
} from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onBackToShift: () => void
  onLogout: () => void
}

const SCHEDULE_LABELS: Record<string, string> = {
  opening: 'Открытие',
  periodic: 'Обход',
  closing: 'Закрытие',
  onboarding: 'Онбординг',
  handover: 'Передача',
}

const SEVERITY_LABELS: Record<string, string> = {
  info: 'Инфо',
  normal: 'Обычно',
  warning: 'Важно',
  critical: 'Критично',
}

function isAnswered(item: PointChecklistItem, answer: PointChecklistAnswer | undefined) {
  if (!answer) return false
  if ((item.requires_photo || item.answer_type === 'photo') && !answer.photo_data_url) return false
  if (item.answer_type === 'boolean') return typeof answer.passed === 'boolean'
  return String(answer.value ?? answer.note ?? '').trim().length > 0
}

function isFailedAnswer(answer: PointChecklistAnswer | undefined) {
  return answer?.passed === false || answer?.value === false
}

function money(value: number | null | undefined) {
  return formatMoney(Number(value || 0))
}

function isTemplateDue(template: PointChecklistTemplate, runs: PointChecklistRun[]) {
  if (template.schedule_type === 'onboarding') {
    return !runs.some((run) => run.template_id === template.id && run.status === 'completed')
  }
  if (template.schedule_type === 'periodic') {
    const recurrenceMs = Number(template.recurrence_minutes || 0) * 60_000
    if (recurrenceMs <= 0) return false
    const completedRuns = runs
      .filter((run) => run.template_id === template.id && run.status === 'completed' && run.completed_at)
      .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
    if (completedRuns.length === 0) return true
    const lastCompletedAt = new Date(String(completedRuns[0].completed_at)).getTime()
    return Number.isFinite(lastCompletedAt) && Date.now() - lastCompletedAt >= recurrenceMs
  }
  if (template.blocks_shift) {
    return !runs.some((run) => run.template_id === template.id && run.status === 'completed')
  }
  return false
}

function resizePhotoToDataUrl(file: File, maxSize = 1280, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать фото'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Файл не похож на изображение'))
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Не удалось подготовить фото'))
          return
        }
        context.drawImage(image, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      image.src = String(reader.result || '')
    }
    reader.readAsDataURL(file)
  })
}

export default function ChecklistPage({
  config,
  session,
  onBackToShift,
  onLogout,
}: Props) {
  const [context, setContext] = useState<PointKnowledgeContext | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [responses, setResponses] = useState<Record<string, PointChecklistAnswer>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentItemIndex, setCurrentItemIndex] = useState(0)

  const templates = context?.checklist_templates || []
  const runs = context?.checklist_runs || []
  const articles = context?.articles || []
  const pendingConfirmations = context?.pending_confirmations || []
  const orderedTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      const aDue = isTemplateDue(a, runs)
      const bDue = isTemplateDue(b, runs)
      if (aDue !== bDue) return aDue ? -1 : 1
      return a.sort_order - b.sort_order
    })
  }, [runs, templates])

  const articleById = useMemo(() => {
    return new Map(articles.map((article) => [article.id, article]))
  }, [articles])

  const itemsByTemplate = useMemo(() => {
    const map = new Map<string, PointChecklistItem[]>()
    for (const item of context?.checklist_items || []) {
      const list = map.get(item.template_id) || []
      list.push(item)
      map.set(item.template_id, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order)
    }
    return map
  }, [context?.checklist_items])

  const runByTemplate = useMemo(() => {
    const map = new Map<string, PointChecklistRun>()
    for (const run of runs) {
      if (!map.has(run.template_id) || run.status === 'in_progress') {
        map.set(run.template_id, run)
      }
    }
    return map
  }, [runs])

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || templates[0] || null
  const selectedItems = selectedTemplate ? itemsByTemplate.get(selectedTemplate.id) || [] : []
  const activeRun = activeRunId
    ? runs.find((run) => run.id === activeRunId) || null
    : selectedTemplate
      ? runByTemplate.get(selectedTemplate.id) || null
      : null

  const answeredCount = selectedItems.filter((item) => isAnswered(item, responses[item.id])).length
  const requiredMissing = selectedItems.filter((item) => item.is_required && !isAnswered(item, responses[item.id]))
  const currentItem = selectedItems[Math.min(currentItemIndex, Math.max(selectedItems.length - 1, 0))] || null
  const currentAnswer = currentItem ? responses[currentItem.id] : undefined
  const currentItemAnswered = currentItem ? isAnswered(currentItem, currentAnswer) : false
  const progressPercent = selectedItems.length > 0 ? Math.round((answeredCount / selectedItems.length) * 100) : 0
  const failedCount = selectedItems.filter((item) => isFailedAnswer(responses[item.id])).length
  const potentialFine = selectedItems.reduce((sum, item) => {
    if (!isFailedAnswer(responses[item.id])) return sum
    return sum + Number(item.fine_amount || 0)
  }, 0)
  const potentialBonus = selectedItems.reduce((sum, item) => {
    const answer = responses[item.id]
    if (!(answer?.passed === true || answer?.value === true)) return sum
    return sum + Number(item.bonus_amount || 0)
  }, 0)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPointKnowledge(config, session)
      setContext(data)
      const firstTemplateId =
        selectedTemplateId ||
        [...data.checklist_templates].sort((a, b) => {
          const aDue = isTemplateDue(a, data.checklist_runs || [])
          const bDue = isTemplateDue(b, data.checklist_runs || [])
          if (aDue !== bDue) return aDue ? -1 : 1
          return a.sort_order - b.sort_order
        })[0]?.id ||
        null
      setSelectedTemplateId(firstTemplateId)
      const run = firstTemplateId ? data.checklist_runs.find((item) => item.template_id === firstTemplateId) : null
      setActiveRunId(run?.id || null)
      setResponses((run?.responses || {}) as Record<string, PointChecklistAnswer>)
      setCurrentItemIndex(0)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить чек-листы')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, session.operator.operator_id, session.company.id])

  useEffect(() => {
    setCurrentItemIndex((index) => Math.min(index, Math.max(selectedItems.length - 1, 0)))
  }, [selectedItems.length])

  function selectTemplate(template: PointChecklistTemplate) {
    const run = runByTemplate.get(template.id)
    setSelectedTemplateId(template.id)
    setActiveRunId(run?.id || null)
    setResponses((run?.responses || {}) as Record<string, PointChecklistAnswer>)
    setCurrentItemIndex(0)
    setError(null)
  }

  function setAnswer(itemId: string, patch: PointChecklistAnswer) {
    setResponses((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] || {}),
        ...patch,
      },
    }))
  }

  function goToNextUnanswered() {
    if (selectedItems.length === 0) return
    const nextIndex = selectedItems.findIndex((item, index) => index > currentItemIndex && !isAnswered(item, responses[item.id]))
    if (nextIndex >= 0) {
      setCurrentItemIndex(nextIndex)
      return
    }
    setCurrentItemIndex(Math.min(currentItemIndex + 1, selectedItems.length - 1))
  }

  async function ensureRun() {
    if (!selectedTemplate) throw new Error('Выберите чек-лист')
    if (!context?.open_shift) throw new Error('Откройте смену перед прохождением чек-листа')
    if (activeRun?.status === 'in_progress') return activeRun.id

    const result = await api.startPointChecklistRun(config, session, selectedTemplate.id)
    setActiveRunId(result.run_id)
    await load()
    return result.run_id
  }

  async function handleStart() {
    setSaving(true)
    setError(null)
    try {
      await ensureRun()
      toastSuccess('Чек-лист начат')
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : 'Не удалось начать чек-лист'
      setError(message)
      toastError(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const runId = await ensureRun()
      await api.updatePointChecklistRun(config, session, runId, responses)
      toastSuccess('Ответы сохранены')
      await load()
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Не удалось сохранить ответы'
      setError(message)
      toastError(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    if (requiredMissing.length > 0) {
      const message = `Заполните обязательные пункты: ${requiredMissing.length}`
      setError(message)
      toastError(message)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const runId = await ensureRun()
      const result = await api.completePointChecklistRun(config, session, runId, responses, 'completed')
      toastSuccess(`Чек-лист завершён: штраф ${money(result.fines_total)}, бонус ${money(result.bonuses_total)}`)
      await load()
    } catch (completeError) {
      const message = completeError instanceof Error ? completeError.message : 'Не удалось завершить чек-лист'
      setError(message)
      toastError(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmArticle(article: PointKnowledgeArticle) {
    setSaving(true)
    setError(null)
    try {
      await api.confirmPointKnowledgeArticle(config, session, article.id)
      toastSuccess(`Ознакомление подтверждено: ${article.title}`)
      await load()
    } catch (confirmError) {
      const message = confirmError instanceof Error ? confirmError.message : 'Не удалось подтвердить ознакомление'
      setError(message)
      toastError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="h-9 shrink-0 drag-region bg-card" />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-5 py-3 no-drag">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onBackToShift}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            К смене
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">{session.company.name}</p>
            <p className="text-xs text-muted-foreground">
              Чек-листы смены · {session.operator.full_name || session.operator.name || session.operator.username}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading || saving}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Выйти
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <Card className="border-white/10 bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  Сценарии
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {loading ? (
                  <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-muted-foreground">
                    Загружаем чек-листы...
                  </p>
                ) : null}
                {!loading && templates.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 bg-black/20 p-3 text-sm text-muted-foreground">
                    Для этой точки пока нет активных чек-листов.
                  </p>
                ) : null}
                {orderedTemplates.map((template) => {
                  const run = runByTemplate.get(template.id)
                  const items = itemsByTemplate.get(template.id) || []
                  const active = selectedTemplate?.id === template.id
                  const due = isTemplateDue(template, runs)
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => selectTemplate(template)}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        active
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-white/10 bg-black/20 hover:border-primary/25'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{template.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{items.length} пунктов</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {due ? <Badge variant="destructive">Нужно пройти</Badge> : null}
                          <Badge variant={run?.status === 'completed' ? 'default' : 'secondary'}>
                            {run?.status === 'completed'
                              ? 'Готово'
                              : run?.status === 'in_progress'
                                ? 'В работе'
                                : SCHEDULE_LABELS[template.schedule_type] || template.schedule_type}
                          </Badge>
                        </div>
                      </div>
                      {template.description ? (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {template.description}
                        </p>
                      ) : null}
                    </button>
                  )
                })}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Сводка</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <SummaryRow label="Открытая смена" value={context?.open_shift ? 'есть' : 'нет'} tone={context?.open_shift ? 'success' : 'danger'} />
                <SummaryRow label="Пунктов заполнено" value={`${answeredCount}/${selectedItems.length}`} />
                <SummaryRow label="Проблемных пунктов" value={String(failedCount)} tone={failedCount ? 'danger' : 'success'} />
                <SummaryRow label="Потенц. штраф" value={money(potentialFine)} tone={potentialFine ? 'danger' : 'neutral'} />
                <SummaryRow label="Потенц. бонус" value={money(potentialBonus)} tone={potentialBonus ? 'success' : 'neutral'} />
              </CardContent>
            </Card>
          </aside>

          <section className="min-w-0 space-y-4">
            {error ? (
              <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}

            {pendingConfirmations.length > 0 ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <p className="flex items-center gap-2 font-semibold">
                      <ShieldAlert className="h-4 w-4" />
                      Нужно подтвердить правила
                    </p>
                    <p className="mt-1 text-sm text-amber-100/75">
                      Перед работой оператор должен отметить, что ознакомился с правилами, штрафами, бонусами и FAQ.
                    </p>
                  </div>
                  <Badge variant="secondary">{pendingConfirmations.length} материала</Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  {pendingConfirmations.slice(0, 4).map((article) => (
                    <div
                      key={article.id}
                      className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{article.title}</p>
                        <p className="line-clamp-2 text-xs text-amber-100/65">
                          {article.summary || 'Материал требует подтверждения текущей версии.'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() => void handleConfirmArticle(article)}
                      >
                        Подтвердить
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedTemplate ? (
              <Card className="border-white/10 bg-card/90">
                <CardHeader className="border-b border-white/10">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <Badge>{SCHEDULE_LABELS[selectedTemplate.schedule_type] || selectedTemplate.schedule_type}</Badge>
                        {selectedTemplate.blocks_shift ? <Badge variant="destructive">Блокирует смену</Badge> : null}
                        {activeRun?.status ? <Badge variant="secondary">{activeRun.status}</Badge> : null}
                      </div>
                      <CardTitle className="mt-3 break-words text-2xl">{selectedTemplate.title}</CardTitle>
                      <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                        {selectedTemplate.description || 'Пройдите пункты и сохраните результат смены.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!activeRun || activeRun.status !== 'in_progress' ? (
                        <Button type="button" onClick={handleStart} disabled={saving || !context?.open_shift}>
                          <ClipboardCheck className="mr-2 h-4 w-4" />
                          Начать
                        </Button>
                      ) : (
                        <>
                          <Button type="button" variant="outline" onClick={handleSave} disabled={saving}>
                            <Save className="mr-2 h-4 w-4" />
                            Сохранить
                          </Button>
                          <Button type="button" onClick={handleComplete} disabled={saving || selectedItems.length === 0}>
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Завершить
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-5">
                  {selectedItems.length > 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Пошаговый режим
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Пункт {Math.min(currentItemIndex + 1, selectedItems.length)} из {selectedItems.length} · {progressPercent}% готово
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={currentItemIndex <= 0}
                            onClick={() => setCurrentItemIndex((index) => Math.max(index - 1, 0))}
                          >
                            <ChevronLeft className="mr-1 h-4 w-4" />
                            Назад
                          </Button>
                          <Button
                            type="button"
                            variant={currentItemAnswered ? 'default' : 'outline'}
                            size="sm"
                            disabled={currentItemIndex >= selectedItems.length - 1}
                            onClick={goToNextUnanswered}
                          >
                            Дальше
                            <ChevronRight className="ml-1 h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedItems.map((item, index) => {
                          const answered = isAnswered(item, responses[item.id])
                          const failed = isFailedAnswer(responses[item.id])
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setCurrentItemIndex(index)}
                              className={`grid h-8 w-8 place-items-center rounded-full border text-xs font-bold transition ${
                                index === currentItemIndex
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : failed
                                    ? 'border-rose-400/40 bg-rose-500/15 text-rose-200'
                                    : answered
                                      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                                      : 'border-white/10 bg-white/5 text-muted-foreground'
                              }`}
                              aria-label={`Пункт ${index + 1}`}
                            >
                              {index + 1}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}

                  {currentItem ? (
                    <ChecklistItemCard
                      key={currentItem.id}
                      item={currentItem}
                      index={currentItemIndex}
                      answer={responses[currentItem.id]}
                      linkedArticle={currentItem.knowledge_article_id ? articleById.get(currentItem.knowledge_article_id) : undefined}
                      disabled={activeRun?.status === 'completed'}
                      onChange={(patch) => setAnswer(currentItem.id, patch)}
                    />
                  ) : null}

                  {currentItem ? (
                    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        {currentItemAnswered
                          ? 'Пункт заполнен. Можно перейти дальше или завершить чек-лист.'
                          : 'Заполните текущий пункт: отметка, комментарий и фото, если оно требуется.'}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={currentItemIndex <= 0}
                          onClick={() => setCurrentItemIndex((index) => Math.max(index - 1, 0))}
                        >
                          Назад
                        </Button>
                        <Button
                          type="button"
                          disabled={currentItemIndex >= selectedItems.length - 1}
                          onClick={goToNextUnanswered}
                        >
                          Следующий пункт
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {!selectedItems.length ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-muted-foreground">
                      В этом сценарии пока нет пунктов. Добавьте пункты в админке базы знаний.
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'success' | 'danger'
}) {
  const valueClass =
    tone === 'success'
      ? 'text-emerald-300'
      : tone === 'danger'
        ? 'text-rose-300'
        : 'text-foreground'
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${valueClass}`}>{value}</span>
    </div>
  )
}

function ChecklistItemCard({
  item,
  index,
  answer,
  linkedArticle,
  disabled,
  onChange,
}: {
  item: PointChecklistItem
  index: number
  answer?: PointChecklistAnswer
  linkedArticle?: PointKnowledgeArticle
  disabled?: boolean
  onChange: (patch: PointChecklistAnswer) => void
}) {
  const answered = isAnswered(item, answer)
  const failed = isFailedAnswer(answer)
  const needsPhoto = item.requires_photo || item.answer_type === 'photo'
  const photoInputId = `checklist-photo-${item.id}`

  async function handlePhotoFile(file: File | undefined) {
    if (!file) return
    try {
      const dataUrl = await resizePhotoToDataUrl(file)
      onChange({
        photo_data_url: dataUrl,
        photo_name: file.name,
        photo_captured_at: new Date().toISOString(),
        value: item.answer_type === 'photo' ? 'photo_attached' : answer?.value,
      })
    } catch (photoError) {
      toastError(photoError instanceof Error ? photoError.message : 'Не удалось прикрепить фото')
    }
  }

  return (
    <div className={`rounded-2xl border p-4 ${failed ? 'border-rose-500/30 bg-rose-500/10' : 'border-white/10 bg-black/20'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {index + 1}
            </span>
            <h3 className="break-words text-base font-semibold">{item.title}</h3>
            {item.is_required ? <Badge variant="secondary">обязательно</Badge> : null}
            {item.requires_photo || item.answer_type === 'photo' ? (
              <Badge variant="secondary">
                <Camera className="mr-1 h-3 w-3" />
                фото
              </Badge>
            ) : null}
            <Badge variant={item.severity === 'critical' || item.severity === 'warning' ? 'destructive' : 'secondary'}>
              {SEVERITY_LABELS[item.severity] || item.severity}
            </Badge>
          </div>
          {item.description ? (
            <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">{item.description}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {Number(item.fine_amount || 0) > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-rose-200">
                <ShieldAlert className="h-3 w-3" />
                штраф {money(item.fine_amount)}
              </span>
            ) : null}
            {Number(item.bonus_amount || 0) > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                <Coins className="h-3 w-3" />
                бонус {money(item.bonus_amount)}
              </span>
            ) : null}
            {linkedArticle ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-sky-200">
                FAQ: {linkedArticle.title}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {answered ? (
            <Badge variant={failed ? 'destructive' : 'default'}>
              {failed ? <XCircle className="mr-1 h-3 w-3" /> : <BadgeCheck className="mr-1 h-3 w-3" />}
              {failed ? 'Проблема' : 'Ок'}
            </Badge>
          ) : (
            <Badge variant="secondary">Не заполнено</Badge>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {item.answer_type === 'boolean' ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={answer?.passed === true ? 'default' : 'outline'}
              disabled={disabled}
              onClick={() => onChange({ passed: true, value: true })}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Выполнено
            </Button>
            <Button
              type="button"
              variant={answer?.passed === false ? 'destructive' : 'outline'}
              disabled={disabled}
              onClick={() => onChange({ passed: false, value: false })}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Проблема
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              {item.answer_type === 'number'
                ? 'Число'
                : item.answer_type === 'photo'
                  ? 'Фото/ссылка/комментарий'
                  : 'Ответ'}
            </Label>
            <Input
              type={item.answer_type === 'number' ? 'number' : 'text'}
              disabled={disabled}
              value={String(answer?.value ?? '')}
              onChange={(event) => onChange({ value: event.target.value })}
              placeholder={item.answer_type === 'photo' ? 'Ссылка на фото или короткая отметка' : 'Введите ответ'}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Комментарий</Label>
          <textarea
            disabled={disabled}
            value={String(answer?.note ?? '')}
            onChange={(event) => onChange({ note: event.target.value })}
            placeholder="Что именно проверили, какая проблема, кому сообщили..."
            className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-primary disabled:opacity-60"
          />
        </div>
      </div>

      {needsPhoto ? (
        <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-sky-100">
                <Camera className="h-4 w-4" />
                Фото-доказательство
              </p>
              <p className="mt-1 text-xs leading-5 text-sky-100/70">
                Прикрепите фото проверки. Оно сохраняется в ответе чек-листа вместе со временем фиксации.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                id={photoInputId}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={disabled}
                onChange={(event) => void handlePhotoFile(event.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => document.getElementById(photoInputId)?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                {answer?.photo_data_url ? 'Заменить фото' : 'Добавить фото'}
              </Button>
              {answer?.photo_data_url ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      photo_data_url: null,
                      photo_name: null,
                      photo_captured_at: null,
                      value: item.answer_type === 'photo' ? null : answer?.value,
                    })
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Убрать
                </Button>
              ) : null}
            </div>
          </div>
          {answer?.photo_data_url ? (
            <div className="mt-3 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)] md:items-center">
              <img
                src={answer.photo_data_url}
                alt="Фото проверки"
                className="h-28 w-full rounded-xl border border-white/10 object-cover"
              />
              <div className="text-xs leading-5 text-sky-100/75">
                <p className="font-medium text-sky-100">{answer.photo_name || 'Фото прикреплено'}</p>
                <p>
                  Время: {answer.photo_captured_at ? new Date(answer.photo_captured_at).toLocaleString('ru-RU') : 'только что'}
                </p>
                <p>Если есть проблема, ниже напишите короткий комментарий для руководителя.</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-sky-300/20 bg-black/20 px-3 py-2 text-xs text-sky-100/70">
              Фото пока не прикреплено. Для обязательного фото чек-лист нельзя завершить без снимка.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
