'use client'

import { Suspense, useCallback, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, MonitorSmartphone, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
          'invalid-or-used-code': 'Код недействителен или уже использован.',
          'code-expired': 'Время кода истекло. Создайте новый QR на терминале.',
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
      <Card className="mx-auto w-full max-w-md border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <XCircle className="h-5 w-5 text-destructive" />
            Неверная ссылка
          </CardTitle>
          <CardDescription>Отсканируйте QR-код с экрана терминала Orda Point ещё раз.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/operator">В кабинет</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (done === 'ok') {
    return (
      <Card className="mx-auto w-full max-w-md border-emerald-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Готово
          </CardTitle>
          <CardDescription>Можно вернуться к терминалу — вход выполнен.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/operator">В кабинет</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MonitorSmartphone className="h-5 w-5" />
          Вход на терминале
        </CardTitle>
        <CardDescription>
          Подтвердите вход в программу Orda Point на этом компьютере. Делайте это только если QR показан на вашем рабочем
          терминале.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {done === 'err' && errMessage ? (
          <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errMessage}</p>
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
        <Button asChild variant="ghost" className="w-full">
          <Link href="/operator">Отмена</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export default function PointQrConfirmPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
