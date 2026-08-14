'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, GraduationCap, Info, Loader2, RefreshCw, Send, XCircle } from 'lucide-react'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageSkeleton } from '@/components/skeleton'
import { useCapabilities } from '@/lib/client/use-capabilities'

type Company = { id: string; name: string; code: string | null }
type Operator = { id: string; name: string; telegram_chat_id: string | null; company_ids: string[] }

type ExamRow = {
  id: string
  title: string
  company_ids: string[]
  question_count: number
  pass_score: number
  deadline_at: string | null
  status: 'draft' | 'active' | 'finished' | 'cancelled'
  open_count: number
  created_at: string
  assigned: number
  completed: number
  passed: number
  avg_score: number | null
}

type OpenAnswerView = {
  index: number
  question: string
  rubric: string[]
  article_title: string
  max: number
  answer: {
    text: string
    score: number
    max: number
    justification: string
    citation: string
    overridden?: boolean
    override_comment?: string | null
  } | null
}

type DraftQuestion = {
  index: number
  pool: 'choice' | 'open'
  q: string
  choices?: string[]
  correct?: number
  rubric?: string[]
  article_title: string
}

type AttemptRow = {
  id: string
  operator_id: string
  operator_name: string
  status: 'pending' | 'sent' | 'in_progress' | 'completed' | 'expired' | 'undeliverable'
  score: number | null
  passed: boolean | null
  correct_answers: number
  total_questions: number
  current_index: number
  delivery_error: string | null
  sent_at: string | null
  completed_at: string | null
  manual_override: boolean
  open_answers: OpenAnswerView[]
}

const STATUS_LABELS: Record<AttemptRow['status'], { label: string; tone: string }> = {
  pending: { label: 'В очереди', tone: 'text-slate-500' },
  sent: { label: 'Отправлен', tone: 'text-sky-600 dark:text-sky-300' },
  in_progress: { label: 'Отвечает', tone: 'text-amber-600 dark:text-amber-300' },
  completed: { label: 'Завершён', tone: 'text-emerald-600 dark:text-emerald-300' },
  expired: { label: 'Просрочен', tone: 'text-rose-600 dark:text-rose-300' },
  undeliverable: { label: 'Не доставлен', tone: 'text-rose-600 dark:text-rose-300' },
}

const dt = (value: string | null) =>
  value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

type Readiness = {
  pointsTotal: number
  pointsWithIndustry: number
  publishedArticles: number
  operatorsWithTelegram: number
  operatorsTotal: number
}

/**
 * Цепочка «ниша → регламенты → телеграм → экзамен» с живым статусом.
 *
 * Без неё «в базе знаний меньше 3 статей» вылезает уже при отправке экзамена,
 * когда владелец успел заполнить всю форму.
 */
