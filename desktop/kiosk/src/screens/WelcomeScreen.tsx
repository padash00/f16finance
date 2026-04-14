import { useState, useEffect, useRef } from 'react'
import { User, QrCode, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { ClientSession, KioskConfig, StationTheme } from '@/types'
import { clientLogin } from '@/lib/api'
import { formatTime, formatDate, cn } from '@/lib/utils'

interface Props {
  theme: StationTheme | null
  config: KioskConfig | null
  onLoginSuccess: (session: ClientSession) => void
  onGuestActivated: () => void
}

type Mode = 'idle' | 'login' | 'qr'

function randomQrCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

export default function WelcomeScreen({ theme, config, onLoginSuccess }: Props) {
  const [mode, setMode] = useState<Mode>('idle')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [now, setNow] = useState(new Date())
  const [qrCode, setQrCode] = useState('')
  const [qrScanned, setQrScanned] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (mode !== 'qr' || !config) return

    const code = randomQrCode()
    setQrCode(code)
    setQrScanned(false)

    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(`${config.serverBaseUrl}/api/kiosk/rtconfig`)
        const data = await res.json().catch(() => null)
        if (cancelled || !data?.supabaseUrl || !data?.supabaseAnonKey) return

        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(data.supabaseUrl, data.supabaseAnonKey)
        const channel = supabase
          .channel(`kiosk-qr:${code}`)
          .on('broadcast', { event: 'qr_auth' }, ({ payload }: { payload: any }) => {
            if (payload?.client && !cancelled) {
              setQrScanned(true)
              setTimeout(() => onLoginSuccess(payload.client), 600)
            }
          })
          .subscribe()

        cleanupRef.current = () => {
          supabase.removeChannel(channel)
        }
      } catch (_) {}
    })()

    return () => {
      cancelled = true
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [mode, config])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!config || !username || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await clientLogin(config, username, password)
      onLoginSuccess(res.client)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка входа')
    } finally {
      setLoading(false)
    }
  }

  function exitMode() {
    setMode('idle')
    setError('')
    setUsername('')
    setPassword('')
    setQrCode('')
    setQrScanned(false)
  }

  const bgStyle = theme ? getBgStyle(theme) : { background: 'linear-gradient(135deg, #07080a 0%, #0f1520 100%)' }
  const accent = theme?.accentColor || '#2563eb'
  const qrUrl = config && qrCode ? `${config.serverBaseUrl}/q/${qrCode}` : ''

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden relative" style={bgStyle}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: accent }} />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: accent }} />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <header className="flex items-start justify-between px-12 pt-10">
          <div>
            {theme?.logoUrl ? (
              <img src={theme.logoUrl} alt="logo" className="h-12 object-contain" />
            ) : (
              <h1 className="text-3xl font-bold text-white tracking-wider">{theme?.clubName || 'ORDA CLUB'}</h1>
            )}
          </div>
          <div className="text-right">
            <p className="text-5xl font-mono font-light text-white">{formatTime(now)}</p>
            <p className="text-sm text-white/50 mt-1 capitalize">{formatDate(now)}</p>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-12">
          {mode === 'idle' && (
            <div className="flex flex-col items-center gap-8 animate-fade-in">
              <div className="text-center">
                <h2 className="text-5xl font-bold text-white mb-3">Добро пожаловать</h2>
                <p className="text-white/50 text-lg">Выберите способ входа</p>
              </div>
              <div className="flex gap-6">
                <button
                  onClick={() => setMode('login')}
                  className="group flex flex-col items-center gap-4 w-52 h-44 rounded-2xl border border-white/10 bg-white/5 backdrop-blur hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                >
                  <div className="mt-8 w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: `${accent}22`, border: `1px solid ${accent}44` }}>
                    <User size={32} style={{ color: accent }} />
                  </div>
                  <span className="text-white font-medium">Войти по логину</span>
                </button>
                <button
                  onClick={() => setMode('qr')}
                  className="group flex flex-col items-center gap-4 w-52 h-44 rounded-2xl border border-white/10 bg-white/5 backdrop-blur hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                >
                  <div className="mt-8 w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: `${accent}22`, border: `1px solid ${accent}44` }}>
                    <QrCode size={32} style={{ color: accent }} />
                  </div>
                  <span className="text-white font-medium">Войти по QR</span>
                </button>
              </div>
              <p className="text-white/30 text-sm">Нет аккаунта? Обратитесь к оператору</p>
            </div>
          )}

          {mode === 'login' && (
            <div className="w-full max-w-sm animate-fade-in">
              <button onClick={exitMode} className="text-white/40 hover:text-white/70 text-sm mb-6 transition-colors">← Назад</button>
              <h2 className="text-3xl font-bold text-white mb-2">Вход</h2>
              <p className="text-white/40 text-sm mb-8">Введите данные аккаунта</p>
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <input
                  type="text"
                  placeholder="Логин"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  className="w-full px-4 py-3.5 rounded-xl bg-white/8 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-white/30 text-base"
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Пароль"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-xl bg-white/8 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-white/30 text-base pr-12"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !username || !password}
                  className={cn('w-full py-3.5 rounded-xl font-semibold text-white text-base transition-all duration-200', 'disabled:opacity-40 disabled:cursor-not-allowed', 'flex items-center justify-center gap-2')}
                  style={{ background: accent }}
                >
                  {loading && <Loader2 size={18} className="animate-spin" />}
                  Войти
                </button>
              </form>
            </div>
          )}

          {mode === 'qr' && (
            <div className="flex flex-col items-center gap-6 animate-fade-in">
              <button onClick={exitMode} className="self-start text-white/40 hover:text-white/70 text-sm transition-colors">← Назад</button>
              <h2 className="text-3xl font-bold text-white">Вход по QR</h2>

              {qrScanned ? (
                <div className="flex flex-col items-center gap-4">
                  <CheckCircle2 size={64} className="text-green-400" />
                  <p className="text-white text-lg font-medium">QR отсканирован!</p>
                </div>
              ) : qrUrl ? (
                <div className="p-4 rounded-2xl bg-white">
                  <QRCodeSVG value={qrUrl} size={200} level="M" />
                </div>
              ) : (
                <div className="w-52 h-52 rounded-2xl bg-white/10 flex items-center justify-center">
                  <Loader2 size={32} className="text-white/30 animate-spin" />
                </div>
              )}

              {qrCode && !qrScanned && (
                <p className="text-white/30 text-sm font-mono tracking-widest">{qrCode}</p>
              )}
              <p className="text-white/40 text-sm text-center max-w-xs">
                Отсканируйте камерой телефона или перейдите по адресу
              </p>
            </div>
          )}
        </main>

        {theme?.announcement && (
          <footer className="py-3 border-t border-white/5 overflow-hidden">
            <p className="text-white/30 text-sm animate-marquee whitespace-nowrap px-4">{theme.announcement}</p>
          </footer>
        )}
      </div>
    </div>
  )
}

function getBgStyle(theme: StationTheme): React.CSSProperties {
  if (theme.bgType === 'color') return { background: theme.bgValue }
  if (theme.bgType === 'gradient') return { background: theme.bgValue }
  if (theme.bgType === 'image') return { backgroundImage: `url(${theme.bgValue})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: '#07080a' }
}
