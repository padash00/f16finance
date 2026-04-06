'use client'

import { useEffect, useState } from 'react'

type PointsResponse = {
  summary?: {
    points: number
    totalSpent: number
    visits: number
  }
}

export default function ClientPointsPage() {
  const [summary, setSummary] = useState<PointsResponse['summary'] | null>(null)

  useEffect(() => {
    fetch('/api/client/points')
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: PointsResponse | null) => setSummary(payload?.summary || null))
      .catch(() => null)
  }, [])

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">Баллы лояльности</h2>
      <p className="text-sm text-muted-foreground">Сводка подтягивается из `/api/client/points`.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Баланс</p>
          <p className="mt-1 text-lg font-semibold">{summary?.points ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Визиты</p>
          <p className="mt-1 text-lg font-semibold">{summary?.visits ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Потрачено</p>
          <p className="mt-1 text-lg font-semibold">{Number(summary?.totalSpent || 0).toLocaleString('ru-RU')} ₸</p>
        </div>
      </div>
    </div>
  )
}
