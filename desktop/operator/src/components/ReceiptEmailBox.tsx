import { useState } from 'react'
import { Check, Loader2, Mail } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import * as api from '@/lib/api'
import { toastError, toastSuccess } from '@/lib/toast'
import type { AppConfig } from '@/types'

/**
 * Чек на почту покупателя — в окне чека после продажи.
 *
 * Работает только для чека, который уже сохранён на сервере. Касса показывает
 * чек сразу, с локальным id, а настоящий id подставляет, когда сервер ответил;
 * офлайн-продажа получит его только после синхронизации. Поэтому страница
 * передаёт `ready` — до этого поле выключено и объясняет почему.
 */
export function ReceiptEmailBox({
  config,
  saleId,
  ready,
}: {
  config: AppConfig
  saleId: string | null
  ready: boolean
}) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const looksValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const canSend = ready && Boolean(saleId) && looksValid && !sending

  const send = async () => {
    if (!canSend || !saleId) return
    setSending(true)
    setDone(null)
    try {
      const result = await api.sendSaleReceiptEmail(config, saleId, email.trim())
      setDone(result.message)
      toastSuccess(result.message)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось отправить чек')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          type="email"
          inputMode="email"
          value={email}
          disabled={!ready}
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
          placeholder={ready ? 'Почта покупателя' : 'Чек ещё сохраняется…'}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="outline" onClick={() => void send()} disabled={!canSend} className="shrink-0 gap-2">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          На почту
        </Button>
      </div>
      {done ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-500">
          <Check className="h-3.5 w-3.5 shrink-0" />
          {done}
        </p>
      ) : !ready ? (
        <p className="text-xs text-muted-foreground">Отправить на почту можно, когда чек сохранится на сервере.</p>
      ) : null}
    </div>
  )
}
