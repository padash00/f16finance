'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Send, MessageSquare, Search, ArrowLeft, RefreshCw } from 'lucide-react'

type Thread = {
  otherUserId: string
  otherName: string
  lastMessage: string
  lastAt: string
  lastFromMe: boolean
  unreadCount: number
}

type Message = {
  id: string
  sender_user_id: string
  recipient_user_id: string
  sender_name: string
  message: string
  created_at: string
  read_at: string | null
}

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function MessagesPage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeUser, setActiveUser] = useState<{ id: string; name: string } | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const loadMyId = useCallback(async () => {
    const r = await fetch('/api/auth/session-role', { cache: 'no-store' })
    const j = await r.json()
    if (j?.userId) setMyUserId(j.userId)
  }, [])

  const loadThreads = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/direct-messages/threads', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) setThreads(j.threads || [])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMessages = useCallback(async (userId: string) => {
    const r = await fetch(`/api/direct-messages/${userId}`, { cache: 'no-store' })
    const j = await r.json()
    if (r.ok) {
      setMessages(j.messages || [])
      // Update unread count for this thread
      setThreads(t => t.map(thr => thr.otherUserId === userId ? { ...thr, unreadCount: 0 } : thr))
    }
  }, [])

  useEffect(() => {
    loadMyId()
    loadThreads()
  }, [loadMyId, loadThreads])

  // Polling
  useEffect(() => {
    const id = setInterval(() => {
      loadThreads()
      if (activeUser) loadMessages(activeUser.id)
    }, 3000)
    return () => clearInterval(id)
  }, [activeUser, loadMessages, loadThreads])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!draft.trim() || !activeUser) return
    const text = draft.trim()
    setDraft('')
    // Optimistic
    setMessages(prev => [...prev, {
      id: 'tmp-' + Date.now(),
      sender_user_id: myUserId || '',
      recipient_user_id: activeUser.id,
      sender_name: 'Вы',
      message: text,
      created_at: new Date().toISOString(),
      read_at: null,
    }])
    try {
      const r = await fetch('/api/direct-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientUserId: activeUser.id, message: text }),
      })
      if (r.ok) loadMessages(activeUser.id)
      else {
        const err = await r.json().catch(() => null)
        alert(err?.error || 'Не удалось отправить')
      }
    } catch (e: any) {
      alert(e.message)
    }
  }

  const filteredThreads = useMemo(() => {
    if (!search.trim()) return threads
    const q = search.toLowerCase()
    return threads.filter(t => t.otherName.toLowerCase().includes(q) || t.lastMessage.toLowerCase().includes(q))
  }, [threads, search])

  return (
    <div className="app-page-wide max-w-6xl mx-auto" style={{ height: 'calc(100vh - 100px)' }}>
      <div className="flex items-center gap-4 mb-4">
        <div className="p-2 bg-blue-500/10 rounded-lg">
          <MessageSquare className="w-6 h-6 text-blue-300" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Сообщения</h1>
          <p className="text-xs text-muted-foreground">Личные переписки внутри приложения</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 h-full">
        {/* Левая колонка — список переписок */}
        <Card className={`col-span-12 md:col-span-4 border-border bg-card overflow-hidden flex flex-col ${activeUser ? 'hidden md:flex' : ''}`}>
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2 bg-input border border-border rounded-lg px-3 py-1.5">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="bg-transparent flex-1 outline-none text-sm"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && threads.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Загрузка...</div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Переписок ещё нет</div>
            ) : (
              filteredThreads.map(t => (
                <button
                  key={t.otherUserId}
                  onClick={() => {
                    setActiveUser({ id: t.otherUserId, name: t.otherName })
                    loadMessages(t.otherUserId)
                  }}
                  className={`w-full text-left p-3 border-b border-border/50 hover:bg-white/[0.03] transition-colors ${
                    activeUser?.id === t.otherUserId ? 'bg-white/[0.05]' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center text-orange-300 font-bold shrink-0">
                      {t.otherName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground truncate">{t.otherName}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">{fmtTime(t.lastAt)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className={`text-xs truncate ${t.unreadCount > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {t.lastFromMe ? 'Вы: ' : ''}{t.lastMessage}
                        </span>
                        {t.unreadCount > 0 && (
                          <span className="text-[10px] font-bold text-white bg-orange-500 rounded-full px-1.5 min-w-[18px] text-center">
                            {t.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Правая колонка — переписка */}
        <Card className={`col-span-12 md:col-span-8 border-border bg-card overflow-hidden flex flex-col ${!activeUser ? 'hidden md:flex' : ''}`}>
          {!activeUser ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Выберите переписку слева
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-border flex items-center gap-3">
                <button
                  className="md:hidden text-muted-foreground hover:text-foreground"
                  onClick={() => setActiveUser(null)}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-9 h-9 rounded-full bg-orange-500/15 flex items-center justify-center text-orange-300 font-bold">
                  {activeUser.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{activeUser.name}</div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm py-10">
                    Начни переписку — отправь первое сообщение
                  </div>
                ) : (
                  messages.map(m => {
                    const isMine = m.sender_user_id === myUserId
                    return (
                      <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] px-3 py-2 rounded-2xl ${
                          isMine ? 'bg-orange-500 text-white' : 'bg-white/[0.06] text-foreground'
                        }`}>
                          <div className="text-sm whitespace-pre-wrap break-words">{m.message}</div>
                          <div className={`text-[10px] mt-1 ${isMine ? 'text-white/70' : 'text-muted-foreground'}`}>
                            {fmtTime(m.created_at)}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="p-3 border-t border-border flex gap-2">
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  placeholder="Сообщение..."
                  className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-orange-500"
                />
                <Button onClick={send} disabled={!draft.trim()} className="bg-orange-600 hover:bg-orange-700">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
