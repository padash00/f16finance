'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Building2, ClipboardList, Loader2, RefreshCw, ShieldCheck, Users2 } from 'lucide-react'

import { Sidebar } from '@/components/sidebar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type LeadAssignment = {
  id: string
  company_id: string
  company_name: string | null
  company_code: string | null
  role_in_company: 'senior_operator' | 'senior_cashier'
  is_primary: boolean
}

type CompanyRow = {
  id: string
  name: string
  code: string | null
  leadRole: 'senior_operator' | 'senior_cashier'
  publication: {
    id: string
    week_start: string
    week_end: string
    version: number
    status: string
    published_at: string
  } | null
}

type TeamAssignment = {
  id: string
  operator_id: string
  company_id: string
  role_in_company: 'operator' | 'senior_operator' | 'senior_cashier'
  is_primary: boolean
  operator_name: string
}

type LeadTask = {
  id: string
  task_number: number
  title: string
  status: string
  priority: string
  due_date: string | null
  operator_id: string | null
  operator_name: string | null
  company_id: string | null
}

type LeadRequest = {
  id: string
  company_id: string
  company_name: string | null
  operator_id: string
  operator_name: string
  shift_date: string
  shift_type: 'day' | 'night'
  status: string
  reason: string | null
  lead_status: string | null
  lead_action: string | null
  lead_note: string | null
  lead_replacement_operator_id: string | null
  lead_replacement_operator_name: string | null
  lead_operator_name: string | null
  lead_updated_at: string | null
  resolution_note: string | null
}

type LeadPayload = {
  ok: boolean
  lead: {
    operator: {
      id: string
      name: string
      short_name: string | null
    }
    assignments: LeadAssignment[]
  }
  companies: CompanyRow[]
  teamAssignments: TeamAssignment[]
  tasks: LeadTask[]
  requests: LeadRequest[]
  error?: string
}

function formatShiftDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  })
}

function formatRole(role: string) {
  if (role === 'senior_cashier') return 'Старший кассир'
  if (role === 'senior_operator') return 'Старший оператор'
  return 'Оператор'
}

function formatTaskStatus(status: string) {
  const map: Record<string, string> = {
    backlog: 'Бэклог',
    todo: 'К выполнению',
    in_progress: 'В работе',
    review: 'На проверке',
    done: 'Готово',
    archived: 'Архив',
  }
  return map[status] || status
}

