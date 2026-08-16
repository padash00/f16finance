'use client'

/**
 * Регулярный экзамен по точке.
 *
 * Экзамен, который назначают руками, назначается редко — а проверка знаний
 * работает только регулярно. Здесь настраивается расписание: в назначенный
 * день система соберёт билет и позовёт вас его проверить.
 *
 * Собирается именно ЧЕРНОВИК. Вопросы пишет модель, и кривой вопрос дешевле
 * выкинуть до отправки, чем объясняться перед семью людьми, которым он уже
 * ушёл. Рассылает человек.
 *
 * Состав билета зависит от ниши точки: продавцу магазина — каталог и остатки,
 * оператору клуба — тарифы и железо. Эти вопросы не выдумывает модель: факт
 * берётся из базы, поэтому они всегда точные и обновляются вместе с прайсом.
 */

import { useState } from 'react'
import { CalendarClock, Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'

export type ExamSchedule = {
  company_id: string
  title: string
  is_active: boolean
  weekday: number
  question_count: number
  open_count: number
  pass_score: number
  deadline_days: number
  fact_topics: string[]
  last_run_on: string | null
}

const WEEKDAYS: [number, string][] = [
  [1, 'понедельник'],
  [2, 'вторник'],
  [3, 'среда'],
  [4, 'четверг'],
  [5, 'пятница'],
  [6, 'суббота'],
  [7, 'воскресенье'],
]

/** Темы вопросов по данным точки. Пусто — берутся типовые для её ниши. */
const TOPICS: [string, string][] = [
  ['catalog', 'Каталог и цены'],
  ['warehouse', 'Остатки на витрине'],
  ['tariffs', 'Тарифы и зоны'],
  ['hardware', 'Техника и характеристики'],
  ['stations', 'Станции и места'],
]

const INDUSTRY_HINT: Record<string, string> = {
  shop: 'магазин — каталог и остатки',
  food: 'общепит — каталог и остатки',
  club: 'компьютерный клуб — тарифы, техника, станции',
  ps_club: 'PS-клуб — тарифы и станции',
  service: 'услуги — тем по данным нет',
  other: 'ниша не задана — тем по данным нет',
}

function blank(companyId: string): ExamSchedule {
  return {
    company_id: companyId,
    title: 'Еженедельная проверка',
    is_active: true,
    weekday: 7,
    question_count: 10,
    open_count: 2,
    pass_score: 70,
    deadline_days: 4,
    fact_topics: [],
    last_run_on: null,
  }
}

export function WeeklySchedule(props: {
  companies: { id: string; name: string; industry?: string | null }[]
  schedules: ExamSchedule[]
  onSaved: () => void
}) {
  const [companyId, setCompanyId] = useState(props.companies[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const existing = props.schedules.find((s) => s.company_id === companyId)
  const [draft, setDraft] = useState<ExamSchedule | null>(null)
  const value = draft ?? existing ?? blank(companyId)

  const company = props.companies.find((c) => c.id === companyId)
  const industryHint = INDUSTRY_HINT[String(company?.industry || 'other')]

  function patch(next: Partial<ExamSchedule>) {
    setDraft({ ...value, ...next, company_id: companyId })
    setSaved(false)
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch('/api/admin/operator-exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.detail || json?.error || `HTTP ${res.status}`)
      setDraft(null)
      setSaved(true)
      props.onSaved()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  if (props.companies.length === 0) return null

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">Регулярный экзамен</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            В назначенный день система соберёт билет по этой точке и пришлёт в Telegram «готово,
            проверьте». Рассылаете вы: вопросы пишет модель, и неудачный дешевле выкинуть до отправки,
            чем объясняться перед всей сменой.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Точка
              <NativeSelect
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value)
                  setDraft(null)
                  setSaved(false)
                }}
                className="w-56"
              >
                {props.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Собирать в
              <NativeSelect
                value={String(value.weekday)}
                onChange={(e) => patch({ weekday: Number(e.target.value) })}
                className="w-40"
              >
                {WEEKDAYS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Вопросов
              <Input
                type="number"
                min={3}
                max={20}
                value={value.question_count}
                onChange={(e) => patch({ question_count: Number(e.target.value) })}
                className="w-24"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Ситуационных
              <Input
                type="number"
                min={0}
                max={5}
                value={value.open_count}
                onChange={(e) => patch({ open_count: Number(e.target.value) })}
                className="w-24"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Порог, %
              <Input
                type="number"
                min={1}
                max={100}
                value={value.pass_score}
                onChange={(e) => patch({ pass_score: Number(e.target.value) })}
                className="w-24"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Дней на сдачу
              <Input
                type="number"
                min={1}
                max={14}
                value={value.deadline_days}
                onChange={(e) => patch({ deadline_days: Number(e.target.value) })}
                className="w-28"
              />
            </label>
          </div>

          {/* Темы по данным точки */}
          <div className="mt-4">
            <div className="text-xs font-medium text-body">Вопросы по данным точки</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Не выдумываются моделью — факт берётся из базы, поэтому такие вопросы всегда точные.
              Ничего не отмечено — возьмутся типовые для ниши: {industryHint}.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TOPICS.map(([key, label]) => {
                const active = value.fact_topics.includes(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      patch({
                        fact_topics: active
                          ? value.fact_topics.filter((t) => t !== key)
                          : [...value.fact_topics, key],
                      })
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-lg bg-surface-muted px-3 py-2.5">
            <input
              type="checkbox"
              checked={value.is_active}
              onChange={(e) => patch({ is_active: e.target.checked })}
              className="h-4 w-4 rounded border-border text-violet-600"
            />
            <span className="text-sm text-body">Собирать билет по расписанию</span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !companyId}
              onClick={() => void post({ action: 'schedule_save', ...value })}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Сохранить
            </Button>

            {existing ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void post({ action: 'schedule_delete', company_id: companyId })}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Убрать расписание
              </Button>
            ) : null}

            {saved ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Сохранено</span> : null}
            {existing?.last_run_on ? (
              <span className="text-xs text-muted-foreground">
                последний билет собран {existing.last_run_on}
              </span>
            ) : null}
          </div>

          {problem ? (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{problem}</p>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
