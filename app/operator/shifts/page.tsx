'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
} from 'lucide-react'

import {
  OperatorEmptyState,
  OperatorMetricCard,
  OperatorPanel,
  OperatorPill,
  OperatorSectionHeading,
} from '@/components/operator/operator-mobile-ui'
import { Button } from '@/components/ui/button'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal } from '@/lib/core/date'

type ShiftItem = { date: string; shift_type: 'day' | 'night'; comment?: string | null }
type ShiftGroup = {
  company: { id: string; name: string | null; code: string | null }
  publication: { id: string } | null
  response: { id: string; status: string | null } | null
  requests: Array<{ id: string; shift_date: string; shift_type: 'day' | 'night'; status: string }>
  shifts: ShiftItem[]
}

type ScheduleData = {
  operator: { id: string; name: string; short_name: string | null }
  weekStart: string
  weekEnd: string
  schedule: ShiftGroup[]
}

const currentWeek = () => toISODateLocal(mondayOfDate(new Date()))

function shiftLabel(value: 'day' | 'night') {
  return value === 'day' ? 'День' : 'Ночь'
}

export default function OperatorShiftsPage() {
  const [weekStart, setWeekStart] = useState(currentWeek())
  const [data, setData] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [issueDraft, setIssueDraft] = useState<{ responseId: string; shiftDate: string; shiftType: 'day' | 'night'; companyName: string | null } | null>(null)
  useModalEscape(!!issueDraft, () => { setIssueDraft(null) })
  const [issueReason, setIssueReason] = useState('')

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const response = await fetch(`/api/operator/shifts?weekStart=${encodeURIComponent(weekStart)}`, { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка загрузки (${response.status})`)
      setData(json)
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить смены')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [weekStart])

  useEffect(() => {
    void load()
  }, [load])

  const weekStats = useMemo(() => {
    const shifts = data?.schedule.flatMap((item) => item.shifts) || []
    const pendingConfirm = (data?.schedule || []).filter((item) => item.publication?.id && item.response?.status !== 'confirmed').length
    const openIssues = (data?.schedule || []).reduce(
      (sum, item) => sum + item.requests.filter((request) => !['resolved', 'dismissed'].includes(request.status)).length,
      0,
    )
    return {
      total: shifts.length,
      day: shifts.filter((item) => item.shift_type === 'day').length,
      night: shifts.filter((item) => item.shift_type === 'night').length,
      pendingConfirm,
      openIssues,
    }
  }, [data])

  const confirmWeek = async (responseId: string) => {
    setActionLoading(responseId)
    setNotice(null)
    try {
      const response = await fetch('/api/operator/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirmWeek', responseId }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка подтверждения (${response.status})`)
      setNotice('Неделя подтверждена. Руководитель увидит, что график принят.')
      await load(true)
    } catch (err: any) {
      setError(err?.message || 'Не удалось подтвердить неделю')
    } finally {
      setActionLoading(null)
    }
  }

  const submitIssue = async (event: FormEvent) => {
    event.preventDefault()
    if (!issueDraft || !issueReason.trim()) return
    setActionLoading(`${issueDraft.responseId}:${issueDraft.shiftDate}:${issueDraft.shiftType}`)
    try {
      const response = await fetch('/api/operator/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reportIssue',
          responseId: issueDraft.responseId,
          shiftDate: issueDraft.shiftDate,
          shiftType: issueDraft.shiftType,
          reason: issueReason.trim(),
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка отправки (${response.status})`)
      setIssueDraft(null)
      setIssueReason('')
      setNotice('Замечание по смене отправлено. Руководитель увидит его в рабочем контуре.')
      await load(true)
    } catch (err: any) {
      setError(err?.message || 'Не удалось отправить замечание')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      <OperatorPanel accent="blue">
        <OperatorSectionHeading
          title={`${formatRuDate(weekStart)} - ${formatRuDate(addDaysISO(weekStart, 6))}`}
          description="Здесь виден ваш график по точкам. Если неделя уже опубликована, можно подтвердить её или отправить замечание по конкретной смене."
          action={
            <Button type="button" variant="ghost" className="text-zinc-400 hover:text-zinc-100" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="border-[#23262b] bg-[#0b0c0d] text-zinc-100 hover:bg-[#0e0f10]" onClick={() => setWeekStart(addDaysISO(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
            Прошлая
          </Button>
          <Button type="button" variant="outline" className="border-[#23262b] bg-[#0b0c0d] text-zinc-100 hover:bg-[#0e0f10]" onClick={() => setWeekStart(currentWeek())}>
            Текущая
          </Button>
          <Button type="button" variant="outline" className="border-[#23262b] bg-[#0b0c0d] text-zinc-100 hover:bg-[#0e0f10]" onClick={() => setWeekStart(addDaysISO(weekStart, 7))}>
            Следующая
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </OperatorPanel>

      {error ? <OperatorPanel className="border-rose-500/40 text-sm text-rose-300">{error}</OperatorPanel> : null}
      {notice ? <OperatorPanel className="border-emerald-500/40 text-sm text-emerald-300">{notice}</OperatorPanel> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <OperatorMetricCard label="Всего смен" value={weekStats.total} icon={CalendarDays} tone="blue" />
        <OperatorMetricCard label="День / ночь" value={`${weekStats.day} / ${weekStats.night}`} icon={CalendarDays} tone="default" />
        <OperatorMetricCard label="Нужно подтвердить" value={weekStats.pendingConfirm} icon={CheckCircle2} tone="amber" />
        <OperatorMetricCard label="Открытые вопросы" value={weekStats.openIssues} icon={AlertTriangle} tone="red" />
      </div>

      {loading ? (
        <OperatorPanel>
          <div className="flex items-center gap-3 font-mono text-[13px] uppercase tracking-wide text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаю ваш график…
          </div>
        </OperatorPanel>
      ) : null}

      {!loading && (!data || data.schedule.length === 0) ? (
        <OperatorPanel>
          <OperatorEmptyState title="Смен пока нет" description="На этой неделе у вас пока нет опубликованных смен." />
        </OperatorPanel>
      ) : null}

      {!loading &&
        data?.schedule.map((group) => {
          const canConfirm = Boolean(group.publication?.id && group.response?.id && group.response.status !== 'confirmed')
          const openRequests = group.requests.filter((request) => !['resolved', 'dismissed'].includes(request.status))

          return (
            <OperatorPanel key={group.company.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-mono text-[15px] font-semibold uppercase tracking-tight text-zinc-100">{group.company.name || 'Точка'}</div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                    {group.company.code ? `Код: ${group.company.code}` : 'Код точки не указан'}
                  </div>
                </div>
                <OperatorPill tone={group.response?.status === 'confirmed' ? 'emerald' : 'amber'}>
                  {group.response?.status === 'confirmed' ? 'Подтверждено' : 'Нужна проверка'}
                </OperatorPill>
              </div>

              <div className="mt-4 space-y-3">
                {group.shifts.map((shift) => (
                  <div key={`${group.company.id}:${shift.date}:${shift.shift_type}`} className="border border-[#23262b] bg-[#0b0c0d] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] font-semibold text-zinc-100">
                          {formatRuDate(shift.date, 'full')} · {shiftLabel(shift.shift_type)}
                        </div>
                        {shift.comment ? <div className="mt-1 text-xs text-zinc-500">{shift.comment}</div> : null}
                      </div>
                      {group.response?.id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-amber-300 hover:text-zinc-100"
                          onClick={() =>
                            setIssueDraft({
                              responseId: group.response!.id,
                              shiftDate: shift.date,
                              shiftType: shift.shift_type,
                              companyName: group.company.name,
                            })
                          }
                        >
                          <MessageSquareWarning className="h-4 w-4" />
                          Проблема
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {openRequests.length > 0 ? (
                <div className="mt-4 border border-amber-500/20 bg-amber-500/[0.06] p-4">
                  <div className="flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-wide text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    Открытые замечания: {openRequests.length}
                  </div>
                  <div className="mt-2 space-y-2 font-mono text-[11px] uppercase tracking-wide text-amber-200/80">
                    {openRequests.map((request) => (
                      <div key={request.id}>
                        {formatRuDate(request.shift_date)} · {shiftLabel(request.shift_type)} · {request.status}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {canConfirm ? (
                <Button type="button" className="mt-4 w-full" onClick={() => void confirmWeek(group.response!.id)} disabled={actionLoading === group.response?.id}>
                  {actionLoading === group.response?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Подтвердить график по этой точке
                </Button>
              ) : null}
            </OperatorPanel>
          )
        })}

      {issueDraft ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/80 p-3 sm:items-center sm:justify-center">
          <form onSubmit={submitIssue} className="w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[#23262b] bg-[#0e0f10] p-5">
            <div className="font-mono text-[15px] font-semibold uppercase tracking-tight text-zinc-100">Сообщить о проблеме со сменой</div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {issueDraft.companyName || 'Точка'} · {formatRuDate(issueDraft.shiftDate, 'full')} · {shiftLabel(issueDraft.shiftType)}
            </p>
            <textarea
              value={issueReason}
              onChange={(event) => setIssueReason(event.target.value)}
              className="mt-4 min-h-[120px] w-full rounded-none border border-[#23262b] bg-[#0e0f10] px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/40 focus:outline-none"
              placeholder="Коротко опишите, что не совпадает или что нужно изменить"
            />
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" className="flex-1 border-[#23262b] bg-[#0b0c0d] text-zinc-100 hover:bg-[#0e0f10]" onClick={() => { setIssueDraft(null); setIssueReason('') }}>
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={!issueReason.trim() || !!actionLoading}>
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Отправить
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