function ReadinessGuide({ readiness }: { readiness: Readiness }) {
  const steps = [
    {
      done: readiness.pointsWithIndustry > 0,
      title: 'Задайте нишу точки',
      detail: `${readiness.pointsWithIndustry} из ${readiness.pointsTotal} точек`,
      hint: 'От ниши зависит, какие темы вообще должны быть закрыты',
      href: '/regulations/setup',
      linkLabel: 'Настройка базы знаний',
    },
    {
      done: readiness.publishedArticles >= 3,
      title: 'Опубликуйте регламенты',
      detail: `${readiness.publishedArticles} опубликовано, нужно минимум 3`,
      hint: 'Вопросы собираются только из опубликованных статей, черновики не считаются',
      href: '/regulations',
      linkLabel: 'База знаний',
    },
    {
      done: readiness.operatorsWithTelegram > 0,
      title: 'Укажите операторам Telegram',
      detail: `${readiness.operatorsWithTelegram} из ${readiness.operatorsTotal} с чатом`,
      hint: 'Без chat ID экзамен не доставится',
      href: '/hr',
      linkLabel: 'Сотрудники',
    },
  ]

  const ready = steps.every((step) => step.done)

  return (
    <Card className={`p-4 ${ready ? '' : 'border-amber-400/40'}`}>
      <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Info className="h-4 w-4 text-sky-500" />
        {ready ? 'Всё готово — можно назначать экзамен' : 'Чтобы назначить экзамен, нужно три вещи'}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {steps.map((step, index) => (
          <div
            key={step.title}
            className={`rounded-xl border p-3 ${
              step.done ? 'border-emerald-400/40 bg-emerald-500/[0.06]' : 'border-border bg-surface-muted'
            }`}
          >
            <div className="flex items-center gap-2">
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-400/30 text-[10px] font-bold text-body">
                  {index + 1}
                </span>
              )}
              <span className="text-xs font-medium text-foreground">{step.title}</span>
            </div>
            <div className="mt-1 text-[11px] text-body">{step.detail}</div>
            <div className="text-[11px] text-muted-foreground">{step.hint}</div>
            {!step.done && (
              <Link href={step.href} className="mt-1 inline-block text-[11px] text-sky-600 underline dark:text-sky-300">
                {step.linkLabel} →
              </Link>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * Развёрнутый ответ с оценкой ИИ. Обоснование и цитата из регламента показаны
 * рядом с баллом: без них спор с оценкой невозможен, а спорить будут.
 */
function OpenAnswerCard({
  item,
  canGrade,
  busy,
  onOverride,
}: {
  item: OpenAnswerView
  canGrade: boolean
  busy: boolean
  onOverride: (score: number, comment: string) => void
}) {
  const [score, setScore] = useState(item.answer?.score ?? 0)
  const [comment, setComment] = useState('')

  if (!item.answer) {
    return (
      <div className="rounded-xl border border-border bg-white p-3 text-xs text-muted-foreground dark:bg-slate-950/40">
        <div className="font-medium text-body">{item.question}</div>
        <div className="mt-1">Ответа пока нет</div>
      </div>
    )
  }

  const changed = score !== item.answer.score

  return (
    <div className="rounded-xl border border-border bg-white p-3 dark:bg-slate-950/40">
      <div className="text-xs font-medium text-foreground">{item.question}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">по регламенту «{item.article_title}»</div>

      <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-100 p-2.5 text-xs text-body dark:bg-white/5">
        {item.answer.text}
      </div>

      <div className="mt-2 grid gap-1 text-[11px]">
        <div className="text-body">
          <b>Оценка ИИ:</b> {item.answer.score} из {item.answer.max}
          {item.answer.overridden && <span className="ml-1 text-amber-600 dark:text-amber-300">· правил владелец</span>}
        </div>
        {item.answer.justification && <div className="text-muted-foreground">{item.answer.justification}</div>}
        {item.answer.citation && (
          <div className="border-l-2 border-emerald-400/50 pl-2 italic text-muted-foreground">
            «{item.answer.citation}»
          </div>
        )}
        {item.rubric.length > 0 && (
          <div className="text-muted-foreground">Рубрика: {item.rubric.join(' · ')}</div>
        )}
      </div>

      {canGrade && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            max={item.max}
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            className="w-16 rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground dark:bg-slate-950/50"
          />
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Почему меняете балл"
            className="min-w-[200px] flex-1 rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground dark:bg-slate-950/50"
          />
          <Button size="sm" variant="outline" disabled={!changed || busy} onClick={() => onOverride(score, comment)}>
            Поставить балл
          </Button>
        </div>
      )}
    </div>
  )
}

export default function OperatorExamsPage() {
  const { can } = useCapabilities()
  const [loading, setLoading] = useState(true)
  // Скелетон только при первом заходе. Иначе любое действие (создать, напомнить,
  // поставить балл) дёргает load() и вся страница мигает пустым каркасом —
  // выглядит как перезагрузка.
  const [firstLoad, setFirstLoad] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [exams, setExams] = useState<ExamRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [readiness, setReadiness] = useState<Readiness | null>(null)

  const [openForm, setOpenForm] = useState(false)
  const [title, setTitle] = useState('')
  const [companyIds, setCompanyIds] = useState<string[]>([])
  const [operatorIds, setOperatorIds] = useState<string[]>([])
  const [questionCount, setQuestionCount] = useState(10)
  const [openCount, setOpenCount] = useState(2)
  const [passScore, setPassScore] = useState(70)
  const [deadline, setDeadline] = useState('')
  const [expandedAttempt, setExpandedAttempt] = useState<string | null>(null)

  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  const [draftQuestions, setDraftQuestions] = useState<DraftQuestion[]>([])
  const [draftOpen, setDraftOpen] = useState<DraftQuestion[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/operator-exams', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setExams(body.data?.exams || [])
      setCompanies(body.data?.companies || [])
      setOperators(body.data?.operators || [])
      setReadiness(body.data?.readiness || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
      setFirstLoad(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const loadDetails = useCallback(async (examId: string) => {
    setDetailsLoading(true)
    try {
      const res = await fetch(`/api/admin/operator-exams?id=${examId}`, { cache: 'no-store' })
      const body = await res.json()
      if (res.ok) {
        setAttempts(body.data?.attempts || [])
        setDraftQuestions(body.data?.draftQuestions || [])
        setDraftOpen(body.data?.draftOpenQuestions || [])
      }
    } finally {
      setDetailsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (detailsId) loadDetails(detailsId)
  }, [detailsId, loadDetails])

  // Операторы отфильтрованы по выбранным точкам: экзамен по регламенту точки
  // имеет смысл только для того, кто на ней работает.
  const eligibleOperators = useMemo(() => {
    if (companyIds.length === 0) return []
    return operators.filter((op) => op.company_ids.some((id) => companyIds.includes(id)))
  }, [operators, companyIds])

  // Снимаем выбор с тех, кто выпал после смены точек.
  useEffect(() => {
    const allowed = new Set(eligibleOperators.map((o) => o.id))
    setOperatorIds((prev) => prev.filter((id) => allowed.has(id)))
  }, [eligibleOperators])

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || '—'

  async function createExam() {
    if (!title.trim()) return alert('Укажите название экзамена')
    if (companyIds.length === 0) return alert('Выберите точки')
    if (operatorIds.length === 0) return alert('Выберите операторов')

    setBusy(true)
    try {
      const res = await fetch('/api/admin/operator-exams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: title.trim(),
          company_ids: companyIds,
          operator_ids: operatorIds,
          question_count: questionCount,
          open_count: openCount,
          pass_score: passScore,
          deadline_at: deadline ? new Date(deadline).toISOString() : null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)

      alert(
        `Черновик готов.\nВопросов: ${body.data?.questions} тестовых` +
          (body.data?.open ? ` + ${body.data.open} ситуационных` : '') +
          `\n\nПрочитайте их и нажмите «Разослать».`,
      )
      setDetailsId(body.data?.exam_id || null)
      setOpenForm(false)
      setTitle('')
      setCompanyIds([])
      setOperatorIds([])
      await load()
    } catch (e: any) {
      alert(`Ошибка: ${e?.message || 'не удалось создать'}`)
    } finally {
      setBusy(false)
    }
  }

  async function runAction(action: 'remind' | 'finish' | 'cancel', examId: string) {
    const confirmText =
      action === 'remind'
        ? 'Переслать текущий вопрос всем, кто ещё не закончил?'
        : action === 'finish'
          ? 'Завершить экзамен? Незаконченные попытки станут просроченными.'
          : 'Отменить экзамен?'
    if (!confirm(confirmText)) return

    setBusy(true)
    try {
      const res = await fetch('/api/admin/operator-exams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, exam_id: examId }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      if (action === 'remind') alert(`Напоминание отправлено: ${body.data?.reminded || 0}`)
      await load()
      if (detailsId === examId) await loadDetails(examId)
    } catch (e: any) {
      alert(`Ошибка: ${e?.message || 'не удалось'}`)
    } finally {
      setBusy(false)
    }
  }

  const canCreate = can('operator-exams.create')
  const canRemind = can('operator-exams.remind')
  const canCancel = can('operator-exams.cancel')
  const canGrade = can('operator-exams.grade')

  if (firstLoad) return <PageSkeleton />

  const withoutTelegram = eligibleOperators.filter((o) => !o.telegram_chat_id)

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Экзамены операторов"
        description="Аттестация по регламентам точки: ИИ собирает билет из базы знаний, бот принимает ответы в Telegram"
        icon={<GraduationCap className="h-5 w-5" />}
        accent="blue"
        backHref="/"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading || busy}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
            {canCreate && (
              <Button size="sm" onClick={() => setOpenForm((v) => !v)}>
                <GraduationCap className="h-4 w-4" />
                {openForm ? 'Свернуть' : 'Новый экзамен'}
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] p-4 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {readiness && <ReadinessGuide readiness={readiness} />}

      {openForm && canCreate && (
        <Card className="space-y-4 p-5">
          <div className="text-sm font-semibold text-foreground">Новый экзамен</div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Название</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Аттестация операторов, август"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground dark:bg-slate-950/50"
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Дедлайн (необязательно)</span>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground dark:bg-slate-950/50"
              />
            </label>
          </div>

          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">
              Точки — вопросы соберутся из регламентов этих точек
            </div>
            <div className="flex flex-wrap gap-2">
              {companies.map((company) => {
                const active = companyIds.includes(company.id)
                return (
                  <button
                    key={company.id}
                    onClick={() =>
                      setCompanyIds((prev) =>
                        active ? prev.filter((id) => id !== company.id) : [...prev, company.id],
                      )
                    }
                    className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                        : 'border-border bg-slate-100 text-body hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10'
                    }`}
                  >
                    {company.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Кого экзаменуем</span>
              {companyIds.length > 0 && eligibleOperators.length > 0 && (
                <button
                  onClick={() =>
                    setOperatorIds(
                      operatorIds.length === eligibleOperators.length ? [] : eligibleOperators.map((o) => o.id),
                    )
                  }
                  className="text-emerald-600 hover:underline dark:text-emerald-300"
                >
                  {operatorIds.length === eligibleOperators.length ? 'снять всех' : 'выбрать всех'}
                </button>
              )}
            </div>
            {companyIds.length === 0 ? (
              <div className="text-xs text-muted-foreground">Сначала выберите точки</div>
            ) : eligibleOperators.length === 0 ? (
              <div className="text-xs text-rose-600 dark:text-rose-300">
                На выбранных точках нет активных операторов
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {eligibleOperators.map((operator) => {
                  const active = operatorIds.includes(operator.id)
                  const noTelegram = !operator.telegram_chat_id
                  return (
                    <button
                      key={operator.id}
                      onClick={() =>
                        setOperatorIds((prev) =>
                          active ? prev.filter((id) => id !== operator.id) : [...prev, operator.id],
                        )
                      }
                      title={noTelegram ? 'У оператора не указан Telegram — экзамен не дойдёт' : undefined}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                          : 'border-border bg-slate-100 text-body hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10'
                      }`}
                    >
                      {operator.name}
                      {noTelegram && <span className="ml-1 text-rose-500">⚠</span>}
                    </button>
                  )
                })}
              </div>
            )}
            {withoutTelegram.length > 0 && (
              <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">
                ⚠ У {withoutTelegram.length} оператор(ов) не указан Telegram — им экзамен не уйдёт. Заполните chat ID в карточке сотрудника.
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Тестовых вопросов</span>
              <input
                type="number"
                min={3}
                max={20}
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground dark:bg-slate-950/50"
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Ситуационных (0–5)</span>
              <input
                type="number"
                min={0}
                max={5}
                value={openCount}
                onChange={(e) => setOpenCount(Number(e.target.value))}
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground dark:bg-slate-950/50"
              />
              <span className="text-[10px] text-muted-foreground">Свободный ответ, оценка ИИ до 5 баллов</span>
            </label>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Порог сдачи, %</span>
              <input
                type="number"
                min={1}
                max={100}
                value={passScore}
                onChange={(e) => setPassScore(Number(e.target.value))}
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground dark:bg-slate-950/50"
              />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={createExam} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Собрать билет
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Вопросы сгенерируются, но НЕ уйдут операторам — сначала прочитаете их сами
            </span>
          </div>
        </Card>
      )}

      {exams.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Экзаменов пока нет. Регламенты для вопросов берутся со страницы «База знаний» — там они привязываются к точкам.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <AdminTableViewport>
            <table className="w-full text-sm">
              <thead className={adminTableStickyTheadClass}>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5">Экзамен</th>
                  <th className="px-3 py-2.5">Точки</th>
                  <th className="px-3 py-2.5 text-center">Назначено</th>
                  <th className="px-3 py-2.5 text-center">Завершили</th>
                  <th className="px-3 py-2.5 text-center">Сдали</th>
                  <th className="px-3 py-2.5 text-center">Средний балл</th>
                  <th className="px-3 py-2.5">Дедлайн</th>
                  <th className="px-3 py-2.5 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((exam) => (
                  <tr
                    key={exam.id}
                    className="border-t border-border transition hover:bg-surface-muted"
                  >
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => setDetailsId(detailsId === exam.id ? null : exam.id)}
                        className="text-left font-medium text-foreground hover:underline"
                      >
                        {exam.title}
                      </button>
                      <div className="text-[11px] text-muted-foreground">
                        {exam.question_count} тест.{exam.open_count > 0 ? ` + ${exam.open_count} ситуац.` : ''} · порог{' '}
                        {exam.pass_score}% ·{' '}
                        {exam.status === 'draft' ? (
                          <span className="text-amber-600 dark:text-amber-300">черновик, не разослан</span>
                        ) : exam.status === 'active' ? (
                          'идёт'
                        ) : exam.status === 'finished' ? (
                          'завершён'
                        ) : (
                          'отменён'
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-body">
                      {exam.company_ids.map(companyName).join(', ')}
                    </td>
                    <td className="px-3 py-2.5 text-center">{exam.assigned}</td>
                    <td className="px-3 py-2.5 text-center">{exam.completed}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={exam.completed > 0 && exam.passed < exam.completed ? 'text-amber-600 dark:text-amber-300' : ''}>
                        {exam.passed}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono">
                      {exam.avg_score != null ? `${exam.avg_score}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-body">{dt(exam.deadline_at)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        {exam.status === 'draft' && canCreate && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => setDetailsId(detailsId === exam.id ? null : exam.id)}
                          >
                            Проверить вопросы
                          </Button>
                        )}
                        {exam.status === 'active' && canRemind && (
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => runAction('remind', exam.id)}>
                            Напомнить
                          </Button>
                        )}
                        {exam.status === 'active' && canCancel && (
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => runAction('finish', exam.id)}>
                            Завершить
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableViewport>
        </Card>
      )}

      {detailsId && (draftQuestions.length > 0 || draftOpen.length > 0) && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Проверьте билет до рассылки</div>
              <div className="text-[11px] text-muted-foreground">
                Выкиньте вопросы, которые сформулированы неверно или спрашивают то, чего нет в регламенте.
                После рассылки править нельзя.
              </div>
            </div>
            {canCreate && (
              <Button
                disabled={busy || (draftQuestions.length === 0 && draftOpen.length === 0)}
                onClick={async () => {
                  if (!confirm('Разослать экзамен операторам? Вопросы после этого не изменить.')) return
                  setBusy(true)
                  try {
                    const res = await fetch('/api/admin/operator-exams', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ action: 'send', exam_id: detailsId }),
                    })
                    const b = await res.json()
                    if (!res.ok) throw new Error(b?.error || `HTTP ${res.status}`)
                    const failed = (b.data?.failures || []).length
                    alert(
                      `Разослано: ${b.data?.sent} из ${b.data?.assigned}` +
                        (failed > 0 ? `\nНе доставлено: ${failed} — см. таблицу` : ''),
                    )
                    await load()
                    await loadDetails(detailsId)
                  } catch (e: any) {
                    alert(`Ошибка: ${e?.message || 'не удалось'}`)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Send className="h-4 w-4" />
                Разослать
              </Button>
            )}
          </div>

          <div className="divide-y divide-border">
            {[...draftQuestions, ...draftOpen].map((question) => (
              <div key={`${question.pool}-${question.index}`} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{question.q}</span>
                    {question.pool === 'open' && (
                      <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-600 dark:text-sky-300">
                        ситуационный
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">по регламенту «{question.article_title}»</div>
                  {question.pool === 'choice' && (
                    <div className="mt-1 space-y-0.5">
                      {(question.choices || []).map((choice, i) => (
                        <div
                          key={i}
                          className={`text-[11px] ${
                            i === question.correct
                              ? 'font-medium text-emerald-700 dark:text-emerald-300'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {'АБВГ'[i] || i + 1}. {choice}
                          {i === question.correct ? ' ✓' : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  {question.pool === 'open' && (question.rubric || []).length > 0 && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Рубрика: {(question.rubric || []).join(' · ')}
                    </div>
                  )}
                </div>
                {canCreate && (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await fetch('/api/admin/operator-exams', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({
                            action: 'drop_question',
                            exam_id: detailsId,
                            question_index: question.index,
                            pool: question.pool,
                          }),
                        })
                        await loadDetails(detailsId!)
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="shrink-0 rounded-lg border border-rose-400/40 px-2 py-1 text-[11px] text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300"
                    title="Убрать вопрос из билета"
                  >
                    Убрать
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {detailsId && draftQuestions.length === 0 && draftOpen.length === 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
            Кто как сдал
          </div>
          {detailsLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаем…
            </div>
          ) : (
            <AdminTableViewport>
              <table className="w-full text-sm">
                <thead className={adminTableStickyTheadClass}>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5">Оператор</th>
                    <th className="px-3 py-2.5">Статус</th>
                    <th className="px-3 py-2.5 text-center">Прогресс</th>
                    <th className="px-3 py-2.5 text-center">Балл</th>
                    <th className="px-3 py-2.5">Отправлен</th>
                    <th className="px-3 py-2.5">Завершён</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((attempt) => {
                    const meta = STATUS_LABELS[attempt.status]
                    const openCountForAttempt = attempt.open_answers?.length || 0
                    const expanded = expandedAttempt === attempt.id
                    return (
                      <Fragment key={attempt.id}>
                      <tr className="border-t border-border">
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {openCountForAttempt > 0 ? (
                            <button
                              onClick={() => setExpandedAttempt(expanded ? null : attempt.id)}
                              className="text-left hover:underline"
                            >
                              {attempt.operator_name}
                              <span className="ml-1.5 text-[10px] text-sky-600 dark:text-sky-300">
                                {expanded ? '▾' : '▸'} {openCountForAttempt} развёрнутых
                              </span>
                            </button>
                          ) : (
                            attempt.operator_name
                          )}
                          {attempt.manual_override && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-300">балл правился вручную</div>
                          )}
                        </td>
                        <td className={`px-3 py-2.5 text-xs ${meta.tone}`}>
                          {meta.label}
                          {attempt.delivery_error && (
                            <div className="text-[11px] text-rose-500">{attempt.delivery_error}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs text-body">
                          {attempt.status === 'completed'
                            ? `${attempt.correct_answers}/${attempt.total_questions}`
                            : `${attempt.current_index}/${attempt.total_questions}`}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {attempt.score == null ? (
                            '—'
                          ) : (
                            <span className="inline-flex items-center gap-1 font-mono">
                              {attempt.passed ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 text-rose-500" />
                              )}
                              {attempt.score}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-body">{dt(attempt.sent_at)}</td>
                        <td className="px-3 py-2.5 text-xs text-body">{dt(attempt.completed_at)}</td>
                      </tr>
                      {expanded && (
                        <tr className="border-t border-border bg-surface-muted">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="space-y-3">
                              {attempt.open_answers.map((item) => (
                                <OpenAnswerCard
                                  key={item.index}
                                  item={item}
                                  canGrade={canGrade}
                                  busy={busy}
                                  onOverride={async (score, comment) => {
                                    setBusy(true)
                                    try {
                                      const res = await fetch('/api/admin/operator-exams', {
                                        method: 'POST',
                                        headers: { 'content-type': 'application/json' },
                                        body: JSON.stringify({
                                          action: 'grade_override',
                                          attempt_id: attempt.id,
                                          question_index: item.index,
                                          score,
                                          comment,
                                        }),
                                      })
                                      const b = await res.json()
                                      if (!res.ok) throw new Error(b?.error || `HTTP ${res.status}`)
                                      if (detailsId) await loadDetails(detailsId)
                                      await load()
                                    } catch (e: any) {
                                      alert(`Ошибка: ${e?.message || 'не удалось'}`)
                                    } finally {
                                      setBusy(false)
                                    }
                                  }}
                                />
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </AdminTableViewport>
          )}
        </Card>
      )}
    </div>
  )
}
