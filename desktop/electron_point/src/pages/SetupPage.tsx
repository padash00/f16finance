import { useState } from 'react'
import { Wifi, KeyRound, ArrowRight, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { saveConfig, DEFAULT_API_URL } from '@/lib/config'
import type { AppConfig } from '@/types'

interface Props {
  onDone: (config: AppConfig) => void
}

export default function SetupPage({ onDone }: Props) {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [deviceToken, setDeviceToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const url = apiUrl.trim().replace(/\/$/, '')
    const token = deviceToken.trim()

    if (!url) { setError('Введите URL сервера'); return }
    if (!token) { setError('Введите токен устройства'); return }

    setLoading(true)
    try {
      // Проверяем соединение через bootstrap
      const res = await fetch(`${url}/api/point/bootstrap`, {
        headers: { 'x-point-device-token': token },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`)

      const config: AppConfig = { apiUrl: url, deviceToken: token }
      await saveConfig(config)
      onDone(config)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось подключиться к серверу')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <span className="text-2xl font-bold text-primary-foreground">F</span>
          </div>
          <h1 className="text-2xl font-bold">Orda Point</h1>
          <p className="text-sm text-muted-foreground">Первоначальная настройка терминала</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" /> Настройка подключения
            </CardTitle>
            <CardDescription>
              Введите адрес сервера и токен устройства. Токен выдаёт администратор на сайте в разделе «Устройства».
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiUrl" className="flex items-center gap-1.5">
                  <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
                  URL сервера
                </Label>
                <Input
                  id="apiUrl"
                  value={apiUrl}
                  onChange={e => setApiUrl(e.target.value)}
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
                  onChange={e => setDeviceToken(e.target.value)}
                  placeholder="Вставьте токен из панели администратора"
                  disabled={loading}
                  className="no-drag font-mono text-xs"
                />
              </div>

              {error && (
                <p className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive-foreground">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full gap-2" disabled={loading} size="lg">
                {loading ? (
                  <span className="animate-spin h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {loading ? 'Проверяю подключение...' : 'Подключить устройство'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Orda Point v2.0 · Electron
        </p>
      </div>
    </div>
  )
}
