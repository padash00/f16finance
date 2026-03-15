'use client'

import { useMemo, useRef, useState } from 'react'
import { Bot, Loader2, SendHorizonal, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type {
  AssistantChatMessage,
  AssistantPage,
  AssistantResponse,
  PageSnapshot,
} from '@/lib/ai/types'
import { cn } from '@/lib/utils'

type AssistantPanelProps = {
  page: AssistantPage
  title: string
  subtitle: string
  snapshot?: PageSnapshot | null
  suggestedPrompts?: string[]
  className?: string
}

function MessageBubble({ message }: { message: AssistantChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[90%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed',
          isUser
            ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-white border border-amber-500/20'
            : 'bg-white/5 text-slate-200 border border-white/10',
        )}
      >
        {message.content}
      </div>
    </div>
  )
}

export function AssistantPanel({
  page,
  title,
  subtitle,
  snapshot = null,
  suggestedPrompts = [],
  className,
}: AssistantPanelProps) {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const canSubmit = prompt.trim().length > 0 && !loading

  const emptyStateTitle = useMemo(() => (page === 'global' ? 'Глобальный консультант' : title), [page, title])

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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page,
          prompt: finalPrompt,
          history: messages,
          snapshot,
        }),
      })

      const result = (await response.json().catch(() => null)) as AssistantResponse | null
      const text = typeof result?.text === 'string' ? result.text : null
      const errorText = typeof result?.error === 'string' ? result.error : 'Не удалось получить ответ консультанта.'

      if (!response.ok || !text) {
        throw new Error(errorText)
      }

      setMessages([...nextMessages, { role: 'assistant', content: text }])
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось получить ответ консультанта.')
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  return (
    <Card className={cn('border-white/10 bg-slate-950/60 text-white', className)}>
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/20 to-orange-500/10 p-3">
            <Bot className="h-5 w-5 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg text-white">{title}</CardTitle>
            <CardDescription className="text-slate-400">{subtitle}</CardDescription>
          </div>
        </div>

        {suggestedPrompts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {suggestedPrompts.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => void sendPrompt(item)}
                disabled={loading}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-white/8 bg-black/20">
          <ScrollArea className="h-[320px]">
            <div className="space-y-3 p-4">
              {messages.length > 0 ? (
                messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} />)
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                  <div className="mb-2 flex items-center gap-2 text-slate-300">
                    <Sparkles className="h-4 w-4 text-amber-300" />
                    {emptyStateTitle}
                  </div>
                  <p>Работает только с безопасными срезами данных и серверными функциями. Числа не придумывает, а объясняет картину и действия.</p>
                </div>
              )}

              {loading ? (
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                  Консультант анализирует срез данных и при необходимости дополняет ответ серверными данными...
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="space-y-3">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Спроси про деньги, риски, узкие места или действия на 30 дней..."
            className="min-h-24 border-white/10 bg-white/[0.03] text-white placeholder:text-slate-500"
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                void sendPrompt()
              }
            }}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">Ctrl/Cmd + Enter чтобы отправить</div>
            <Button
              type="button"
              onClick={() => void sendPrompt()}
              disabled={!canSubmit}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-black hover:from-amber-400 hover:to-orange-400"
            >
              <SendHorizonal className="mr-2 h-4 w-4" />
              Спросить
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
