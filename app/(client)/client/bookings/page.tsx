'use client'

import { type FormEvent, useEffect, useState } from 'react'

type BookingRow = {
  id: string
  starts_at: string
  ends_at: string | null
  status: string
  notes: string | null
}

export default function ClientBookingsPage() {
  const [rows, setRows] = useState<BookingRow[]>([])
  const [startsAt, setStartsAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    fetch('/api/client/bookings?limit=20')
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => setRows(Array.isArray(payload?.bookings) ? payload.bookings : []))
      .catch(() => null)
  }

  useEffect(() => {
    load()
  }, [])

  const submitBooking = async (event: FormEvent) => {
    event.preventDefault()
    if (!startsAt) return
    setSaving(true)
    try {
      const response = await fetch('/api/client/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsAt: new Date(startsAt).toISOString(), notes }),
      })
      if (!response.ok) return
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
        Здесь отображаются брони из выделенной таблицы `client_bookings`.
      </p>
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
