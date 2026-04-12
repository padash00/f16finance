'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'

import { formatClientApiError } from '@/app/(client)/lib/client-errors'

type SupportItem = {
  id: string
  status: string
  priority: string
  message: string
  created_at: string
}

export function SupportPageClient() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get('companyId')?.trim() || ''

  const [message, setMessage] = useState('')
  const [items, setItems] = useState<SupportItem[]>([])
  const [sending, setSending] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const load = () => {
    setLoadError(null)
    fetch('/api/client/support')
      .then(async (r) => {
        const payload = await r.json().catch(() => null)
        if (!r.ok) {
          setItems([])
          setLoadError(formatClientApiError(payload?.error, 'Не удалось загрузить обращения.'))
          return
        }
        setItems(Array.isArray(payload?.requests) ? payload.requests : [])
      })
      .catch(() => {
        setItems([])
        setLoadError('Не удалось загрузить обращения.')
      })
  }

  useEffect(() => {
    load()
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim()) return
    setSending(true)
    setSendError(null)
    try {
      const response = await fetch('/api/client/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, companyId: companyId || undefined }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const raw = typeof payload?.error === 'string' ? payload.error : ''
        const friendly =
          raw.includes('row-level security') || raw.includes('RLS')
            ? 'Сервер отклонил сохранение. Обновите приложение или обратитесь в клуб — если ошибка повторяется, напишите администратору.'
            : formatClientApiError(payload?.error, raw || 'Не удалось отправить обращение.')
        setSendError(friendly)
        return
      }
      setMessage('')
      load()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">Поддержка</h2>
      <p className="text-sm text-muted-foreground">
        Сообщение уходит в выбранную точку. Точку можно сменить на{' '}
        <Link href={companyId ? `/client?companyId=${encodeURIComponent(companyId)}` : '/client'} className="text-sky-400 underline-offset-2 hover:underline">
          главной
        </Link>
        .
      </p>
      {!companyId ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Если у вас несколько клубов в одном аккаунте, сначала выберите точку на главной — иначе отправка может не пройти.
        </p>
      ) : null}
      {loadError ? <p className="text-sm text-amber-200/90">{loadError}</p> : null}
      {sendError ? <p className="text-sm text-amber-200/90">{sendError}</p> : null}

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
