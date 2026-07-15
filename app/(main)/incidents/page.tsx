'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, Sparkles, StickyNote } from 'lucide-react'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type IncidentRow = {
  id: string
  company_id: string
  shift_id: string | null
  kind: 'violation' | 'bonus' | 'note'
  title: string
  description: string | null
  fine_amount: number
  bonus_amount: number
  severity: 'info' | 'normal' | 'warning' | 'critical'
  status: 'draft' | 'confirmed' | 'disputed' | 'voided'
  source: 'manual' | 'checklist' | 'auto' | 'import'
  occurred_at: string
  company?: { id: string; name: string; code: string | null } | null
  subject?: { id: string; full_name: string; short_name: string | null } | null
  reporter?: { id: string; full_name: string; short_name: string | null } | null
  article?: { id: string; title: string; slug: string } | null
}

const KIND_LABEL: Record<string, string> = {
  violation: 'Нарушение',
  bonus: 'Бонус',
  note: 'Заметка',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  confirmed: 'Подтверждён',
  disputed: 'Спорный',
  voided: 'Аннулирован',
}

const SEVERITY_LABEL: Record<string, string> = {
  info: 'Инфо',
  normal: 'Норма',
  warning: 'Предупр.',
  critical: 'Критично',
}

function fmtMoney(value: number | null | undefined) {
  const v = Number(value || 0)
  if (!v) return '—'
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

function kindIcon(kind: IncidentRow['kind']) {
  if (kind === 'violation') return <ShieldAlert className="h-3.5 w-3.5" />
  if (kind === 'bonus') return <Sparkles className="h-3.5 w-3.5" />
  return <StickyNote className="h-3.5 w-3.5" />
}

function kindBadgeClass(kind: IncidentRow['kind']) {
  if (kind === 'violation') return 'bg-rose-500/15 text-rose-700 dark:text-rose-200'
  if (kind === 'bonus') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
  return 'bg-slate-500/15 text-body'
}

function statusBadgeClass(status: IncidentRow['status']) {
  if (status === 'confirmed') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
  if (status === 'disputed') return 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
  if (status === 'voided') return 'bg-slate-500/15 text-body'
  return 'bg-sky-500/15 text-sky-700 dark:text-sky-200'
}

export default function IncidentsPage() {
  const [rows, setRows] = useState<IncidentRow[]>([])
  const [kind, setKind] = useState<'all' | 'violation' | 'bonus' | 'note'>('all')
  const [status, setStatus] = useState<'all' | 'draft' | 'confirmed' | 'disputed' | 'voided'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useMemo(
    () => async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const url = new URL('/api/admin/incidents', window.location.origin)
        if (kind !== 'all') url.searchParams.set('kind', kind)
        if (status !== 'all') url.searchParams.set('status', status)
        url.searchParams.set('limit', '200')
        const res = await fetch(url.toString(), { signal, credentials: 'include' })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Ошибка загрузки')
        setRows((data?.data?.incidents || []) as IncidentRow[])
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setError(e?.message || 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    },
    [kind, status],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  const summary = useMemo(() => {
    let fines = 0
    let bonuses = 0
    let violations = 0
    let bonusCount = 0
    for (const row of rows) {
      if (row.status !== 'confirmed') continue
      if (row.kind === 'violation') {
        fines += Number(row.fine_amount || 0)
        violations += 1
      }
      if (row.kind === 'bonus') {
        bonuses += Number(row.bonus_amount || 0)
        bonusCount += 1
      }
    }
    return { fines, bonuses, violations, bonusCount }
  }, [rows])

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Инциденты"
        description="Нарушения, бонусы и заметки — авто-штрафы по чек-листам и ручные записи"
        icon={<AlertTriangle className="h-5 w-5" />}
        accent="amber"
        backHref="/"
        actions={
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'violation', 'bonus', 'note'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    kind === value
                      ? 'border-amber-400/50 bg-amber-500/15 text-amber-700 dark:text-amber-200'
                      : 'border-border text-muted-foreground hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {value === 'all' ? 'Все' : KIND_LABEL[value]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'confirmed', 'disputed', 'draft', 'voided'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatus(value)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    status === value
                      ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                      : 'border-border text-muted-foreground hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {value === 'all' ? 'Все статусы' : STATUS_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        <Card className="border-rose-500/30 bg-rose-500/5 p-3 sm:p-4">
          <div className="text-xs text-rose-600/70 dark:text-rose-300/70">Штрафы (подтв.)</div>
          <div className="mt-1 text-xl font-semibold text-rose-700 dark:text-rose-200">{fmtMoney(summary.fines)}</div>
          <div className="text-xs text-slate-400">{summary.violations} нарушений</div>
        </Card>
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-3 sm:p-4">
          <div className="text-xs text-emerald-600/70 dark:text-emerald-300/70">Бонусы (подтв.)</div>
          <div className="mt-1 text-xl font-semibold text-emerald-700 dark:text-emerald-200">{fmtMoney(summary.bonuses)}</div>
          <div className="text-xs text-slate-400">{summary.bonusCount} бонусов</div>
        </Card>
        <Card className="border-border p-3 sm:p-4">
          <div className="text-xs text-slate-400">Всего записей</div>
          <div className="mt-1 text-xl font-semibold text-foreground">{rows.length}</div>
        </Card>
        <Card className="border-border p-3 sm:p-4">
          <div className="text-xs text-slate-400">Чистый эффект</div>
          <div
            className={`mt-1 text-xl font-semibold ${
              summary.bonuses - summary.fines >= 0 ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-700 dark:text-rose-200'
            }`}
          >
            {fmtMoney(summary.bonuses - summary.fines)}
          </div>
        </Card>
      </div>

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">{error}</Card>
      )}

      <Card className="overflow-hidden border-border">
        <AdminTableViewport>
          <table className="w-full min-w-[900px] text-sm">
            <thead className={adminTableStickyTheadClass}>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Заголовок</th>
                <th className="px-3 py-2">Точка</th>
                <th className="px-3 py-2">Сотрудник</th>
                <th className="px-3 py-2">Источник</th>
                <th className="px-3 py-2 text-right">Штраф</th>
                <th className="px-3 py-2 text-right">Бонус</th>
                <th className="px-3 py-2">Когда</th>
                <th className="px-3 py-2">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/5">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    Нет инцидентов по выбранному фильтру
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${kindBadgeClass(
                          row.kind,
                        )}`}
                      >
                        {kindIcon(row.kind)} {KIND_LABEL[row.kind]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      <div className="font-medium">{row.title}</div>
                      {row.description && (
                        <div className="text-xs text-slate-400">{row.description}</div>
                      )}
                      <div className="mt-0.5 text-xs text-slate-500">
                        {SEVERITY_LABEL[row.severity] || row.severity}
                        {row.article ? ` · ${row.article.title}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-body">{row.company?.name || '—'}</td>
                    <td className="px-3 py-2 text-body">
                      {row.subject?.short_name || row.subject?.full_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{row.source}</td>
                    <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-300">{fmtMoney(row.fine_amount)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-300">{fmtMoney(row.bonus_amount)}</td>
                    <td className="px-3 py-2 text-body">{fmtDateTime(row.occurred_at)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(row.status)}`}
                      >
                        {STATUS_LABEL[row.status] || row.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminTableViewport>
      </Card>
    </div>
  )
}
