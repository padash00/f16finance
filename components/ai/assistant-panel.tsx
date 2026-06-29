'use client'

import { useMemo, useRef, useState } from 'react'
import { Bot, Loader2, SendHorizonal, Sparkles, XCircle } from 'lucide-react'

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
            ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-foreground border border-amber-500/20'
            : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 border border-border',
        )}
      >
        {message.content || (!isUser ? '...' : '')}
      </div>
    </div>
  )
}

function parseSseEvent(raw: string): { event: string; data: any } | null {
  const lines = raw.split('\n')
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message'
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')

  if (!data) return null

  try {
    return { event, data: JSON.parse(data) }
  } catch {
    return null
  }
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
  const abortRef = useRef<AbortController | null>(null)

  const canSubmit = prompt.trim().length > 0 && !loading

  const emptyStateTitle = useMemo(() => (page === 'global' ? 'Глобальный консультант' : title), [page, title])

  const sendPrompt = async (nextPrompt?: string) => {
    const finalPrompt = (nextPrompt ?? prompt).trim()
    if (!finalPrompt || loading) return

    const nextMessages = [...messages, { role: 'user', content: finalPrompt } satisfies AssistantChatMessage]
    const assistantIndex = nextMessages.length
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setPrompt('')
    setLoading(true)
    setError(null)

    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page,
          prompt: finalPrompt,
          history: messages,
          snapshot,
        }),
      })

      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as AssistantResponse | null
        const errorText = typeof result?.error === 'string' ? result.error : 'Не удалось получить ответ консультанта.'
        throw new Error(errorText)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let receivedText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const rawEvent of events) {
          const parsed = parseSseEvent(rawEvent)
          if (!parsed) continue

          if (parsed.event === 'delta') {
            const delta = typeof parsed.data?.text === 'string' ? parsed.data.text : ''
            if (!delta) continue
            receivedText += delta
            setMessages((current) =>
              current.map((message, index) =>
                index === assistantIndex ? { ...message, content: receivedText } : message,
              ),
            )
          }

          if (parsed.event === 'error') {
            throw new Error(typeof parsed.data?.error === 'string' ? parsed.data.error : 'Не удалось получить ответ консультанта.')
          }
        }
      }

      if (!receivedText.trim()) {
        throw new Error('ИИ не вернул осмысленный ответ.')
      }
    } catch (requestError) {
      if (abortController.signal.aborted) return

      setMessages(nextMessages)
      setError(requestError instanceof Error ? requestError.message : 'Не удалось получить ответ консультанта.')
    } finally {
      abortRef.current = null
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const cancelRequest = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  return (
    <Card className={cn('border-border bg-white dark:bg-slate-950/60 text-foreground', className)}>
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/20 to-orange-500/10 p-3">
            <Bot className="h-5 w-5 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg text-foreground">{title}</CardTitle>
            <CardDescription className="text-muted-foreground">{subtitle}</CardDescription>
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
                className="rounded-full border border-border bg-slate-50 dark:bg-white/5 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 transition hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-black/20">
          <ScrollArea className="h-[320px]">
            <div className="space-y-3 p-4">
              {messages.length > 0 ? (
                messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} />)
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-slate-50/50 dark:bg-white/[0.03] p-4 text-sm text-muted-foreground">
                  <div className="mb-2 flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Sparkles className="h-4 w-4 text-amber-300" />
                    {emptyStateTitle}
                  </div>
                  <p>Работает только с безопасными срезами данных и серверными функциями. Числа не придумывает, а объясняет картину и действия.</p>
                </div>
              )}

              {loading ? (
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-slate-50/50 dark:bg-white/[0.03] px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                  Консультант печатает...
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="space-y-3">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Спроси про деньги, риски, узкие места или действия на 30 дней..."
            className="min-h-24 border-border bg-white dark:bg-white/[0.03] text-foreground placeholder:text-slate-500"
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                void sendPrompt()
              }
            }}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">Ctrl/Cmd + Enter чтобы отправить</div>
            <div className="flex items-center gap-2">
              {loading ? (
                <Button type="button" variant="outline" onClick={cancelRequest} className="rounded-xl">
                  <XCircle className="mr-2 h-4 w-4" />
                  Отменить
                </Button>
              ) : null}
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
        </div>
      </CardContent>
    </Card>
  )
}
