'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react'

type ShiftType = 'day' | 'night'

type ScheduleBlock = {
  company: { id: string; name: string; code: string | null }
  publication: { id: string; week_start: string; week_end: string; version: number } | null
  response: {
    id: string
    status: string
    responded_at: string | null
    note: string | null
  } | null
  requests: Array<{
    id: string
    shift_date: string
    shift_type: ShiftType
    status: string
    reason: string | null
    resolution_note: string | null
  }>
  shifts: Array<{
    id: string
    date: string
    shift_type: ShiftType
    operator_name: string
  }>
  teamRoster: Array<{
    id: string
    date: string
    shift_type: ShiftType
    operator_name: string
  }>
}

type Notice = {
  tone: 'success' | 'error' | 'info'
  text: string
}

function getWeekStart(date = new Date()) {
  const copy = new Date(date)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  return copy.toISOString().slice(0, 10)
}

function shiftIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utcDate = new Date(Date.UTC(year, (month || 1) - 1, day || 1))
  utcDate.setUTCDate(utcDate.getUTCDate() + days)
  return utcDate.toISOString().slice(0, 10)
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  })
}

export function OperatorSchedulePanel({
  onOpenTasks,
}: {
  onOpenTasks?: () => void
}) {
  const realtimeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [weekStart, setWeekStart] = useState(getWeekStart())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<ScheduleBlock[]>([])
  const [operatorName, setOperatorName] = useState('Оператор')
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [issueReason, setIssueReason] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(
    async (silent = false) => {
      try {
        if (!silent) {
          setLoading(true)
        } else {
          setRefreshing(true)
        }

        const response = await fetch(`/api/operator/shifts?weekStart=${weekStart}`, { cache: 'no-store' })
        const json = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(json?.error || `Ошибка запроса (${response.status})`)
        }

        setSchedule(json?.schedule || [])
        setOperatorName(json?.operator?.name || 'Оператор')
        setError(null)
      } catch (err: any) {
        console.error('Operator schedule load error', err)
        setError(err?.message || 'Не удалось загрузить график')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [weekStart],
  )

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!selectedCompanyId && schedule.length > 0) {
      setSelectedCompanyId(schedule[0].company.id)
    }
  }, [schedule, selectedCompanyId])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (realtimeRefreshRef.current) clearTimeout(realtimeRefreshRef.current)
      realtimeRefreshRef.current = setTimeout(() => loadData(true), 250)
    }

    const channel = supabase
      .channel(`operator-schedule-panel-${weekStart}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_week_publications' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_operator_week_responses' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_change_requests' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (realtimeRefreshRef.current) clearTimeout(realtimeRefreshRef.current)
      supabase.removeChannel(channel)
    }
  }, [loadData, weekStart])

  const selectedBlock = useMemo(
    () => schedule.find((item) => item.company.id === selectedCompanyId) || schedule[0] || null,
    [schedule, selectedCompanyId],
  )

  const handleConfirmWeek = async (responseId: string) => {
    setSubmitting(responseId)
    setNotice(null)
    try {
      const response = await fetch('/api/operator/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirmWeek',
          responseId,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      setNotice({ tone: 'success', text: 'Неделя подтверждена. Руководитель увидит ваш ответ.' })
      await loadData(true)
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Не удалось подтвердить неделю.' })
    } finally {
      setSubmitting(null)
    }
  }

  const handleIssue = async (responseId: string, shiftDate: string, shiftType: ShiftType) => {
    const key = `${responseId}|${shiftDate}|${shiftType}`
    const reason = issueReason[key]?.trim() || ''
    if (!reason) {
      setNotice({ tone: 'error', text: 'Напишите причину, почему вы не можете выйти на эту смену.' })
      return
    }

    setSubmitting(key)
    setNotice(null)
    try {
      const response = await fetch('/api/operator/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reportIssue',
          responseId,
          shiftDate,
          shiftType,
          reason,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      setNotice({ tone: 'success', text: 'Проблемная смена отправлена руководителю.' })
      setIssueReason((prev) => ({ ...prev, [key]: '' }))
      await loadData(true)
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Не удалось отправить проблему по смене.' })
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-[1.7rem] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(60,179,113,0.16),transparent_36%),linear-gradient(180deg,rgba(10,18,30,0.98),rgba(8,14,24,0.98))] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.24)] sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 text-white">
            <div className="flex h-11 w-11 items-center justify-center rounded-[1rem] border border-white/10 bg-white/[0.04] sm:h-12 sm:w-12">
              <CalendarDays className="h-6 w-6 text-[#7ef0cf]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.04em] sm:text-2xl">График и согласование</h2>
              <p className="mt-1 text-sm text-slate-400">Недельные смены и подтверждение для {operatorName}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setWeekStart(shiftIsoDate(weekStart, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2 text-xs text-white sm:px-4 sm:text-sm">
              {formatDate(weekStart)} — {formatDate(shiftIsoDate(weekStart, 6))}
            </div>
            <Button variant="outline" size="icon" onClick={() => setWeekStart(shiftIsoDate(weekStart, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => loadData(true)} className="gap-2">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить
            </Button>
          </div>
        </div>

        {onOpenTasks ? (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Button variant="outline" className="w-full border-white/10 sm:w-auto" onClick={onOpenTasks}>
              Перейти в мои задачи
            </Button>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div
          className={
            notice.tone === 'success'
              ? 'rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200'
              : notice.tone === 'error'
                ? 'rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200'
                : 'rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white'
          }
        >
          {notice.text}
        </div>
      ) : null}

      {error ? <Card className="border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</Card> : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)] xl:gap-6">
        <Card className="border-border bg-card p-4">
          <div className="mb-3 text-sm font-semibold text-white">Мои точки на неделю</div>
          <div className="space-y-3">
            {schedule.map((block) => (
              <button
                key={block.company.id}
                type="button"
                onClick={() => setSelectedCompanyId(block.company.id)}
                className={`w-full rounded-[1.25rem] border px-4 py-4 text-left transition-colors ${
                  selectedBlock?.company.id === block.company.id
                    ? 'border-[#7ef0cf]/20 bg-[#7ef0cf]/10'
                    : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div className="text-sm font-semibold text-white">{block.company.name}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {block.shifts.length} смен •{' '}
                  {block.response?.status === 'confirmed'
                    ? 'Подтверждено'
                    : block.response?.status === 'issue_reported'
                      ? 'Есть проблема'
                      : 'Ждёт ответа'}
                </div>
              </button>
            ))}

            {!loading && schedule.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                На эту неделю вам ещё ничего не назначили.
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="border-border bg-card p-4 sm:p-5">
          {loading && !selectedBlock ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка графика...
            </div>
          ) : selectedBlock ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Точка</div>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">{selectedBlock.company.name}</h3>
                  <p className="mt-2 text-sm text-slate-400">
                    Версия недели: {selectedBlock.publication ? `v${selectedBlock.publication.version}` : 'черновик'}
                  </p>
                </div>

                {selectedBlock.response ? (
                  <Button
                    onClick={() => handleConfirmWeek(selectedBlock.response!.id)}
                    disabled={selectedBlock.response.status === 'confirmed' || submitting === selectedBlock.response.id}
                    className="gap-2"
                  >
                    {submitting === selectedBlock.response.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {selectedBlock.response.status === 'confirmed' ? 'Неделя подтверждена' : 'Подтвердить неделю'}
                  </Button>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.025] p-4">
                  <div className="text-sm font-semibold text-white">Мои смены</div>
                  <div className="mt-4 space-y-3">
                    {selectedBlock.shifts.map((shift) => {
                      const issueKey = `${selectedBlock.response?.id || 'draft'}|${shift.date}|${shift.shift_type}`
                      return (
                        <div key={shift.id} className="rounded-xl border border-white/8 bg-black/10 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-white">{formatDate(shift.date)}</div>
                              <div className="mt-1 text-xs text-slate-400">
                                {shift.shift_type === 'day' ? 'Дневная смена' : 'Ночная смена'}
                              </div>
                            </div>
                            {selectedBlock.requests.some(
                              (item) =>
                                item.shift_date === shift.date && item.shift_type === shift.shift_type && item.status !== 'dismissed',
                            ) ? (
                              <div className="rounded-full bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">Есть запрос</div>
                            ) : null}
                          </div>

                          {selectedBlock.response ? (
                            <div className="mt-4 space-y-3">
                              <textarea
                                value={issueReason[issueKey] || ''}
                                onChange={(e) =>
                                  setIssueReason((prev) => ({
                                    ...prev,
                                    [issueKey]: e.target.value,
                                  }))
                                }
                                rows={2}
                                placeholder="Если не можете выйти, напишите причину"
                                className="w-full rounded-xl border border-white/8 bg-black/10 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-[#7ef0cf]/20"
                              />
                              <Button
                                variant="outline"
                                onClick={() => handleIssue(selectedBlock.response!.id, shift.date, shift.shift_type)}
                                disabled={submitting === issueKey}
                                className="gap-2"
                              >
                                {submitting === issueKey ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4" />
                                )}
                                Сообщить о проблеме
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.025] p-4">
                    <div className="text-sm font-semibold text-white">Команда на неделю</div>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      {selectedBlock.teamRoster.map((shift) => (
                        <div key={shift.id} className="rounded-xl border border-white/8 bg-black/10 px-4 py-3">
                          <div className="text-sm font-medium text-white">{formatDate(shift.date)}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {shift.shift_type === 'day' ? 'День' : 'Ночь'} — {shift.operator_name || 'Свободно'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.025] p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                      <Send className="h-4 w-4 text-[#7ef0cf]" />
                      Мои запросы по сменам
                    </div>
                    <div className="space-y-3">
                      {selectedBlock.requests.map((request) => (
                        <div key={request.id} className="rounded-xl border border-white/8 bg-black/10 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-white">
                              {formatDate(request.shift_date)} • {request.shift_type === 'day' ? 'день' : 'ночь'}
                            </div>
                            <div className="text-xs text-slate-500">
                              {request.status === 'open'
                                ? 'Ожидает решения'
                                : request.status === 'resolved'
                                  ? 'Обработано'
                                  : request.status === 'dismissed'
                                    ? 'Закрыто'
                                    : 'Ждёт причину'}
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-slate-300">{request.reason || 'Причина ещё не отправлена.'}</div>
                          {request.resolution_note ? (
                            <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                              {request.resolution_note}
                            </div>
                          ) : null}
                        </div>
                      ))}

                      {selectedBlock.requests.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
                          По этой точке ещё не было спорных смен.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-12 text-center text-sm text-slate-500">
              Для этой недели пока нет опубликованных смен.
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
