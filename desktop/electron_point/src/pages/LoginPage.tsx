import { useState, useEffect } from 'react'
import { LogIn, Shield, Eye, EyeOff, Settings, X, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import * as api from '@/lib/api'
import { DEFAULT_API_URL } from '@/lib/config'
import type { AppConfig, BootstrapData, OperatorSession, AdminSession } from '@/types'

interface Props {
  config: AppConfig | null
  bootstrap: BootstrapData
  isOffline?: boolean
  onOperatorLogin: (session: OperatorSession) => void
  onAdminLogin: (session: AdminSession) => void
  onSaveConfig: (config: AppConfig) => void
}

type Mode = 'operator' | 'admin'

export default function LoginPage({ config, bootstrap, isOffline, onOperatorLogin, onAdminLogin, onSaveConfig }: Props) {
  const [mode, setMode] = useState<Mode>('operator')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Device settings dialog state
  const [showSettings, setShowSettings] = useState(false)
  const [apiUrl, setApiUrl] = useState(config?.apiUrl ?? DEFAULT_API_URL)
  const [deviceToken, setDeviceToken] = useState(config?.deviceToken ?? '')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const [appVersion, setAppVersion] = useState<string>('')
  useEffect(() => {
    window.electron.app.version().then(setAppVersion).catch(() => {})
  }, [])

  const noConfig = !config

  const errorMessages: Record<string, string> = {
    'invalid-credentials': 'Неверный логин или пароль',
    'operator-auth-not-found': 'Оператор не найден',
    'operator-not-assigned-to-device-point': 'Оператор не прикреплён к этой точке',
    'super-admin-only': 'Требуется учётная запись администратора',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (noConfig) { setShowSettings(true); return }
    setError(null)
    setLoading(true)

    try {
      if (mode === 'operator') {
        if (!username.trim()) { setError('Введите логин'); setLoading(false); return }
        if (!password.trim()) { setError('Введите пароль'); setLoading(false); return }

        const { operator, company } = await api.loginOperator(config, username.trim(), password)
        onOperatorLogin({ type: 'operator', operator, company, bootstrap })
      } else {
        if (!email.trim()) { setError('Введите email'); setLoading(false); return }
        if (!password.trim()) { setError('Введите пароль'); setLoading(false); return }

        await api.loginAdmin(config, email.trim(), password)
        onAdminLogin({ type: 'admin', email: email.trim(), password, bootstrap })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка входа'
      setError(errorMessages[msg] || msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSettingsError(null)
    if (!apiUrl.trim()) { setSettingsError('Введите адрес сервера'); return }
    if (!deviceToken.trim()) { setSettingsError('Введите токен устройства'); return }

    setSettingsSaving(true)
    try {
      const newConfig: AppConfig = {
        apiUrl: apiUrl.trim().replace(/\/$/, ''),
        deviceToken: deviceToken.trim(),
      }
      // Test connection
      await api.bootstrap(newConfig)
      onSaveConfig(newConfig)
      setShowSettings(false)
    } catch {
      setSettingsError('Не удалось подключиться. Проверьте адрес и токен.')
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Titlebar drag area */}
      <div className="h-9 drag-region" />

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Header */}
          <div className="text-center space-y-1">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <span className="text-xl font-bold text-primary-foreground">F</span>
            </div>
            <h1 className="text-xl font-bold mt-3">
              {noConfig ? 'Orda Point' : bootstrap.company.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {noConfig ? 'Устройство не настроено' : bootstrap.device.name}
            </p>
          </div>

          {/* Офлайн-баннер */}
          {isOffline && !noConfig && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              <span>Нет сети — используются кешированные данные. Смены сохранятся локально.</span>
            </div>
          )}

          {/* No config banner */}
          {noConfig && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-center space-y-2">
              <p className="text-foreground/80">Устройство не подключено к серверу.</p>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="text-primary underline underline-offset-2 cursor-pointer hover:text-primary/80 no-drag"
              >
                Настроить подключение
              </button>
            </div>
          )}

          {/* Mode toggle */}
          {!noConfig && (
            <div className="flex rounded-lg border p-1 gap-1 no-drag">
              <button
                type="button"
                onClick={() => { setMode('operator'); setError(null) }}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                  mode === 'operator' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Оператор
              </button>
              <button
                type="button"
                onClick={() => { setMode('admin'); setError(null) }}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                  mode === 'admin' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Shield className="h-3.5 w-3.5" /> Администратор
              </button>
            </div>
          )}

          {/* Form */}
          {!noConfig && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {mode === 'operator' ? 'Вход для оператора' : 'Вход администратора'}
                </CardTitle>
                <CardDescription className="text-xs">
                  {mode === 'operator'
                    ? 'Введите ваш логин и пароль'
                    : 'Введите email и пароль от панели управления'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-3">
                  {mode === 'operator' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className="text-xs">Логин</Label>
                      <Input
                        id="username"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="operator_name"
                        autoComplete="username"
                        autoFocus
                        disabled={loading}
                        className="no-drag"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-xs">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="admin@company.kz"
                        autoComplete="email"
                        autoFocus
                        disabled={loading}
                        className="no-drag"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs">Пароль</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        disabled={loading}
                        className="no-drag pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer no-drag"
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <p className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive-foreground">
                      {error}
                    </p>
                  )}

                  <Button type="submit" className="w-full gap-2 no-drag" disabled={loading}>
                    {loading ? (
                      <span className="animate-spin h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                    {loading ? 'Вхожу...' : 'Войти'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Device settings link */}
          <div className="text-center no-drag">
            <button
              type="button"
              onClick={() => {
                setApiUrl(config?.apiUrl ?? DEFAULT_API_URL)
                setDeviceToken(config?.deviceToken ?? '')
                setSettingsError(null)
                setShowSettings(true)
              }}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" />
              Настройки устройства
            </button>
          </div>
        </div>
      </div>

      {/* Device settings overlay */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Настройки устройства</CardTitle>
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer no-drag"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <CardDescription className="text-xs">
                  Введите адрес сервера и токен устройства
                  {appVersion && <span className="ml-2 text-muted-foreground/60">v{appVersion}</span>}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveSettings} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="apiUrl" className="text-xs">Адрес сервера</Label>
                    <Input
                      id="apiUrl"
                      value={apiUrl}
                      onChange={e => setApiUrl(e.target.value)}
                      placeholder="https://ordaops.kz"
                      autoFocus
                      disabled={settingsSaving}
                      className="no-drag font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="deviceToken" className="text-xs">Токен устройства</Label>
                    <Input
                      id="deviceToken"
                      value={deviceToken}
                      onChange={e => setDeviceToken(e.target.value)}
                      placeholder="abcdef1234..."
                      disabled={settingsSaving}
                      className="no-drag font-mono text-xs"
                    />
                  </div>

                  {settingsError && (
                    <p className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive-foreground">
                      {settingsError}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 no-drag"
                      onClick={() => setShowSettings(false)}
                      disabled={settingsSaving}
                    >
                      Отмена
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1 no-drag"
                      disabled={settingsSaving}
                    >
                      {settingsSaving ? (
                        <span className="animate-spin h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />
                      ) : 'Подключить'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