export default function OperatorLeadPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<LeadPayload | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [replacementIds, setReplacementIds] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadData = async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      const response = await fetch('/api/operator/lead', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as LeadPayload | { error?: string } | null

      if (!response.ok || !json || !('ok' in json)) {
        throw new Error((json as { error?: string } | null)?.error || 'Не удалось загрузить контур точки')
      }

      setPayload(json)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить контур точки')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => void loadData(true), 4000)
    const sync = () => {
      if (document.visibilityState === 'visible') {
        void loadData(true)
      }
    }

    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const tasksByCompany = useMemo(() => {
    const map = new Map<string, LeadTask[]>()
    for (const task of payload?.tasks || []) {
      const bucket = map.get(String(task.company_id || '')) || []
      bucket.push(task)
      map.set(String(task.company_id || ''), bucket)
    }
    return map
  }, [payload])

  const requestsByCompany = useMemo(() => {
    const map = new Map<string, LeadRequest[]>()
    for (const request of payload?.requests || []) {
      const bucket = map.get(request.company_id) || []
      bucket.push(request)
      map.set(request.company_id, bucket)
    }
    return map
  }, [payload])

  const teamByCompany = useMemo(() => {
    const map = new Map<string, TeamAssignment[]>()
    for (const assignment of payload?.teamAssignments || []) {
      const bucket = map.get(assignment.company_id) || []
      bucket.push(assignment)
      map.set(assignment.company_id, bucket)
    }
    return map
  }, [payload])

  const handleProposal = async (requestId: string, proposalAction: 'keep' | 'remove' | 'replace') => {
    try {
      setSavingId(requestId)
      const response = await fetch('/api/operator/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submitLeadProposal',
          requestId,
          proposalAction,
          proposalNote: notes[requestId] || '',
          replacementOperatorId: proposalAction === 'replace' ? replacementIds[requestId] || null : null,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || 'Не удалось отправить предложение')
      }

      await loadData(true)
    } catch (err: any) {
      setError(err?.message || 'Не удалось отправить предложение')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="app-shell-layout">
      <Sidebar />
      <main className="app-main">
        <div className="app-page space-y-6">
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_34%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))] p-6 text-white sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex rounded-2xl bg-sky-400/10 p-4">
                  <ShieldCheck className="h-7 w-7 text-sky-300" />
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">Моя точка</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  Контур старшего по точке: своя команда, задачи компании и спорные смены, которые нужно первым делом разобрать до решения руководителя.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => router.push('/operator-dashboard?tab=schedule')}>
                  Назад в кабинет
                </Button>
                <Button onClick={() => loadData(true)} disabled={refreshing}>
                  {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Обновить
                </Button>
              </div>
            </div>
          </Card>

          {loading ? (
            <Card className="border-white/10 bg-slate-950/65 p-6 text-white">
              <div className="flex items-center gap-3 text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin text-sky-300" />
                Загружаем контур старшего...
              </div>
            </Card>
          ) : error ? (
            <Card className="border-red-500/20 bg-red-500/10 p-6 text-red-200">{error}</Card>
          ) : payload ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="border-white/10 bg-slate-950/65 p-5 text-white">
                  <div className="text-sm text-slate-400">Точек под контролем</div>
                  <div className="mt-2 text-3xl font-semibold">{payload.companies.length}</div>
                </Card>
                <Card className="border-white/10 bg-slate-950/65 p-5 text-white">
                  <div className="text-sm text-slate-400">Открытых задач</div>
                  <div className="mt-2 text-3xl font-semibold">
                    {payload.tasks.filter((task) => !['done', 'archived'].includes(task.status)).length}
                  </div>
                </Card>
                <Card className="border-white/10 bg-slate-950/65 p-5 text-white">
                  <div className="text-sm text-slate-400">Спорных смен</div>
                  <div className="mt-2 text-3xl font-semibold">
                    {payload.requests.filter((request) => ['open', 'awaiting_reason'].includes(request.status)).length}
                  </div>
                </Card>
              </div>

              <div className="space-y-5">
                {payload.companies.map((company) => {
                  const team = teamByCompany.get(company.id) || []
                  const tasks = tasksByCompany.get(company.id) || []
                  const requests = requestsByCompany.get(company.id) || []
                  const replaceCandidates = team.filter((item) => item.role_in_company === 'operator' || item.role_in_company === 'senior_operator' || item.role_in_company === 'senior_cashier')

                  return (
                    <Card key={company.id} className="border-white/10 bg-slate-950/65 p-5 text-white">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-400">
                            <Building2 className="h-3.5 w-3.5" />
                            {company.code || 'точка'}
                          </div>
                          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">{company.name}</h2>
                          <p className="mt-1 text-sm text-slate-400">{formatRole(company.leadRole)}</p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Команда</div>
                            <div className="mt-2 text-xl font-semibold">{team.length}</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Задачи</div>
                            <div className="mt-2 text-xl font-semibold">{tasks.filter((task) => !['done', 'archived'].includes(task.status)).length}</div>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Проблемы</div>
                            <div className="mt-2 text-xl font-semibold">{requests.filter((request) => ['open', 'awaiting_reason'].includes(request.status)).length}</div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr,1fr,1.2fr]">
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                            <Users2 className="h-4 w-4 text-sky-300" />
                            Команда точки
                          </div>
                          <div className="space-y-2">
                            {team.length > 0 ? team.map((member) => (
                              <div key={member.id} className="rounded-xl border border-white/6 bg-black/15 px-3 py-2">
                                <div className="text-sm font-medium">{member.operator_name}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {formatRole(member.role_in_company)}{member.is_primary ? ' • основная точка' : ''}
                                </div>
                              </div>
                            )) : (
                              <div className="text-sm text-slate-500">По этой точке пока нет активных назначений.</div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                            <ClipboardList className="h-4 w-4 text-violet-300" />
                            Задачи точки
                          </div>
                          <div className="space-y-2">
                            {tasks.length > 0 ? tasks.slice(0, 8).map((task) => (
                              <div key={task.id} className="rounded-xl border border-white/6 bg-black/15 px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium">#{task.task_number} {task.title}</div>
                                    <div className="mt-1 text-xs text-slate-500">
                                      {task.operator_name || 'Без исполнителя'} • {formatTaskStatus(task.status)}
                                    </div>
                                  </div>
                                  {task.due_date ? (
                                    <div className="text-[11px] text-slate-400">{formatShiftDate(task.due_date)}</div>
                                  ) : null}
                                </div>
                              </div>
                            )) : (
                              <div className="text-sm text-slate-500">По точке пока нет задач.</div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                            <AlertTriangle className="h-4 w-4 text-amber-300" />
                            Спорные смены
                          </div>
                          <div className="space-y-3">
                            {requests.length > 0 ? requests.map((request) => (
                              <div key={request.id} className="rounded-xl border border-white/6 bg-black/15 px-3 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium">{request.operator_name}</div>
                                    <div className="mt-1 text-xs text-slate-500">
                                      {formatShiftDate(request.shift_date)} • {request.shift_type === 'day' ? 'день' : 'ночь'}
                                    </div>
                                  </div>
                                  <div className="rounded-full bg-white/6 px-2 py-1 text-[11px] text-slate-300">
                                    {request.status === 'open'
                                      ? 'Открыто'
                                      : request.status === 'awaiting_reason'
                                        ? 'Ждём причину'
                                        : request.status === 'resolved'
                                          ? 'Решено'
                                          : 'Закрыто'}
                                  </div>
                                </div>

                                <div className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-sm text-slate-200">
                                  {request.reason || 'Причина ещё не отправлена оператором.'}
                                </div>

                                {request.lead_status === 'proposed' ? (
                                  <div className="mt-3 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-sm text-sky-100">
                                    <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300/80">Ваше предложение</div>
                                    <div className="mt-1">
                                      {request.lead_action === 'replace'
                                        ? `Поставить замену: ${request.lead_replacement_operator_name || 'оператор выбран'}`
                                        : request.lead_action === 'remove'
                                          ? 'Снять со смены'
                                          : 'Оставить как есть'}
                                    </div>
                                    {request.lead_note ? <div className="mt-1 text-sky-100/90">{request.lead_note}</div> : null}
                                  </div>
                                ) : null}

                                {['open', 'awaiting_reason'].includes(request.status) ? (
                                  <div className="mt-3 space-y-3">
                                    <textarea
                                      value={notes[request.id] || ''}
                                      onChange={(event) => setNotes((prev) => ({ ...prev, [request.id]: event.target.value }))}
                                      rows={2}
                                      placeholder="Что вы предлагаете сделать по этой смене"
                                      className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-sky-400/50"
                                    />

                                    <select
                                      value={replacementIds[request.id] || ''}
                                      onChange={(event) => setReplacementIds((prev) => ({ ...prev, [request.id]: event.target.value }))}
                                      className="h-10 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-sky-400/50"
                                    >
                                      <option value="">Выберите оператора для замены</option>
                                      {replaceCandidates
                                        .filter((item) => item.operator_id !== request.operator_id)
                                        .map((candidate) => (
                                          <option key={`${request.id}-${candidate.operator_id}`} value={candidate.operator_id}>
                                            {candidate.operator_name}
                                          </option>
                                        ))}
                                    </select>

                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleProposal(request.id, 'keep')}
                                        disabled={savingId === request.id}
                                      >
                                        Оставить как есть
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleProposal(request.id, 'remove')}
                                        disabled={savingId === request.id}
                                      >
                                        Снять со смены
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={() => handleProposal(request.id, 'replace')}
                                        disabled={savingId === request.id}
                                      >
                                        {savingId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Предложить замену
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}

                                {request.resolution_note ? (
                                  <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                                    <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-300/80">Решение руководителя</div>
                                    <div className="mt-1">{request.resolution_note}</div>
                                  </div>
                                ) : null}
                              </div>
                            )) : (
                              <div className="text-sm text-slate-500">По этой точке нет спорных смен.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  )
}
