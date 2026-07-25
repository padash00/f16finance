'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, ArrowRight, X } from 'lucide-react'

import { getPathFeature } from '@/lib/nav/sections'
import { findCapabilityPageByPath } from '@/lib/core/capabilities'
import { canAccessPath } from '@/lib/core/access'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useNavSession } from '@/lib/nav/use-nav-session'

// Сквозной онбординг владельца. Все шаги — внутри layout (main), чтобы компонент
// не размонтировался при навигации (касса /pos вне (main) — упоминаем текстом).
const STEPS: Array<{ route: string; title: string; text: string }> = [
  { route: '/dashboard', title: 'Главная', text: 'Обзор бизнеса: выручка, прибыль, задачи и ключевые показатели за период.' },
  { route: '/store', title: 'Магазин', text: 'Каталог, склад, витрина, приёмка и движения товара — всё в одном модуле.' },
  { route: '/store/receipts', title: 'Приёмка товара', text: 'Заводи приход от поставщика: остатки увеличиваются, цены обновляются, чек уходит в расход.' },
  { route: '/hr', title: 'Команда', text: 'Нанимай сотрудников. Кассиру логин и пароль выдаются сразу — он заходит в веб-кассу.' },
  { route: '/store/shifts', title: 'Смены', text: 'Открытие и закрытие смен по точке, выручка смены. Продажи идут через «Web POS» в меню — открой смену и продавай.' },
  { route: '/reports', title: 'Финансы и отчёты', text: 'Доходы, расходы, прибыль, маржа и аналитика. Здесь видно, как зарабатывает бизнес.' },
]

export function OnboardingTour() {
  const router = useRouter()
  const nav = useNavSession()
  const { can, isLoading: capsLoading } = useCapabilities()

  const [shouldShow, setShouldShow] = useState(false)
  const [started, setStarted] = useState(false)
  const [active, setActive] = useState(false)
  const [i, setI] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/org/onboarding')
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setShouldShow(!!j?.show) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Доступна ли страница текущему пользователю (та же логика, что строит меню).
  const canAccess = useMemo(() => {
    return (route: string): boolean => {
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
    }
  }, [nav.featuresAllAccess, nav.orgFeatures, nav.isStaff, nav.isOperator, nav.staffRole, nav.isSuperAdmin, nav.subscriptionFeatures, nav.rolePermissionOverrides, capsLoading, can])

  // Только доступные шаги (шаги закрытых страниц пропускаем целиком).
  const steps = useMemo(() => STEPS.filter((s) => canAccess(s.route)), [canAccess])

  // Старт: тур включён, права загружены, есть хотя бы один доступный шаг.
  useEffect(() => {
    if (started || !shouldShow || capsLoading) return
    if (steps.length === 0) return
    setStarted(true)
    setActive(true)
    setI(0)
    router.push(steps[0].route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, capsLoading, steps, started])

  const finish = () => {
    setActive(false)
    fetch('/api/org/onboarding', { method: 'POST' }).catch(() => {})
  }

  if (!active || steps.length === 0) return null
  const idx = Math.min(i, steps.length - 1)
  const step = steps[idx]
  const isLast = idx === steps.length - 1

  const next = () => {
    if (isLast) { finish(); return }
    const ni = idx + 1
    setI(ni)
    router.push(steps[ni].route)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-emerald-500/30 bg-white p-5 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-white">
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" /> {idx + 1} / {steps.length}
          </span>
          <button onClick={finish} className="rounded p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white" aria-label="Закрыть">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-base font-bold">{step.title}</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{step.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <button onClick={finish} className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">Пропустить тур</button>
          <button
            onClick={next}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold transition hover:bg-emerald-700"
          >
            {isLast ? 'Готово' : 'Далее'} {!isLast && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
