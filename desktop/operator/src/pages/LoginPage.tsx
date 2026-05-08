import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Eye, EyeOff, KeyRound, LogIn, QrCode, RefreshCw, Settings, Shield, WifiOff, X } from 'lucide-react'

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
type OperatorAuthMode = 'password' | 'qr'

const errorMessages: Record<string, string> = {
  'invalid-credentials': 'Неверный логин или пароль.',
  'operator-auth-not-found': 'Оператор не найден.',
  'operator-inactive': 'Учётная запись оператора отключена. Обратитесь к руководителю.',
  'operator-not-assigned-to-device-point': 'Оператор не прикреплён к этой точке.',
  'operator-not-assigned-to-any-point': 'Оператор не прикреплён ни к одной точке.',
  'operator-not-scheduled-today': 'Вы не назначены на сегодня по графику. Обратитесь к руководителю.',
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
  const [operatorAuthMode, setOperatorAuthMode] = useState<OperatorAuthMode>('password')
  const [qrRefreshKey, setQrRefreshKey] = useState(0)
  const [qrImg, setQrImg] = useState<string | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const qrPollNonceRef = useRef<string | null>(null)
  const qrPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onOperatorLoginRef = useRef(onOperatorLogin)
  onOperatorLoginRef.current = onOperatorLogin
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

  // Смена временного пароля
  const [changePassData, setChangePassData] = useState<{ operator: any; company: any; allCompanies: any[]; username: string; tempPassword: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [showNewPass, setShowNewPass] = useState(false)
  const [changingPass, setChangingPass] = useState(false)
  const [changePassError, setChangePassError] = useState<string | null>(null)

  useEffect(() => {
    window.electron.app.version().then(setAppVersion).catch(() => {})
  }, [])

  useEffect(() => {
    if (mode !== 'operator' || operatorAuthMode !== 'qr' || isOffline) {
      qrPollNonceRef.current = null
      return
    }

    let cancelled = false

    setQrBusy(true)
    setQrError(null)
    setQrImg(null)

    ;(async () => {
      try {
        const start = await api.startPointQrLogin(config)
        if (cancelled) return
        qrPollNonceRef.current = start.nonce
        const dataUrl = await QRCode.toDataURL(start.confirm_url, { margin: 2, width: 240 })
        if (cancelled) return
        setQrImg(dataUrl)
        setQrBusy(false)

        const pollOnce = () => {
          const nonce = qrPollNonceRef.current
          if (!nonce || cancelled) return
          void (async () => {
            try {
              const p = await api.pollPointQrLogin(config, nonce)
              if (cancelled) return
              if (p.status === 'ready') {
                if (qrPollIntervalRef.current) clearInterval(qrPollIntervalRef.current)
                qrPollIntervalRef.current = null
                if (p.must_change_password) {
                  setQrError('Нужна смена пароля. Войдите по паролю на терминале.')
                  return
                }
                onOperatorLoginRef.current(
                  { type: 'operator', operator: p.operator, company: p.company, bootstrap },
                  p.allCompanies ?? [],
                )
              } else if (p.status === 'expired') {
                if (qrPollIntervalRef.current) clearInterval(qrPollIntervalRef.current)
                qrPollIntervalRef.current = null
                setQrError('Время QR истекло. Нажмите «Обновить».')
              } else if (p.status === 'consumed') {
                if (qrPollIntervalRef.current) clearInterval(qrPollIntervalRef.current)
                qrPollIntervalRef.current = null
                setQrError('Этот код уже использован.')
              }
            } catch (err: unknown) {
              if (cancelled) return
              const message = err instanceof Error ? err.message : 'Ошибка проверки входа.'
              if (qrPollIntervalRef.current) clearInterval(qrPollIntervalRef.current)
              qrPollIntervalRef.current = null
              setQrError(errorMessages[message] || message)
            }
          })()
        }

        pollOnce()
        qrPollIntervalRef.current = setInterval(pollOnce, 1600)
      } catch (err: unknown) {
        if (cancelled) return
        setQrBusy(false)
        const message = err instanceof Error ? err.message : 'Не удалось создать QR.'
        setQrError(errorMessages[message] || message)
      }
    })()

    return () => {
      cancelled = true
      qrPollNonceRef.current = null
      if (qrPollIntervalRef.current) {
        clearInterval(qrPollIntervalRef.current)
        qrPollIntervalRef.current = null
      }
    }
  }, [mode, operatorAuthMode, qrRefreshKey, config, isOffline, bootstrap])

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

        const { operator, company, allCompanies, must_change_password } = await api.loginOperator(config, username.trim(), password)
        if (must_change_password) {
          setChangePassData({ operator, company, allCompanies, username: username.trim(), tempPassword: password })
          return
        }
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

      const adminResult = await api.loginAdmin(config, email.trim(), password)
      onAdminLogin({ type: 'admin', email: email.trim(), token: adminResult.token, bootstrap })
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

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!changePassData) return
    setChangePassError(null)
    if (newPassword.length < 6) { setChangePassError('Пароль должен быть не менее 6 символов'); return }
    if (newPassword !== newPassword2) { setChangePassError('Пароли не совпадают'); return }
    setChangingPass(true)
    try {
      await api.changeOperatorPassword(config, changePassData.username, changePassData.tempPassword, newPassword)
      const { operator, company, allCompanies } = changePassData
      onOperatorLogin({ type: 'operator', operator, company, bootstrap }, allCompanies)
    } catch (err: unknown) {
      setChangePassError(err instanceof Error ? err.message : 'Ошибка смены пароля')
    } finally {
      setChangingPass(false)
    }
  }

  if (changePassData) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <div className="h-9 drag-region" />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-2 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500">
                <KeyRound className="h-6 w-6 text-white" />
              </div>
              <h1 className="mt-3 text-xl font-bold">Смена пароля</h1>
              <p className="text-xs text-muted-foreground">
                Вы вошли с временным паролем. Придумайте постоянный пароль.
              </p>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4">
              {changePassError && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                  {changePassError}
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Новый пароль</Label>
                <div className="relative">
                  <Input
                    type={showNewPass ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                    disabled={changingPass}
                    autoFocus
                    className="no-drag pr-10"
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowNewPass(v => !v)}>
                    {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Повторите пароль</Label>
                <Input
                  type={showNewPass ? 'text' : 'password'}
                  value={newPassword2}
                  onChange={e => setNewPassword2(e.target.value)}
                  placeholder="Повторите новый пароль"
                  disabled={changingPass}
                  className="no-drag"
                />
              </div>
              <Button type="submit" className="w-full gap-2 no-drag" disabled={changingPass}>
                {changingPass ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" /> : <Shield className="h-4 w-4" />}
                Сохранить пароль и войти
              </Button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Декоративные градиентные пятна на фоне */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-fuchsia-500/15 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />

      <div className="h-9 drag-region" />

      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/30 transition-transform hover:scale-105">
              <span className="text-xl font-bold tracking-tight text-white">OP</span>
            </div>
            <div>
              <h1 className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-2xl font-bold text-transparent">Orda Point</h1>
              <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
            </div>
          </div>

          {isOffline && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              <span>Нет сети. Используются кешированные данные, а новые действия уйдут в очередь.</span>
            </div>
          )}

          <div className="no-drag flex gap-1 rounded-xl border border-white/10 bg-slate-900/40 p-1 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => {
                setMode('operator')
                setOperatorAuthMode('password')
                setError(null)
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
                mode === 'operator'
                  ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-white shadow-lg shadow-emerald-500/10 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Оператор
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('admin')
                setOperatorAuthMode('password')
                setError(null)
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all ${
                mode === 'admin'
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-white shadow-lg shadow-amber-500/10 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Shield className="h-3.5 w-3.5" />
              Админ
            </button>
          </div>

          {mode === 'operator' ? (
            <div className="no-drag flex gap-1 rounded-xl border border-white/10 bg-slate-900/40 p-1 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => {
                  setOperatorAuthMode('password')
                  setError(null)
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                  operatorAuthMode === 'password'
                    ? 'bg-white/10 text-white border border-white/15 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Пароль
              </button>
              <button
                type="button"
                onClick={() => {
                  setOperatorAuthMode('qr')
                  setError(null)
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                  operatorAuthMode === 'qr'
                    ? 'bg-white/10 text-white border border-white/15 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <QrCode className="h-3.5 w-3.5" />
                QR-код
              </button>
            </div>
          ) : null}

          <Card className="border-white/10 bg-slate-900/60 backdrop-blur-xl shadow-2xl shadow-black/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-white">
                {mode === 'operator' ? 'Вход для оператора' : 'Вход администратора'}
              </CardTitle>
              <CardDescription className="text-xs">
                {mode === 'operator'
                  ? operatorAuthMode === 'qr'
                    ? 'Отсканируйте QR телефоном и подтвердите вход в личном кабинете.'
                    : 'Введите рабочий логин и пароль.'
                  : 'Введите email и пароль панели управления.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mode === 'operator' && operatorAuthMode === 'qr' ? (
                <div className="space-y-4">
                  {isOffline ? (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      Вход по QR требует интернет. Подключитесь к сети или используйте пароль.
                    </p>
                  ) : qrBusy && !qrImg ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                      <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                      Готовим QR-код…
                    </div>
                  ) : (
                    <>
                      {qrImg ? (
                        <div className="flex justify-center rounded-lg border bg-white p-3">
                          <img src={qrImg} alt="QR для входа на терминале" className="h-[220px] w-[220px]" />
                        </div>
                      ) : null}
                      <p className="text-center text-xs text-muted-foreground">
                        Войдите в кабинет оператора на телефоне и подтвердите вход на этой странице.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2"
                        onClick={() => setQrRefreshKey((k) => k + 1)}
                        disabled={qrBusy}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Обновить QR
                      </Button>
                    </>
                  )}
                  {qrError ? (
                    <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{qrError}</p>
                  ) : null}
                </div>
              ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === 'operator' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="username" className="text-xs text-slate-300">Логин</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="operator_name"
                      autoComplete="username"
                      autoFocus
                      disabled={loading}
                      className="no-drag h-11 bg-slate-800/40 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-400/50 transition-colors"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs text-slate-300">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@company.kz"
                      autoComplete="email"
                      autoFocus
                      disabled={loading}
                      className="no-drag h-11 bg-slate-800/40 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/40 focus-visible:border-amber-400/50 transition-colors"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs text-slate-300">Пароль</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      disabled={loading}
                      className="no-drag pr-10 h-11 bg-slate-800/40 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-400/50 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((value) => !value)}
                      className="no-drag absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
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

                <Button
                  type="submit"
                  className="w-full gap-2 no-drag h-11 bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 hover:shadow-lg hover:shadow-emerald-500/30 transition-all"
                  disabled={loading}
                >
                  {loading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  {loading ? 'Входим...' : 'Войти'}
                </Button>
              </form>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow shadow-emerald-400/60" />
              {appVersion ? `Версия ${appVersion}` : 'Orda Point'}
            </span>
            {mode === 'admin' ? (
              <button
                type="button"
                onClick={openSetupGate}
                className="no-drag inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-white/5 hover:text-white"
              >
                <Settings className="h-3.5 w-3.5" />
                Настроить устройство
              </button>
            ) : (
              <span />
            )}
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
