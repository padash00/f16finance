'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Lock, LogOut, CreditCard, X, AlertTriangle } from 'lucide-react'

type Sub = { status: string; endsAt: string | null; trialEndsAt: string | null; graceUntil: string | null }

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('ru-RU') } catch { return '' }
}

/**
 * Гейт подписки для веб-приложения:
 *  - орг приостановлена (403 organization-suspended) → полноэкранный экран оплаты;
 *  - триал/подписка/grace заканчивается → баннер сверху с «Оплатить».
 * billing_exempt орг (F16) — ничего не показывает.
 */
export function SubscriptionGate() {
  const pathname = usePathname()
  // Не перекрываем страницу оплаты — иначе клиент не сможет оплатить.
  const onBillingPage = !!pathname && (pathname === '/upgrade' || pathname.startsWith('/upgrade'))
  const [suspended, setSuspended] = useState(false)
  const [sub, setSub] = useState<Sub | null>(null)
  const [exempt, setExempt] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/org/status')
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 403) {
          const j = await r.json().catch(() => ({}))
          if (j?.code === 'organization-suspended') setSuspended(true)
          return
        }
        const j = await r.json().catch(() => ({}))
        if (j?.billingExempt) { setExempt(true); return }
        setSub((j?.subscription as Sub) || null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (suspended && !onBillingPage) {
    return (
      <div className="fixed inset-0 z-[300] grid place-items-center bg-slate-950/95 p-4 text-white backdrop-blur">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-rose-500/15 text-rose-400">
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold">Подписка приостановлена</h1>
          <p className="mt-2 text-sm text-slate-400">
            Доступ к системе временно ограничен из-за неоплаты. Ваши данные сохранены — оплатите пакет, чтобы продолжить работу.
          </p>
          <a
            href="/upgrade"
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-700"
          >
            <CreditCard className="h-5 w-5" /> Оплатить и вернуть доступ
          </a>
          <button
            onClick={() => { window.location.href = '/login' }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm text-slate-400 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Выйти
          </button>
        </div>
      </div>
    )
  }

  if (exempt || !sub || dismissed) return null

  let banner: { tone: 'red' | 'amber'; text: string } | null = null
  if (sub.status === 'past_due') {
    const left = daysUntil(sub.graceUntil)
    banner = {
      tone: 'red',
      text: `Подписка не оплачена. Доступ приостановится${left != null ? ` через ${left} дн.` : ' скоро'} — оплатите пакет.`,
    }
  } else if (sub.status === 'trialing') {
    const left = daysUntil(sub.trialEndsAt || sub.endsAt)
    if (left != null && left <= 5) {
      banner = { tone: 'amber', text: `Триал заканчивается ${fmtDate(sub.trialEndsAt || sub.endsAt)} (через ${left} дн.) — купите пакет.` }
    }
  } else if (sub.status === 'active') {
    const left = daysUntil(sub.endsAt)
    if (left != null && left <= 5) {
      banner = { tone: 'amber', text: `Подписка заканчивается ${fmtDate(sub.endsAt)} (через ${left} дн.) — продлите.` }
    }
  }

  if (!banner) return null

  const isRed = banner.tone === 'red'
  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 text-sm ${
        isRed
          ? 'bg-rose-600 text-white'
          : 'bg-amber-500 text-black'
      }`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{banner.text}</span>
      <a href="/upgrade" className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold ${isRed ? 'bg-white/20 hover:bg-white/30' : 'bg-black/15 hover:bg-black/25'}`}>
        Оплатить
      </a>
      <button onClick={() => setDismissed(true)} className="shrink-0 rounded p-1 opacity-70 hover:opacity-100" aria-label="Скрыть">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
