'use client'

/**
 * Copilot Panel — интерактивный AI-ассистент с inline-кнопками.
 *
 * Отличие от старого AssistantPanel:
 * - Использует /api/ai/copilot endpoint (38 tools, capabilities filter)
 * - Поддерживает кнопки в ответах (выбор параметров, подтверждение действий)
 * - Поэтапный диалог для action'ов (выдай аванс → кому → точка → сумма → ...)
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Check, Loader2, RefreshCcw, SendHorizonal, Sparkles, User, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type CopilotMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  buttons?: Array<{
    label: string
    callbackData: string
    style?: 'primary' | 'secondary' | 'danger'
  }>
  isAction?: boolean // assistant message with action buttons
}

type CopilotPanelProps = {
  currentPath: string
  className?: string
  suggestedPrompts?: string[]
}

const DEFAULT_PROMPTS = [
  'Покажи выручку за неделю',
  'Кто работает сегодня?',
  'Cashflow за месяц',
  'Расходы по категориям',
  'PI рейтинг операторов',
  'Низкие остатки',
]

export function CopilotPanel({ currentPath, className, suggestedPrompts = DEFAULT_PROMPTS }: CopilotPanelProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
  }, [messages, busy])

  async function callCopilot(payload: { text?: string; callbackData?: string }) {
    setBusy(true)
    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, currentPath }),
      })
      const data = await res.json()
      if (!res.ok) {
        appendMessage('assistant', data?.error || 'Ошибка AI', undefined, false)
        return
      }
      appendMessage(
        'assistant',
        data.text || '...',
        data.buttons,
        Boolean(data.meta?.activeTool),
      )
    } catch (e: any) {
      appendMessage('assistant', `Сеть: ${e?.message || 'unknown'}`, undefined, false)
    } finally {
      setBusy(false)
    }
  }

  function appendMessage(
    role: 'user' | 'assistant',
    text: string,
    buttons?: CopilotMessage['buttons'],
    isAction?: boolean,
  ) {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role, text, buttons, isAction },
    ])
  }

  async function handleSend(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    appendMessage('user', trimmed)
    setInput('')
    await callCopilot({ text: trimmed })
  }

  async function handleButtonClick(callbackData: string, label: string) {
    if (busy) return

    // open:<path> — навигация на страницу проекта без вызова AI
    if (callbackData.startsWith('open:')) {
      const path = callbackData.slice(5)
      router.push(path)
      return
    }

    // Показываем выбор пользователя как сообщение
    appendMessage('user', label)
    await callCopilot({ callbackData })
  }

  function handleClear() {
    setMessages([])
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header strip */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/8">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500">
            <Sparkles className="h-4 w-4 text-black" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">AI Copilot</div>
            <div className="text-[11px] text-slate-500">Действия, аналитика, диалог</div>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={busy}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
            title="Очистить"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4">
        <div ref={scrollRef} className="space-y-4 py-4">
          {messages.length === 0 && (
            <EmptyState onPrompt={handleSend} prompts={suggestedPrompts} />
          )}

          {messages.map((msg) => (
            <div key={msg.id}>
              <div className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'assistant' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-amber-300 mt-0.5">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-amber-500/15 to-orange-500/15 text-slate-900 dark:text-white border border-amber-500/20'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10',
                  )}
                >
                  {msg.text}
                </div>
                {msg.role === 'user' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-white/8 text-slate-600 dark:text-slate-300 mt-0.5">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>

              {/* Buttons (under assistant message) */}
              {msg.role === 'assistant' && msg.buttons && msg.buttons.length > 0 && (
                <div className="ml-9 mt-2 flex flex-wrap gap-1.5">
                  {msg.buttons.map((b, i) => {
                    const isPrimary = b.style === 'primary' || b.callbackData === 'confirm'
                    const isDanger = b.style === 'danger' || b.callbackData === 'cancel'
                    return (
                      <button
                        key={`${msg.id}-${i}`}
                        type="button"
                        onClick={() => handleButtonClick(b.callbackData, b.label)}
                        disabled={busy}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50',
                          isPrimary
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
                            : isDanger
                              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25'
                              : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10',
                        )}
                      >
                        {isPrimary && <Check className="inline h-3 w-3 mr-1" />}
                        {isDanger && <X className="inline h-3 w-3 mr-1" />}
                        {b.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-slate-500 ml-9">
              <Loader2 className="h-3 w-3 animate-spin" />
              Думаю...
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-slate-200 dark:border-white/8 p-3">
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend(input)
              }
            }}
            placeholder="Напиши что нужно сделать..."
            rows={1}
            disabled={busy}
            className="resize-none bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 text-sm min-h-[40px]"
          />
          <Button
            type="button"
            onClick={() => handleSend(input)}
            disabled={busy || !input.trim()}
            className="shrink-0 bg-gradient-to-r from-amber-500 to-orange-500 text-black hover:from-amber-400 hover:to-orange-400"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
          </Button>
        </div>
        <div className="mt-2 text-[10px] text-slate-500">
          Контекст: {currentPath}. Доступ к действиям зависит от твоих прав.
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onPrompt, prompts }: { onPrompt: (text: string) => void; prompts: string[] }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/15 to-orange-500/15 border border-amber-500/20">
        <Sparkles className="h-7 w-7 text-amber-300" />
      </div>
      <div className="space-y-1 max-w-xs">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">AI Copilot</div>
        <div className="text-xs text-slate-400">
          Я выполняю действия в системе и отвечаю на вопросы. Просто напиши что нужно — я подскажу следующий шаг.
        </div>
      </div>
      <div className="w-full pt-2 space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Можешь начать с этого:</div>
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPrompt(p)}
            className="w-full text-left rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-white/[0.02] px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:border-slate-300 dark:hover:border-white/15 transition"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
