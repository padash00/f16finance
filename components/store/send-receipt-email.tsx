'use client'

import { useState } from 'react'
import { Check, Loader2, Mail } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'

/**
 * Отправка чека продажи на почту покупателя — для истории чеков и веб-кассы.
 *
 * Адрес проверяет сервер (lib/domain/sale-receipt-email → normalizeEmail);
 * здесь только грубая подсказка, чтобы не гонять запрос с пустым полем.
 * Письмо уходит сразу, а если SMTP в эту минуту отказал — сервер поставит
 * его в очередь и дошлёт сам. Кассир об этом узнаёт из текста статуса.
 */
export function SendReceiptEmail({
  saleId,
  defaultEmail = '',
  compact = false,
  endpoint = '/api/pos/receipt-email',
}: {
  saleId: string
  /** Почта клиента из карточки лояльности, если он выбран в продаже */
  defaultEmail?: string | null
  /** Узкая раскладка для модалки кассы */
  compact?: boolean
  /** Куда слать: сотрудник — /api/pos/receipt-email, оператор со сменой — /api/operator/receipt-email */
  endpoint?: string
}) {
  const [email, setEmail] = useState(defaultEmail || '')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const looksValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())

  const send = async () => {
    if (!looksValid || sending) return
    setSending(true)
    setDone(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId, email: email.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        toast({
          title: 'Чек не отправлен',
          description: data?.message || 'Попробуйте ещё раз через минуту.',
          variant: 'destructive',
        })
        return
      }
      setDone(data.message || `Чек отправлен на ${data.email}`)
      toast({ title: data.status === 'sent' ? 'Чек отправлен' : 'Чек в очереди', description: data.message })
    } catch {
      toast({ title: 'Нет связи с сервером', description: 'Проверьте интернет и попробуйте снова.', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className={compact ? 'flex gap-2' : 'flex flex-col gap-2 sm:flex-row'}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (done) setDone(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Почта покупателя"
          className="min-w-0 flex-1"
          aria-label="Почта покупателя для чека"
        />
        <Button type="button" variant="outline" onClick={() => void send()} disabled={!looksValid || sending} className="shrink-0 gap-2">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          На почту
        </Button>
      </div>
      {done ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
          <Check className="h-3.5 w-3.5 shrink-0" />
          {done}
        </p>
      ) : null}
    </div>
  )
}
