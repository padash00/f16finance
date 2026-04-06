'use client'

import { FormEvent, useEffect, useState } from 'react'

type SupportItem = {
  id: string
  status: string
  priority: string
  message: string
  created_at: string
}

export default function ClientSupportPage() {
  const [message, setMessage] = useState('')
  const [items, setItems] = useState<SupportItem[]>([])
  const [sending, setSending] = useState(false)

  const load = () => {
    fetch('/api/client/support')
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => setItems(Array.isArray(payload?.requests) ? payload.requests : []))
      .catch(() => null)
  }

  useEffect(() => {
    load()
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim()) return
    setSending(true)
    try {
      const response = await fetch('/api/client/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (!response.ok) return
      setMessage('')
      load()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">Поддержка</h2>
      <p className="text-sm text-muted-foreground">Отправьте сообщение, и команда клуба увидит его в логе уведомлений.</p>

      <form onSubmit={onSubmit} className="space-y-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Опишите вопрос или проблему"
          className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={sending || !message.trim()}
          className="rounded-lg border border-border bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
        >
          {sending ? 'Отправка...' : 'Отправить'}
        </button>
      </form>

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
            <p className="font-medium">{item.message || 'Сообщение без текста'}</p>
            <p className="text-muted-foreground">
              Статус: {item.status} · Приоритет: {item.priority} · {new Date(item.created_at).toLocaleString('ru-RU')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
