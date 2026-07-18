'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { CardSkeleton, Skeleton } from '@/components/skeleton'
import {
  MessageSquare,
  Megaphone,
  Pin,
  Send,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'

type Message = {
  id: string
  sender_name: string
  sender_role: string
  message: string
  attachments: any
  is_announcement: boolean
  pinned_until: string | null
  context_type: string | null
  context_id: string | null
  context_label: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

type PinnedItem = {
  id: string
  sender_name: string
  message: string
  pinned_until: string | null
  is_announcement: boolean
}

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const fmtPinTtl = (until: string | null) => {
  if (!until) return ''
  const ms = new Date(until).getTime() - Date.now()
  if (ms < 0) return 'истёк'
  const days = Math.floor(ms / 86400000)
  if (days >= 1) return `до ${new Date(until).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}`
  const hours = Math.floor(ms / 3600000)
  if (hours >= 1) return `ещё ${hours}ч`
  return 'меньше часа'
}

function ChatContent() {
  const searchParams = useSearchParams()
  const contextType = searchParams.get('context_type') || ''
  const contextId = searchParams.get('context_id') || ''
  const contextLabel = searchParams.get('context_label') || ''

  const [messages, setMessages] = useState<Message[]>([])
  const [pinned, setPinned] = useState<PinnedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showAnnounce, setShowAnnounce] = useState(false)
  const [announceText, setAnnounceText] = useState('')
  const [showPinPicker, setShowPinPicker] = useState<string | null>(null)
  const [pinDate, setPinDate] = useState('')
  const [canBroadcast, setCanBroadcast] = useState(false)

  // Получаем роль для определения «может ли владелец/super-admin делать объявления»
  useEffect(() => {
    fetch('/api/auth/session-role', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        setCanBroadcast(!!(j?.isSuperAdmin || j?.staffRole === 'owner'))
      })
      .catch(() => {})
  }, [])

  const url = useMemo(() => {
    const u = new URL('/api/team-chat', window.location.origin)
    if (contextType && contextId) {
      u.searchParams.set('context_type', contextType)
      u.searchParams.set('context_id', contextId)
    }
    return u.toString()
  }, [contextType, contextId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setMessages(body.messages || [])
      setPinned(body.pinned || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [load])

  const send = async (asAnnouncement: boolean = false) => {
    const text = (asAnnouncement ? announceText : draft).trim()
    if (!text) return
    setSending(true)
    try {
      const res = await fetch('/api/team-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          isAnnouncement: asAnnouncement,
          contextType: contextType || null,
          contextId: contextId || null,
          contextLabel: contextLabel || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Ошибка')
      if (asAnnouncement) {
        setAnnounceText('')
        setShowAnnounce(false)
      } else {
        setDraft('')
      }
      load()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSending(false)
    }
  }

  const pin = async (id: string) => {
    if (!pinDate) return
    try {
      const untilIso = new Date(pinDate + 'T23:59:59').toISOString()
      const res = await fetch('/api/team-chat/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, until: untilIso }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        alert(err?.error || 'Не удалось закрепить')
        return
      }
      setShowPinPicker(null)
      setPinDate('')
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const unpin = async (id: string) => {
    await fetch('/api/team-chat/pin', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    load()
  }

  return (
    <div className="app-page-tight space-y-4">
      <AdminPageHeader
        title={contextType && contextId ? `Обсуждение${contextLabel ? `: ${contextLabel}` : ''}` : 'Командный чат'}
        icon={<MessageSquare className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <>
            {canBroadcast && !contextType && (
              <Button variant="outline" size="sm" onClick={() => setShowAnnounce(true)}>
                <Megaphone className="w-4 h-4 mr-1" />
                Объявление
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </>
        }
        toolbar={
          <p className="text-xs text-muted-foreground">
            <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-400" />
            Чат проверяется ИИ на нарушения. Не пиши лишнего.
          </p>
        }
      />

      {/* Закреплённые */}
      {pinned.length > 0 && !contextType && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/[0.04]">
          <div className="flex items-center gap-2 text-xs text-amber-300 font-semibold mb-2">
            <Pin className="w-3.5 h-3.5" />
            Закреплено
          </div>
          <div className="space-y-2">
            {pinned.map(p => (
              <div key={p.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <span className="font-medium text-foreground">{p.sender_name}: </span>
                  <span className="text-muted-foreground">{p.message}</span>
                  {p.is_announcement && (
                    <span className="ml-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      Объявление
                    </span>
                  )}
                </div>
                <button
                  className="text-xs text-muted-foreground hover:text-amber-300"
                  onClick={() => unpin(p.id)}
                >
                  {fmtPinTtl(p.pinned_until)} · открепить
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Объявление модалка */}
      {showAnnounce && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/[0.04]">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="w-4 h-4 text-amber-300" />
            <h3 className="text-sm font-semibold text-foreground">Создать объявление</h3>
          </div>
          <textarea
            value={announceText}
            onChange={e => setAnnounceText(e.target.value)}
            rows={3}
            placeholder="Объявление команде..."
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-amber-500 mb-3"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAnnounce(false)}>
              Отмена
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => send(true)}
              disabled={sending || !announceText.trim()}
            >
              <Megaphone className="w-4 h-4 mr-1" />
              Опубликовать
            </Button>
          </div>
        </Card>
      )}

      {/* Сообщения */}
      <Card className="p-4 border-border bg-card min-h-[400px]">
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        {loading && messages.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            {contextType ? 'Здесь ещё нет сообщений. Начни обсуждение.' : 'Чат пуст.'}
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map(m => (
              <div
                key={m.id}
                className={`group p-3 rounded-lg border ${
                  m.is_announcement
                    ? 'bg-amber-500/[0.06] border-amber-500/30'
                    : 'bg-background/30 border-border/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{m.sender_name}</span>
                    {m.is_announcement && (
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        Объявление
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{fmtTime(m.created_at)}</span>
                    {m.edited_at && (
                      <span className="text-[10px] text-muted-foreground italic">ред.</span>
                    )}
                  </div>
                  <div className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    {m.pinned_until && new Date(m.pinned_until).getTime() > Date.now() ? (
                      <button
                        className="text-xs text-amber-300 hover:underline"
                        onClick={() => unpin(m.id)}
                      >
                        ✕ Открепить
                      </button>
                    ) : (
                      <button
                        className="text-xs text-muted-foreground hover:text-amber-300"
                        onClick={() => {
                          setShowPinPicker(m.id)
                          const t = new Date()
                          t.setDate(t.getDate() + 7)
                          setPinDate(t.toISOString().slice(0, 10))
                        }}
                      >
                        📌 Закрепить
                      </button>
                    )}
                  </div>
                </div>
                {m.deleted_at ? (
                  <p className="text-sm text-muted-foreground italic">Сообщение удалено</p>
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">{m.message}</p>
                )}
                {showPinPicker === m.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <DatePicker
                      value={pinDate}
                      onChange={setPinDate}
                      min={new Date().toISOString().slice(0, 10)}
                      className="px-2 py-1 text-xs"
                    />
                    <Button size="sm" onClick={() => pin(m.id)}>
                      Закрепить до этой даты
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowPinPicker(null)}>
                      Отмена
                    </Button>
                  </div>
                )}
                {m.context_label && !contextType && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    📎 {m.context_label}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Input */}
      <div className="flex gap-2 sticky bottom-4">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(false)
            }
          }}
          placeholder={contextType ? 'Написать в обсуждение...' : 'Сообщение команде...'}
          className="flex-1 bg-input border border-border rounded-lg px-4 py-3 text-sm focus:border-amber-500"
        />
        <Button onClick={() => send(false)} disabled={sending || !draft.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

export default function TeamChatPage() {
  return (
    <Suspense
      fallback={
        <div className="app-page-tight space-y-4">
          <Skeleton className="h-14 w-full max-w-lg" />
          <CardSkeleton rows={6} />
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  )
}
