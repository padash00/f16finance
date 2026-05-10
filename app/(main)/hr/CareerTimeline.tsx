'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Briefcase,
  Clock,
  Filter,
  Loader2,
  RefreshCw,
  Repeat,
  UserCheck,
  UserMinus,
  UserPlus,
  Pencil,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Event = {
  id: string
  kind: 'staff' | 'operator'
  target_id: string
  target_name: string | null
  action: string
  payload: any
  actor_name: string | null
  created_at: string
}

const ACTION_META: Record<
  string,
  { label: string; icon: any; color: string; verb: (e: Event) => string }
> = {
  create: {
    label: 'Найм',
    icon: UserPlus,
    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    verb: (e) => {
      const role = e.payload?.role || ''
      const sourceText = role ? ` как ${role}` : ''
      return `Нанят${sourceText}`
    },
  },
  dismiss: {
    label: 'Увольнение',
    icon: UserMinus,
    color: 'bg-red-500/15 text-red-300 border-red-500/30',
    verb: (e) => {
      const reason = e.payload?.reason ? `: «${e.payload.reason}»` : ''
      return `Уволен${reason}`
    },
  },
  restore: {
    label: 'Восстановление',
    icon: UserCheck,
    color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    verb: () => 'Восстановлен после увольнения',
  },
  promote: {
    label: 'Повышение',
    icon: ArrowUpCircle,
    color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    verb: (e) => {
      const role = e.payload?.new_role
      return role ? `Повышен до ${role}` : 'Повышен до админа'
    },
  },
  demote: {
    label: 'Понижение',
    icon: ArrowDownCircle,
    color: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    verb: () => 'Понижен до обычного оператора',
  },
  change_role: {
    label: 'Смена должности',
    icon: Repeat,
    color: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    verb: (e) => `Сменил должность на ${e.payload?.new_role || '—'}`,
  },
  update: {
    label: 'Обновление',
    icon: Pencil,
    color: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
    verb: (e) => {
      const fields = Array.isArray(e.payload?.fields) ? e.payload.fields : []
      return fields.length > 0 ? `Изменены поля: ${fields.join(', ')}` : 'Профиль обновлён'
    },
  },
}

type Period = 7 | 30 | 90 | 365

export default function CareerTimeline() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>(30)
  const [actionFilter, setActionFilter] = useState<string>('all')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/hr/timeline?days=${period}&limit=200`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setEvents((data.data || []) as Event[])
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const filtered = useMemo(() => {
    if (actionFilter === 'all') return events
    return events.filter((e) => e.action === actionFilter)
  }, [events, actionFilter])

  const stats = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of events) c[e.action] = (c[e.action] || 0) + 1
    return c
  }, [events])

  // Группируем по датам
  const grouped = useMemo(() => {
    const map = new Map<string, Event[]>()
    for (const e of filtered) {
      const date = new Date(e.created_at).toISOString().slice(0, 10)
      const arr = map.get(date) || []
      arr.push(e)
      map.set(date, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <div className="space-y-4">
      {/* Stats / period selector */}
      <Card className="p-4 bg-gray-900/70 border-gray-800">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-500" />
            {([7, 30, 90, 365] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  period === p
                    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                    : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                }`}
              >
                {p === 7 ? '7 дней' : p === 30 ? 'Месяц' : p === 90 ? 'Квартал' : 'Год'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="border-gray-700">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>

        {/* Mini-stats */}
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
          <StatChip label="Всего" value={events.length} active={actionFilter === 'all'} onClick={() => setActionFilter('all')} />
          <StatChip label="Найм"  value={stats.create || 0}    active={actionFilter === 'create'}      onClick={() => setActionFilter('create')}      tone="emerald" />
          <StatChip label="Увол." value={stats.dismiss || 0}   active={actionFilter === 'dismiss'}     onClick={() => setActionFilter('dismiss')}     tone="red" />
          <StatChip label="Повыш" value={stats.promote || 0}   active={actionFilter === 'promote'}     onClick={() => setActionFilter('promote')}     tone="amber" />
          <StatChip label="Пониж" value={stats.demote || 0}    active={actionFilter === 'demote'}      onClick={() => setActionFilter('demote')}      tone="orange" />
          <StatChip label="Роль"  value={stats.change_role || 0} active={actionFilter === 'change_role'} onClick={() => setActionFilter('change_role')} tone="blue" />
        </div>
      </Card>

      {/* Timeline */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground bg-gray-900/60 border-gray-800">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500 mx-auto mb-2" />
          Загружаем события…
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground bg-gray-900/60 border-gray-800">
          За выбранный период событий нет.
        </Card>
      ) : (
        <Card className="p-5 bg-gray-900/60 border-gray-800">
          <div className="space-y-6">
            {grouped.map(([date, items]) => (
              <div key={date}>
                <div className="sticky top-0 z-10 -mx-1 px-1 mb-3">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-gray-800/80 backdrop-blur border border-gray-700">
                    <Clock className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-medium text-gray-300">{formatGroupDate(date)}</span>
                    <span className="text-[10px] text-gray-500">· {items.length}</span>
                  </div>
                </div>
                <div className="relative pl-6 space-y-3">
                  <div className="absolute left-2 top-1 bottom-1 w-px bg-gray-800" />
                  {items.map((e) => (
                    <EventRow key={e.id} event={e} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function EventRow({ event }: { event: Event }) {
  const meta = ACTION_META[event.action] || ACTION_META.update
  const Icon = meta.icon
  const time = new Date(event.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="relative">
      <div className={`absolute -left-[26px] top-1 w-6 h-6 rounded-full flex items-center justify-center border ${meta.color}`}>
        <Icon className="w-3 h-3" />
      </div>
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 hover:border-gray-700 transition">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium text-white text-sm">{event.target_name || '—'}</span>
          <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${event.kind === 'operator' ? 'border-blue-500/40 text-blue-400 bg-blue-500/10' : 'border-amber-500/40 text-amber-400 bg-amber-500/10'}`}>
            {event.kind === 'operator' ? 'Operator' : 'Staff'}
          </span>
          <span className="text-xs text-gray-400">{meta.verb(event)}</span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
          <span>{time}</span>
          {event.actor_name && (
            <>
              <span>·</span>
              <span>by {event.actor_name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatChip({
  label,
  value,
  active,
  onClick,
  tone = 'indigo',
}: {
  label: string
  value: number
  active?: boolean
  onClick?: () => void
  tone?: 'indigo' | 'emerald' | 'red' | 'amber' | 'orange' | 'blue'
}) {
  const toneMap = {
    indigo: 'border-indigo-500/40 text-indigo-300 bg-indigo-500/10',
    emerald: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
    red: 'border-red-500/40 text-red-300 bg-red-500/10',
    amber: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
    orange: 'border-orange-500/40 text-orange-300 bg-orange-500/10',
    blue: 'border-blue-500/40 text-blue-300 bg-blue-500/10',
  }
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1.5 rounded-lg border text-left transition ${
        active ? toneMap[tone] + ' ring-1 ring-current/30' : 'border-gray-800 bg-gray-900/40 text-gray-400 hover:border-gray-700'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </button>
  )
}

function formatGroupDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
