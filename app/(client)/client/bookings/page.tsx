'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { formatClientApiError } from '@/app/(client)/lib/client-errors'

type BookingRow = {
  id: string
  starts_at: string
  ends_at: string | null
  status: string
  notes: string | null
}

export default function ClientBookingsPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get('companyId')?.trim() || ''

  const [rows, setRows] = useState<BookingRow[]>([])
  const [startsAt, setStartsAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const bookingsQuery = useMemo(() => {
    const base = 'limit=20'
    if (!companyId) return base
    return `${base}&companyId=${encodeURIComponent(companyId)}`
  }, [companyId])

  const load = () => {
    setLoadError(null)
    fetch(`/api/client/bookings?${bookingsQuery}`)
      .then(async (r) => {
        const payload = await r.json().catch(() => null)
        if (!r.ok) {
          setRows([])
          setLoadError(formatClientApiError(payload?.error, 'Не удалось загрузить брони.'))
          return
        }
        setRows(Array.isArray(payload?.bookings) ? payload.bookings : [])
      })
      .catch(() => {
        setRows([])
        setLoadError('Не удалось загрузить брони.')
      })
  }

  useEffect(() => {
    load()
  }, [bookingsQuery])

  const submitBooking = async (event: FormEvent) => {
    event.preventDefault()
    if (!startsAt) return
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch('/api/client/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt: new Date(startsAt).toISOString(),
          notes,
          companyId: companyId || undefined,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setSaveError(formatClientApiError(payload?.error, payload?.error || 'Не удалось отправить запрос на бронь.'))
        return
      }
      setStartsAt('')
      setNotes('')
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">Мои брони</h2>
      <p className="text-sm text-muted-foreground">
        Запрос уходит в выбранную точку клуба. Схему зала и список станций можно посмотреть на{' '}
        <Link href={companyId ? `/client?companyId=${encodeURIComponent(companyId)}` : '/client'} className="text-sky-400 underline-offset-2 hover:underline">
          главной
        </Link>
        .
      </p>
      {!companyId ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Если у вас несколько точек в одном аккаунте, откройте главную и выберите клуб — иначе бронь не отправится.
        </p>
      ) : null}
      {loadError ? <p className="text-sm text-amber-200/90">{loadError}</p> : null}
      {saveError ? <p className="text-sm text-amber-200/90">{saveError}</p> : null}
      <form onSubmit={submitBooking} className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
        <p className="text-sm font-medium">Новая бронь</p>
        <input
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          required
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Комментарий (необязательно)"
          className="min-h-20 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={saving || !startsAt}
          className="rounded-lg border border-border bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
        >
          {saving ? 'Отправка...' : 'Запросить бронь'}
        </button>
      </form>
      <div className="space-y-2">
        {rows.map((item) => (
          <div key={item.id} className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
            <p className="font-medium">Начало: {new Date(item.starts_at).toLocaleString('ru-RU')}</p>
            <p className="text-muted-foreground">
              Статус: {item.status}
              {item.ends_at ? ` · Окончание: ${new Date(item.ends_at).toLocaleString('ru-RU')}` : ''}
            </p>
            {item.notes ? <p className="mt-1 text-muted-foreground">{item.notes}</p> : null}
          </div>
        ))}
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Пока нет бронирований.</p> : null}
      </div>
    </div>
  )
}
