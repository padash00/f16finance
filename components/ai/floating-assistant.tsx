'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, ChevronDown, Loader2, SendHorizonal, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type { AssistantChatMessage, AssistantPage, AssistantResponse, PageSnapshot } from '@/lib/ai/types'
import { cn } from '@/lib/utils'

type FloatingAssistantProps = {
  page: AssistantPage
  title: string
  snapshot?: PageSnapshot | null
  suggestedPrompts?: string[]
}

function MessageBubble({ message }: { message: AssistantChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed',
          isUser
            ? 'bg-gradient-to-r from-amber-500/25 to-orange-500/20 text-white border border-amber-500/20'
            : 'bg-white/5 text-slate-200 border border-white/10',
        )}
      >
        {message.content}
      </div>
    </div>
  )
}

export function FloatingAssistant({
  page,
  title,
  snapshot = null,
  suggestedPrompts = [],
}: FloatingAssistantProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AssistantChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const canSubmit = prompt.trim().length > 0 && !loading

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading, open])

  // Clear unread when opened
  useEffect(() => {
    if (open) setUnread(0)
  }, [open])

  const sendPrompt = async (nextPrompt?: string) => {
    const finalPrompt = (nextPrompt ?? prompt).trim()
    if (!finalPrompt || loading) return

    const nextMessages = [...messages, { role: 'user', content: finalPrompt } satisfies AssistantChatMessage]
    setMessages(nextMessages)
    setPrompt('')
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, prompt: finalPrompt, history: messages, snapshot }),
      })

      const result = (await response.json().catch(() => null)) as AssistantResponse | null
      const text = typeof result?.text === 'string' ? result.text : null
      const errorText = typeof result?.error === 'string' ? result.error : 'Не удалось получить ответ.'

      if (!response.ok || !text) throw new Error(errorText)

      const updated = [...nextMessages, { role: 'assistant', content: text } satisfies AssistantChatMessage]
      setMessages(updated)
      if (!open) setUnread((n) => n + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка соединения.')
    } finally {
      setLoading(false)
      if (open) textareaRef.current?.focus()
    }
  }

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur-md"
          style={{ maxHeight: '72vh' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-1.5">
              <Bot className="h-4 w-4 text-amber-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{title}</p>
              <p className="text-[10px] text-slate-500">AI-консультант • {page}</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
            style={{ minHeight: 160, maxHeight: 'calc(72vh - 180px)' }}
          >
            {messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 text-xs text-slate-300 mb-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                  Готов к анализу
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Работаю только с реальными данными этой страницы. Спроси про риски, тренды или план действий.
                </p>
              </div>
            ) : (
              messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
            )}

            {loading && (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin text-amber-300" />
                Анализирую данные...
              </div>
            )}
          </div>

          {/* Suggested prompts */}
          {suggestedPrompts.length > 0 && messages.length === 0 && (
            <div className="border-t border-white/8 px-3 py-2 flex flex-wrap gap-1.5">
              {suggestedPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void sendPrompt(p)}
                  disabled={loading}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-400 hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-white transition-colors disabled:opacity-40"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mx-3 mb-1 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {error}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-white/10 p-3 space-y-2">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Спроси про данные этой страницы..."
              className="min-h-[60px] max-h-[120px] resize-none border-white/10 bg-white/[0.04] text-white text-xs placeholder:text-slate-600 focus:border-amber-500/30"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void sendPrompt()
                }
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-600">Ctrl+Enter — отправить</span>
              <Button
                type="button"
                size="sm"
                onClick={() => void sendPrompt()}
                disabled={!canSubmit}
                className="h-7 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-black text-xs hover:from-amber-400 hover:to-orange-400 px-3"
              >
                <SendHorizonal className="mr-1.5 h-3 w-3" />
                Спросить
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'fixed bottom-5 right-5 z-50 flex h-13 w-13 items-center justify-center rounded-2xl shadow-2xl transition-all duration-200',
          open
            ? 'bg-slate-800 border border-white/10 text-amber-300'
            : 'bg-gradient-to-br from-amber-500 to-orange-500 text-black hover:scale-105 hover:shadow-amber-500/30',
        )}
        style={{ height: 52, width: 52 }}
        title={open ? 'Свернуть' : 'AI-консультант'}
      >
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <>
            <Bot className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {unread}
              </span>
            )}
          </>
        )}
      </button>
    </>
  )
}
