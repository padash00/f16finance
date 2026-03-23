import { useEffect, useState } from 'react'
import { Wifi, KeyRound, ArrowRight, Server } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { saveConfig, DEFAULT_API_URL } from '@/lib/config'
import type { AppConfig } from '@/types'

interface Props {
  initialConfig?: AppConfig | null
  onDone: (config: AppConfig) => void
  onCancel?: () => void
}

export default function SetupPage({ initialConfig, onDone, onCancel }: Props) {
  const [apiUrl, setApiUrl] = useState(initialConfig?.apiUrl ?? DEFAULT_API_URL)
  const [deviceToken, setDeviceToken] = useState(initialConfig?.deviceToken ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.electron.app.version().then(setAppVersion).catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const url = apiUrl.trim().replace(/\/$/, '')
    const token = deviceToken.trim()

    if (!url) {
      setError('Введите адрес сервера.')
      return
    }

    if (!token) {
      setError('Введите токен устройства.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${url}/api/point/bootstrap`, {
        headers: { 'x-point-device-token': token },
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error((data && data.error) || `Ошибка ${res.status}`)
      }

      const config: AppConfig = { apiUrl: url, deviceToken: token }
      await saveConfig(config)
      onDone(config)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось подключиться к серверу.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="h-9 shrink-0 drag-region" />
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <span className="text-2xl font-bold text-primary-foreground">F</span>
          </div>
          <h1 className="text-2xl font-bold">Orda Point</h1>
          <p className="text-sm text-muted-foreground">
            {initialConfig ? 'Настройка устройства и сервера' : 'Первоначальная настройка терминала'}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Настройка подключения
            </CardTitle>
            <CardDescription>
              Введите адрес сервера и токен устройства. Это техническая настройка терминала, а не обычный вход оператора.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiUrl" className="flex items-center gap-1.5">
                  <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
                  Адрес сервера
                </Label>
                <Input
                  id="apiUrl"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://ordaops.kz"
                  disabled={loading}
                  className="no-drag"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="deviceToken" className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                  Токен устройства
                </Label>
                <Input
                  id="deviceToken"
                  value={deviceToken}
                  onChange={(e) => setDeviceToken(e.target.value)}
                  placeholder="Вставьте токен из панели администратора"
                  disabled={loading}
                  className="no-drag font-mono text-xs"
                />
              </div>

              {error && (
                <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full gap-2" disabled={loading} size="lg">
                {loading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {loading ? 'Проверяю подключение...' : 'Подключить устройство'}
              </Button>

              {onCancel && (
                <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={onCancel}>
                  Назад ко входу
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {appVersion ? `Orda Point v${appVersion}` : 'Orda Point'}
        </p>
      </div>
    </div>
    </div>
  )
}
