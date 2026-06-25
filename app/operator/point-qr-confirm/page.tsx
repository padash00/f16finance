'use client'

import { Suspense, useCallback, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, MonitorSmartphone, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { OperatorPanel } from '@/components/operator/operator-mobile-ui'

function PointQrConfirmContent() {
  const searchParams = useSearchParams()
  const nonce = searchParams.get('n')?.trim() ?? ''

  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<'ok' | 'err' | null>(null)
  const [errMessage, setErrMessage] = useState<string | null>(null)

  const confirm = useCallback(async () => {
    if (!nonce) return
    setLoading(true)
    setErrMessage(null)
    try {
      const res = await fetch('/api/operator/point-qr-confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) {
        const map: Record<string, string> = {
          'must-change-password-web-first':
            data.message ||
            'Сначала смените временный пароль в кабинете или войдите по паролю на терминале.',
          'operator-auth-not-found': 'Аккаунт оператора не найден.',
          'operator-not-assigned-to-any-point': 'Нет доступа к этой точке.',
          'invalid-or-used-code': 'Код недействителен. Откройте свежий QR на терминале и отсканируйте заново.',
          'code-already-used': 'Этот QR-код уже использован. Нажмите «Новый QR» на терминале.',
          'code-expired': 'Время кода истекло (10 мин). Откройте свежий QR на терминале.',
          unauthorized: 'Войдите в кабинет оператора.',
          forbidden: 'Нет прав оператора.',
        }
        setErrMessage(map[data.error || ''] || data.message || 'Не удалось подтвердить вход.')
        setDone('err')
        return
      }
      setDone('ok')
    } catch {
      setErrMessage('Нет соединения. Проверьте интернет.')
      setDone('err')
    } finally {
      setLoading(false)
    }
  }, [nonce])

  if (!nonce) {
    return (
      <OperatorPanel className="mx-auto w-full max-w-md border-rose-500/40">
        <div className="flex items-center gap-2 font-mono text-[15px] font-semibold uppercase tracking-tight text-rose-300">
          <XCircle className="h-5 w-5" />
          Неверная ссылка
        </div>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Отсканируйте QR-код с экрана терминала Orda Point ещё раз.</p>
        <Button asChild variant="outline" className="mt-4 w-full border-[#23262b] bg-[#0b0c0d] text-zinc-100 hover:bg-[#0e0f10]">
          <Link href="/operator">В кабинет</Link>
        </Button>
      </OperatorPanel>
    )
  }

  if (done === 'ok') {
    return (
      <OperatorPanel className="mx-auto w-full max-w-md border-emerald-500/40">
        <div className="flex items-center gap-2 font-mono text-[15px] font-semibold uppercase tracking-tight text-emerald-300">
          <CheckCircle2 className="h-5 w-5" />
          Готово
        </div>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Можно вернуться к терминалу — вход выполнен.</p>
        <Button asChild variant="outline" className="mt-4 w-full border-[#23262b] bg-[#0b0c0d] text-zinc-100 hover:bg-[#0e0f10]">
          <Link href="/operator">В кабинет</Link>
        </Button>
      </OperatorPanel>
    )
  }

  return (
    <OperatorPanel accent="amber" className="mx-auto w-full max-w-md">
      <div className="flex items-center gap-2 font-mono text-[15px] font-semibold uppercase tracking-tight text-zinc-100">
        <MonitorSmartphone className="h-5 w-5 text-amber-400" />
        Вход на терминале
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Подтвердите вход в программу Orda Point на этом компьютере. Делайте это только если QR показан на вашем рабочем
        терминале.
      </p>
      <div className="mt-4 space-y-3">
        {done === 'err' && errMessage ? (
          <p className="border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-300">{errMessage}</p>
        ) : null}
        <Button className="w-full" disabled={loading} onClick={() => void confirm()}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Подтверждаем…
            </>
          ) : (
            'Подтвердить вход'
          )}
        </Button>
        <Button asChild variant="ghost" className="w-full text-zinc-400 hover:text-zinc-100">
          <Link href="/operator">Отмена</Link>
        </Button>
      </div>
    </OperatorPanel>
  )
}

export default function PointQrConfirmPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-wide text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка…
          </div>
        }
      >
        <PointQrConfirmContent />
      </Suspense>
    </div>
  )
}
