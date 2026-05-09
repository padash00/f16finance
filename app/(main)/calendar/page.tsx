'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Gift, Star, Megaphone } from 'lucide-react'

type Event = {
  date: string
  type: 'shift' | 'birthday' | 'holiday' | 'announcement'
  title: string
  subtitle: string | null
  color: string | null
}

const ICONS: Record<string, any> = {
  shift: Clock,
  birthday: Gift,
  holiday: Star,
  announcement: Megaphone,
}

const fmtMonth = (y: number, m: number) => {
  const d = new Date(y, m, 1)
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

const fmtDay = (date: string) => {
  const d = new Date(date + 'T12:00:00')
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', weekday: 'short' })
}

export default function CalendarPage() {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)

  const range = useMemo(() => {
    const from = new Date(year, month, 1)
    const to = new Date(year, month + 1, 0)
    const f = (d: Date) => d.toISOString().slice(0, 10)
    return { from: f(from), to: f(to) }
  }, [year, month])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/calendar?from=${range.from}&to=${range.to}`, { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) setEvents(j.events || [])
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  const grouped = useMemo(() => {
    const m: Record<string, Event[]> = {}
    for (const e of events) {
      if (!m[e.date]) m[e.date] = []
      m[e.date].push(e)
    }
    return m
  }, [events])

  const sortedDates = Object.keys(grouped).sort()

  return (
    <div className="app-page-wide space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-purple-500/10 rounded-xl">
            <CalendarDays className="w-7 h-7 text-purple-300" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Календарь</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">Смены · ДР · праздники РК · объявления</p>
          </div>
        </div>
      </div>

      <Card className="p-4 border-border bg-card flex items-center justify-between gap-3">
        <Button variant="outline" size="icon" onClick={() => {
          if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1)
        }}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <h2 className="text-lg font-semibold text-foreground capitalize">
          {fmtMonth(year, month)}
        </h2>
        <Button variant="outline" size="icon" onClick={() => {
          if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1)
        }}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </Card>

      {loading && events.length === 0 && (
        <div className="text-center py-10 text-muted-foreground text-sm">Загрузка...</div>
      )}

      {!loading && events.length === 0 && (
        <Card className="p-10 border-border bg-card text-center text-muted-foreground text-sm">
          В этом месяце нет событий
        </Card>
      )}

      <div className="space-y-3">
        {sortedDates.map(date => (
          <Card key={date} className="p-4 border-border bg-card">
            <div className="text-sm font-semibold text-foreground mb-2 capitalize">
              {fmtDay(date)}
            </div>
            <div className="space-y-2">
              {grouped[date].map((e, idx) => {
                const Icon = ICONS[e.type] || CalendarDays
                return (
                  <div key={idx} className="flex items-start gap-3 p-2 rounded-lg hover:bg-white/[0.03]">
                    <div
                      className="p-2 rounded-lg shrink-0"
                      style={{ backgroundColor: (e.color || '#888') + '22' }}
                    >
                      <Icon className="w-4 h-4" style={{ color: e.color || '#888' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{e.title}</div>
                      {e.subtitle && (
                        <div className="text-xs text-muted-foreground mt-0.5">{e.subtitle}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
