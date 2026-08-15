'use client'

/**
 * Календарь особых дней и учебных периодов.
 *
 * Месячный индекс спроса складывается из четырёх частей, и две из них —
 * праздники и учебный период — раньше было нечем заполнить: таблицы были,
 * расчёт их читал, а интерфейса не существовало. Обе части всегда оставались
 * нейтральными, то есть механизм работал вхолостую.
 *
 * Праздники Казахстана в системе уже есть, поэтому вбивать их руками не нужно.
 */

import { useState } from 'react'
import { AlertTriangle, CalendarDays, Check, Download, GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Card } from '@/components/ui/card'
import { useApi } from '@/lib/hooks/use-api'

type CalendarDay = {
  id: string
  day: string
  day_type: string
  name: string
  impact_index: number
  company_id: string | null
  source: string | null
  verified: boolean
}

type AcademicPeriod = {
  id: string
  start_date: string
  end_date: string
  period_type: string
  name: string
  manual_index: number
  is_confirmed: boolean
  company_id: string | null
  audience: string | null
  source: string | null
  source_url: string | null
  confidence: number | null
}

type CalendarData = {
  year: number
  days: CalendarDay[]
  periods: AcademicPeriod[]
  holidays_to_import: { date: string; name: string }[]
  /** Праздники с плавающей датой — их дату задаёт не закон, а лунный календарь. */
  holidays_need_dates: string[]
  education_available: number
}

const DAY_TYPES: [string, string][] = [
  ['PUBLIC_HOLIDAY', 'Государственный праздник'],
  ['TRANSFERRED_DAY_OFF', 'Перенос выходного'],
  ['WORKING_WEEKEND', 'Рабочая суббота'],
  ['LONG_WEEKEND', 'Длинные выходные'],
  ['RELIGIOUS_HOLIDAY', 'Религиозный праздник'],
  ['LOCAL_EVENT', 'Событие в городе'],
  ['INTERNAL_EVENT', 'Своё мероприятие'],
  ['CLOSURE', 'Точка не работала'],
  ['CUSTOM', 'Другое'],
]

const PERIOD_TYPES: [string, string][] = [
  ['SEMESTER', 'Семестр'],
  ['VACATION', 'Каникулы'],
  ['SUMMER_BREAK', 'Летние каникулы'],
  ['EXAMS', 'Сессия'],
  ['ADMISSION', 'Приёмная кампания'],
  ['START_OF_YEAR', 'Начало учебного года'],
  ['END_OF_YEAR', 'Конец учебного года'],
  ['CUSTOM', 'Другое'],
]

function label(list: [string, string][], value: string): string {
  return list.find(([v]) => v === value)?.[1] || value
}

/** 1.00 — нейтрально; отклонение показываем в процентах, так понятнее. */
function impactText(value: number): string {
  const delta = Math.round((Number(value) - 1) * 100)
  if (delta === 0) return 'без влияния'
  return delta > 0 ? `спрос выше на ${delta}%` : `спрос ниже на ${Math.abs(delta)}%`
}

