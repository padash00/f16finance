'use client'

import { Download, Share2, Smartphone, X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'orda.operator.pwa.dismissedUntil'
const DISMISS_DAYS = 10

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isMobileUa(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)')
  if (mq.matches) return true
  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
}

function dismissedExpired(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return true
    const until = Number.parseInt(raw, 10)
    if (!Number.isFinite(until)) return true
    return Date.now() > until
  } catch {
    return true
  }
}

function dismissForAWhile() {
  const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000
  try {
    localStorage.setItem(STORAGE_KEY, String(until))
  } catch {
    /* ignore */
  }
}

/**
 * Баннер «установить как приложение» для операторов на смартфоне.
 * Android/Chrome: beforeinstallprompt + SW. iOS Safari: подсказка «Поделиться → На экран Домой».
 */
export function OperatorPwaInstall() {
  const pathname = usePathname() || ''
  const [visible, setVisible] = useState(false)
  const [mode, setMode] = useState<'android' | 'ios' | 'manual' | null>(null)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installing, setInstalling] = useState(false)

  const registerSw = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/operator/' })
    } catch {
      /* ignore — установка на iOS без SW всё равно возможна через меню */
    }
  }, [])

  useEffect(() => {
    if (!pathname.startsWith('/operator')) return
    if (pathname.includes('point-qr')) return
    if (typeof window === 'undefined') return
    if (!isMobileUa() || isStandalone() || !dismissedExpired()) return

    void registerSw()

    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setMode('android')
    }
    window.addEventListener('beforeinstallprompt', onBip)

    const t = window.setTimeout(() => {
      if (!dismissedExpired() || isStandalone()) return
      setMode((m) => {
        if (m) return m
        if (isIos()) return 'ios'
        return 'manual'
      })
    }, 3200)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.clearTimeout(t)
    }
  }, [pathname, registerSw])

  useEffect(() => {
    if (mode === 'android' && deferred) {
      const t = window.setTimeout(() => setVisible(true), 400)
      return () => window.clearTimeout(t)
    }
    if (mode === 'ios' || mode === 'manual') {
      const t = window.setTimeout(() => setVisible(true), 100)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [mode, deferred])

  const close = () => {
    dismissForAWhile()
    setVisible(false)
  }

  const onInstall = async () => {
    if (!deferred) return
    setInstalling(true)
    try {
      await deferred.prompt()
      await deferred.userChoice
    } catch {
      /* ignore */
    } finally {
      setInstalling(false)
      setDeferred(null)
      setVisible(false)
    }
  }

  if (!visible || !mode) return null

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'animate-in slide-in-from-bottom-4 fade-in duration-300',
      )}
      role="dialog"
      aria-labelledby="operator-pwa-title"
      aria-describedby="operator-pwa-desc"
    >
      <div
        className={cn(
          'pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/25',
          'bg-gradient-to-b from-slate-900/98 to-slate-950/98 shadow-2xl shadow-black/50 backdrop-blur-xl',
        )}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

        <button
          type="button"
          onClick={close}
          className="absolute right-2 top-2 rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-white"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex gap-4 p-4 pr-12">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-400/30">
            <Smartphone className="h-6 w-6 text-amber-300" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="operator-pwa-title" className="text-base font-semibold tracking-tight text-white">
              {mode === 'ios'
                ? 'Добавьте на главный экран'
                : mode === 'manual'
                  ? 'Установить как приложение'
                  : 'Установить приложение'}
            </h2>
            <p id="operator-pwa-desc" className="mt-1 text-sm leading-relaxed text-slate-400">
              {mode === 'ios' ? (
                <>
                  Нажмите кнопку <Share2 className="mx-0.5 inline h-3.5 w-3.5 text-sky-400" aria-hidden />{' '}
                  <strong className="font-medium text-slate-300">Поделиться</strong> внизу Safari, затем{' '}
                  <strong className="font-medium text-slate-300">На экран «Домой»</strong> — откроется как обычное
                  приложение, без адресной строки.
                </>
              ) : mode === 'manual' ? (
                <>
                  Откройте меню браузера (обычно <strong className="font-medium text-slate-300">⋮</strong> или{' '}
                  <strong className="font-medium text-slate-300">«Ещё»</strong>) и выберите{' '}
                  <strong className="font-medium text-slate-300">«Установить приложение»</strong> или{' '}
                  <strong className="font-medium text-slate-300">«Добавить на главный экран»</strong>.
                </>
              ) : (
                <>
                  Быстрый вход в кабинет с рабочего стола: полноэкранный режим и удобнее, чем вкладка в браузере.
                </>
              )}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {mode === 'android' && deferred ? (
                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400"
                  disabled={installing}
                  onClick={() => void onInstall()}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {installing ? 'Установка…' : 'Установить'}
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" className="rounded-xl border-white/10 bg-white/5" onClick={close}>
                Позже
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
