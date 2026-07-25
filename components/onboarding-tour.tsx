'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sparkles, ArrowRight, ArrowLeft, X } from 'lucide-react'

import { getPathFeature } from '@/lib/nav/sections'
import { findCapabilityPageByPath } from '@/lib/core/capabilities'
import { canAccessPath } from '@/lib/core/access'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useNavSession } from '@/lib/nav/use-nav-session'

/**
 * Сквозной онбординг владельца с подсветкой элементов.
 *
 * Шаг: { route, tour?, title, text }.
 *  - tour — значение data-tour у элемента: движок подсвечивает его (spotlight +
 *    обводка) и ставит карточку рядом.
 *  - без tour — карточка по центру снизу (обзорный шаг).
 * Все страницы — внутри layout (main), чтобы компонент не размонтировался.
 * Шаги закрытых страниц пропускаются целиком (та же логика, что строит меню).
 */
type Step = { route: string; tour?: string; title: string; text: string }

const STEPS: Step[] = [
  { route: '/dashboard', title: 'Добро пожаловать в Orda', text: 'Проведём короткий тур: покажем, где что находится и как запустить работу — от товаров до выручки. В любой момент можно нажать «Пропустить».' },
  { route: '/dashboard', title: 'Магазин', text: 'Главный модуль торговли: каталог товаров, склад, витрина, приёмка и движения. Дальше пройдём по нему по вкладкам и кнопкам.' },
  { route: '/store/stock', tour: 'store-tab-warehouse', title: 'Склад (подсобка)', text: 'Остатки на складе-подсобке. Сюда приходит товар от поставщика при приёмке, отсюда перемещается на витрину.' },
  { route: '/store/stock', tour: 'store-tab-showcase', title: 'Витрина', text: 'Остатки на витрине — то, что реально продаётся на кассе. Продажа списывает именно отсюда.' },
  { route: '/store/stock', tour: 'store-tab-movements', title: 'Движения', text: 'История всех перемещений товара: приход, перемещения склад→витрина, списания, продажи. Полная прослеживаемость.' },
  { route: '/store/stock', tour: 'store-tab-catalog', title: 'Каталог', text: 'Все товары: название, штрихкод, цена продажи и закупа, категория. Здесь добавляешь и редактируешь карточки, импортируешь из Excel.' },
  { route: '/store/receipts', tour: 'page-header', title: 'Приёмка товара', text: 'Заводишь приход от поставщика: выбираешь склад, поставщика, добавляешь строки товара. Остатки увеличиваются, цены обновляются, чек уходит в расход.' },
  { route: '/hr', tour: 'page-header', title: 'Команда', text: 'Наём сотрудников. Кассиру логин и пароль выдаются сразу — он заходит в веб-кассу и работает.' },
  { route: '/store/shifts', tour: 'page-header', title: 'Смены', text: 'Открытие и закрытие смен по точке, выручка смены. Сами продажи — в «Web POS» (в меню): открой смену и продавай карточками.' },
  { route: '/reports', tour: 'page-header', title: 'Финансы и отчёты', text: 'Доходы, расходы, прибыль, маржа и аналитика по дням/точкам. Здесь видно, как зарабатывает бизнес.' },
]

const PAD = 6