export function CalendarBlock(props: { companyId: string; canManage: boolean }) {
  const year = new Date().getFullYear()
  const key = `/api/admin/sales-kpi/calendar?company_id=${props.companyId}&year=${year}`
  const { data, loading, refresh } = useApi<{ data: CalendarData }>(key)
  const payload = data?.data

  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [dayForm, setDayForm] = useState({ day: '', name: '', day_type: 'LOCAL_EVENT', impact_index: '1' })
  const [periodForm, setPeriodForm] = useState({
    start_date: '',
    end_date: '',
    name: '',
    period_type: 'SEMESTER',
    manual_index: '1',
  })

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: props.companyId, ...body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.detail || json?.error || `HTTP ${res.status}`)
      await refresh()
      return true
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось сохранить')
      return false
    } finally {
      setBusy(false)
    }
  }


  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">
          Праздники и учебные периоды
        </h2>
        <span className="text-xs text-muted-foreground">{year} год</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Из этого складываются две части поправки на месяц: в месяце с длинными выходными или каникулами
        спрос другой, и цели должны это учитывать. Разбор поправки — выше, в блоке «Из чего сложилась
        поправка»: там видно, работает ли каждая часть.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем…
        </div>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {/* Особые дни */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Особые дни · {payload?.days.length ?? 0}
              </span>
              {props.canManage && (payload?.holidays_to_import.length ?? 0) > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void post({ action: 'import_holidays', year })}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  Добавить праздники РК ({payload?.holidays_to_import.length})
                </Button>
              ) : null}
            </div>

            {(payload?.holidays_need_dates.length ?? 0) > 0 ? (
              <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
                Даты задаются вручную: {payload?.holidays_need_dates.join(', ')} — они привязаны к лунному
                календарю и заранее в законе не закреплены.
              </p>
            ) : null}

            <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
              {(payload?.days || []).length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  Дней нет. Начните с праздников РК: официальные даты и переносы выходных уже в системе.
                </div>
              ) : (
                (payload?.days || []).map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-sm"
                  >
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                      {d.day}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body">
                      {d.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{impactText(d.impact_index)}</span>
                    {!d.verified ? (
                      props.canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void post({ action: 'verify_day', day_id: d.id })}
                          disabled={busy}
                          title="Дату проверил, всё верно"
                          className="h-6 shrink-0 bg-amber-50 px-1.5 text-xs text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300"
                        >
                          проверить
                        </Button>
                      ) : (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                          не проверено
                        </span>
                      )
                    ) : (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    )}
                    {props.canManage ? (
                      <Button
                        onClick={() => void post({ action: 'delete_day', day_id: d.id })}
                        disabled={busy}
                        variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                        aria-label="Удалить день"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {props.canManage ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={dayForm.day}
                  onChange={(e) => setDayForm({ ...dayForm, day: e.target.value })}
                  className="w-36"
                />
                <NativeSelect
                  value={dayForm.day_type}
                  onChange={(e) => setDayForm({ ...dayForm, day_type: e.target.value })}
                  className="w-44"
                >
                  {DAY_TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  value={dayForm.name}
                  onChange={(e) => setDayForm({ ...dayForm, name: e.target.value })}
                  placeholder="Что за день"
                  className="min-w-[140px] flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !dayForm.day || !dayForm.name.trim()}
                  onClick={() =>
                    void post({ action: 'add_day', ...dayForm }).then((ok) => {
                      if (ok) setDayForm({ ...dayForm, day: '', name: '' })
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null}
          </div>

          {/* Учебные периоды */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <GraduationCap className="h-3.5 w-3.5" />
                Учебные периоды · {payload?.periods.length ?? 0}
              </span>
              {props.canManage ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void post({ action: 'import_education_calendar' })}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  Учебный календарь РК
                </Button>
              ) : null}
            </div>

            <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
              {(payload?.periods || []).length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  Периодов нет. Добавьте семестр и каникулы — модель узнает, когда студенты в городе.
                </div>
              ) : (
                (payload?.periods || []).map((p) => (
                  <div key={p.id} className="rounded-lg bg-surface-muted px-2.5 py-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-body">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {impactText(p.manual_index)}
                      </span>
                      {props.canManage ? (
                        <Button
                          onClick={() => void post({ action: 'delete_period', period_id: p.id })}
                          disabled={busy}
                          variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                          aria-label="Удалить период"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {p.start_date} — {p.end_date} · {label(PERIOD_TYPES, p.period_type)}
                      {p.audience ? ` · ${p.audience}` : ''}
                    </div>
                    {!p.is_confirmed ? (
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                        <span>не подтверждён — в расчёт не идёт</span>
                        {props.canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void post({ action: 'confirm_period', period_id: p.id })}
                            disabled={busy}
                            className="h-6 bg-amber-50 px-1.5 text-xs hover:bg-amber-100 dark:bg-amber-500/10"
                          >
                            подтвердить
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {p.source ? (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        Источник: {p.source_url ? (
                          <a
                            href={p.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-sky-500"
                          >
                            {p.source}
                          </a>
                        ) : (
                          p.source
                        )}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {props.canManage ? (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={periodForm.start_date}
                    onChange={(e) => setPeriodForm({ ...periodForm, start_date: e.target.value })}
                    className="w-36"
                  />
                  <span className="text-muted-foreground">—</span>
                  <Input
                    type="date"
                    value={periodForm.end_date}
                    onChange={(e) => setPeriodForm({ ...periodForm, end_date: e.target.value })}
                    className="w-36"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    value={periodForm.period_type}
                    onChange={(e) => setPeriodForm({ ...periodForm, period_type: e.target.value })}
                    className="w-44"
                  >
                    {PERIOD_TYPES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    value={periodForm.name}
                    onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
                    placeholder="Название"
                    className="min-w-[120px] flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy || !periodForm.start_date || !periodForm.end_date || !periodForm.name.trim()
                    }
                    onClick={() =>
                      void post({ action: 'add_period', ...periodForm }).then((ok) => {
                        if (ok) setPeriodForm({ ...periodForm, start_date: '', end_date: '', name: '' })
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <b>Праздники</b> берутся из справочника с официальными датами и переносами выходных. Даты,
          которые в самом справочнике помечены предварительными, приезжают со значком «не проверено» —
          сверьте их с постановлением правительства и нажмите «проверить».
          <br />
          Вручную заводится только <b>Курбан айт</b>: его дата привязана к лунному календарю и заранее
          законом не закрепляется. Тип — «Религиозный праздник».
          <br />
          <b>Учебный календарь</b> загружается отдельной кнопкой. Его даты берутся из официальных
          источников, но влияние на спрос там — оценка составителя, а не измерение на ваших продажах.
          Периоды со статусом «не подтверждён» в расчёт не идут, пока вы их не проверите.
          <br />
          <b>Влияние праздников</b> остаётся нейтральным намеренно. Своей истории по конкретному
          празднику пока нет, а придумывать коэффициент нельзя — модуль посчитает его сам, когда
          накопятся данные.
        </div>
      </div>

      {problem ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{problem}</p> : null}
    </Card>
  )
}
