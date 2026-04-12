'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

type PointsResponse = {
  summary?: {
    points: number
    totalSpent: number
    visits: number
  }
}

export function PointsPageClient() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get('companyId')?.trim() || ''

  const [summary, setSummary] = useState<PointsResponse['summary'] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    setLoadError(null)
    fetch('/api/client/points')
      .then(async (r) => {
        const payload = (await r.json().catch(() => null)) as PointsResponse & { error?: string } | null
        if (!r.ok) {
          setSummary(null)
          setLoadError(payload?.error === 'client-api-requires-admin-credentials' ? 'Сводка временно недоступна на сервере.' : 'Не удалось загрузить баллы.')
          return
        }
        setSummary(payload?.summary || null)
      })
      .catch(() => {
        setSummary(null)
        setLoadError('Не удалось загрузить баллы.')
      })
  }, [])

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">Баллы лояльности</h2>
      <p className="text-sm text-muted-foreground">
        Здесь суммируются баллы по всем привязанным к аккаунту точкам. Схему зала смотрите на{' '}
        <Link href={companyId ? `/client?companyId=${encodeURIComponent(companyId)}` : '/client'} className="text-sky-400 underline-offset-2 hover:underline">
          главной
        </Link>
        .
      </p>
      {loadError ? <p className="text-sm text-amber-200/90">{loadError}</p> : null}
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