export function OnboardingTour() {
  const router = useRouter()
  const pathname = usePathname()
  const nav = useNavSession()
  const { can, isLoading: capsLoading } = useCapabilities()

  const [shouldShow, setShouldShow] = useState(false)
  const [started, setStarted] = useState(false)
  const [active, setActive] = useState(false)
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/org/onboarding')
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setShouldShow(!!j?.show) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const canAccess = useCallback((route: string): boolean => {
    if (!nav.featuresAllAccess) {
      const feat = getPathFeature(route)
      if (feat && !nav.orgFeatures.includes(feat)) return false
    }
    if (!capsLoading) {
      const capPage = findCapabilityPageByPath(route)
      if (capPage) return can(`${capPage.id}.view`)
    }
    return canAccessPath({
      pathname: route,
      isStaff: nav.isStaff,
      isOperator: nav.isOperator,
      staffRole: nav.staffRole,
      isSuperAdmin: nav.isSuperAdmin,
      subscriptionFeatures: nav.subscriptionFeatures,
      rolePermissionOverrides: nav.rolePermissionOverrides,
    })
  }, [nav.featuresAllAccess, nav.orgFeatures, nav.isStaff, nav.isOperator, nav.staffRole, nav.isSuperAdmin, nav.subscriptionFeatures, nav.rolePermissionOverrides, capsLoading, can])

  const steps = useMemo(() => STEPS.filter((s) => canAccess(s.route)), [canAccess])

  useEffect(() => {
    if (started || !shouldShow || capsLoading || steps.length === 0) return
    setStarted(true)
    setActive(true)
    setI(0)
    if (pathname !== steps[0].route) router.push(steps[0].route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, capsLoading, steps, started])

  const idx = Math.min(i, Math.max(0, steps.length - 1))
  const step = active ? steps[idx] : null

  // Навигация на нужную страницу шага.
  useEffect(() => {
    if (!step) return
    if (pathname !== step.route) router.push(step.route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, active])

  // Поиск и подсветка целевого элемента (с ретраями, пока страница не отрисуется).
  useEffect(() => {
    if (!step) { setRect(null); return }
    if (!step.tour) { setRect(null); return }
    if (pathname !== step.route) return
    let tries = 0
    let iv: ReturnType<typeof setInterval> | null = null
    const find = () => {
      const el = document.querySelector(`[data-tour="${step.tour}"]`) as HTMLElement | null
      if (el) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
        setTimeout(() => setRect(el.getBoundingClientRect()), 200)
        return true
      }
      return false
    }
    if (!find()) {
      iv = setInterval(() => { tries++; if (find() || tries > 25) { if (iv) clearInterval(iv) } }, 120)
    }
    return () => { if (iv) clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, active, pathname])

  // Пересчёт позиции при скролле/ресайзе.
  useEffect(() => {
    if (!step?.tour) return
    const recompute = () => {
      const el = document.querySelector(`[data-tour="${step.tour}"]`) as HTMLElement | null
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    return () => {
      window.removeEventListener('scroll', recompute, true)
      window.removeEventListener('resize', recompute)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, active])

  const finish = () => {
    setActive(false)
    setRect(null)
    fetch('/api/org/onboarding', { method: 'POST' }).catch(() => {})
  }

  if (!active || !step) return null
  const isLast = idx === steps.length - 1

  const go = (delta: number) => {
    const ni = idx + delta
    if (ni < 0) return
    if (ni >= steps.length) { finish(); return }
    setRect(null)
    setI(ni)
  }

  // Позиция карточки: под элементом, если есть; иначе снизу по центру.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const CARD_W = 380
  let cardStyle: React.CSSProperties
  if (rect) {
    const below = rect.bottom + 14
    const placeBelow = below + 180 < vh
    const top = placeBelow ? rect.bottom + 14 : Math.max(12, rect.top - 14 - 180)
    let left = rect.left + rect.width / 2 - CARD_W / 2
    left = Math.max(12, Math.min(left, vw - CARD_W - 12))
    cardStyle = { position: 'fixed', top, left, width: CARD_W, zIndex: 202 }
  } else {
    cardStyle = { position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', width: Math.min(CARD_W, vw - 24), zIndex: 202 }
  }

  return (
    <>
      {/* Затемнение + «дырка» с обводкой вокруг элемента (spotlight) */}
      {rect ? (
        <div
          className="pointer-events-none fixed z-[201] rounded-xl ring-2 ring-emerald-400 transition-all"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(2,6,23,0.62)',
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[201] bg-slate-950/40" />
      )}

      {/* Карточка */}
      <div style={cardStyle}>
        <div className="pointer-events-auto rounded-2xl border border-emerald-500/30 bg-white p-5 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-white">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" /> {idx + 1} / {steps.length}
            </span>
            <button onClick={finish} className="rounded p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </button>
          </div>
          <h3 className="text-base font-bold">{step.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{step.text}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button onClick={finish} className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">Пропустить тур</button>
            <div className="flex items-center gap-2">
              {idx > 0 && (
                <button onClick={() => go(-1)} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">
                  <ArrowLeft className="h-4 w-4" /> Назад
                </button>
              )}
              <button onClick={() => go(1)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">
                {isLast ? 'Готово' : 'Далее'} {!isLast && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
