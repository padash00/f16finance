import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, KeyRound, LogIn, Settings, Shield, WifiOff, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import * as api from '@/lib/api'
import type { AdminSession, AppConfig, BootstrapData, CompanyOption, OperatorSession } from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  isOffline?: boolean
  onOperatorLogin: (session: OperatorSession, allCompanies: CompanyOption[]) => void
  onAdminLogin: (session: AdminSession) => void
  onOpenSetup: () => void
}

type Mode = 'operator' | 'admin'

const errorMessages: Record<string, string> = {
  'invalid-credentials': 'Неверный логин или пароль.',
  'operator-auth-not-found': 'Оператор не найден.',
  'operator-not-assigned-to-device-point': 'Оператор не прикреплён к этой точке.',
  'operator-not-assigned-to-any-point': 'Оператор не прикреплён ни к одной точке.',
  'super-admin-only': 'Требуется вход супер-администратора.',
}

export default function LoginPage({
  config,
  bootstrap,
  isOffline,
  onOperatorLogin,
  onAdminLogin,
  onOpenSetup,
}: Props) {
  const [mode, setMode] = useState<Mode>('operator')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState('')

  const [showSetupGate, setShowSetupGate] = useState(false)
  const [setupEmail, setSetupEmail] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  useEffect(() => {
    window.electron.app.version().then(setAppVersion).catch(() => {})
  }, [])

  const subtitle = useMemo(() => {
    if (bootstrap.device.id) {
      return 'Терминал подключен и готов к работе'
    }
    return 'Вход в рабочий терминал'
  }, [bootstrap.device.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'operator') {
        if (!username.trim()) {
          setError('Введите логин.')
          setLoading(false)
          return
        }

        if (!password.trim()) {
          setError('Введите пароль.')
          setLoading(false)
          return
        }

        const { operator, company, allCompanies } = await api.loginOperator(config, username.trim(), password)
        onOperatorLogin({ type: 'operator', operator, company, bootstrap }, allCompanies)
        return
      }

      if (!email.trim()) {
        setError('Введите email.')
        setLoading(false)
        return
      }

      if (!password.trim()) {
        setError('Введите пароль.')
        setLoading(false)
        return
      }

      await api.loginAdmin(config, email.trim(), password)
      onAdminLogin({ type: 'admin', email: email.trim(), password, bootstrap })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка входа.'
      setError(errorMessages[message] || message)
    } finally {
      setLoading(false)
    }
  }

  function openSetupGate() {
    setSetupEmail('')
    setSetupPassword('')
    setSetupError(null)
    setShowSetupGate(true)
  }

  async function handleSetupAccess(e: React.FormEvent) {
    e.preventDefault()
    setSetupError(null)

    if (!setupEmail.trim()) {
      setSetupError('Введите email супер-администратора.')
      return
    }

    if (!setupPassword.trim()) {
      setSetupError('Введите пароль супер-администратора.')
      return
    }

    setSetupLoading(true)
    try {
      await api.loginAdmin(config, setupEmail.trim(), setupPassword)
      setShowSetupGate(false)
      onOpenSetup()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось подтвердить доступ.'
      setSetupError(errorMessages[message] || message)
    } finally {
      setSetupLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="h-9 drag-region" />

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <span className="text-xl font-bold text-primary-foreground">F</span>
            </div>
            <h1 className="mt-3 text-xl font-bold">Orda Point</h1>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>

          {isOffline && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              <span>Нет сети. Используются кешированные данные, а новые действия уйдут в очередь.</span>
            </div>
          )}

          <div className="no-drag flex gap-1 rounded-lg border p-1">
            <button
              type="button"
              onClick={() => {
                setMode('operator')
                setError(null)
              }}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                mode === 'operator' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Оператор
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('admin')
                setError(null)
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors ${
                mode === 'admin' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Shield className="h-3.5 w-3.5" />
              Админ
            </button>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {mode === 'operator' ? 'Вход для оператора' : 'Вход администратора'}
              </CardTitle>
              <CardDescription className="text-xs">
                {mode === 'operator'
                  ? 'Введите рабочий логин и пароль.'
                  : 'Введите email и пароль панели управления.'}
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
                      onChange={(e) => setUsername(e.target.value)}
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
                      onChange={(e) => setEmail(e.target.value)}
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
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      disabled={loading}
                      className="no-drag pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((value) => !value)}
                      className="no-drag absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full gap-2 no-drag" disabled={loading}>
                  {loading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  {loading ? 'Входим...' : 'Войти'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{appVersion ? `Версия ${appVersion}` : 'Orda Point'}</span>
            <button
              type="button"
              onClick={openSetupGate}
              className="no-drag inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
              Настроить устройство
            </button>
          </div>
        </div>
      </div>

      {showSetupGate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Доступ к настройке устройства</CardTitle>
                  <CardDescription className="text-xs">
                    Только супер-администратор может менять сервер и токен устройства.
                  </CardDescription>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSetupGate(false)}
                  className="no-drag text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSetupAccess} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="setup-email" className="text-xs">Email супер-админа</Label>
                  <Input
                    id="setup-email"
                    type="email"
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    placeholder="owner@company.kz"
                    autoFocus
                    disabled={setupLoading}
                    className="no-drag"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="setup-password" className="text-xs">Пароль</Label>
                  <div className="relative">
                    <Input
                      id="setup-password"
                      type={showPass ? 'text' : 'password'}
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      disabled={setupLoading}
                      className="no-drag pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((value) => !value)}
                      className="no-drag absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {setupError && (
                  <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
                    {setupError}
                  </p>
                )}

                <Button type="submit" className="w-full gap-2 no-drag" disabled={setupLoading}>
                  {setupLoading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  {setupLoading ? 'Проверяем доступ...' : 'Открыть настройки устройства'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
