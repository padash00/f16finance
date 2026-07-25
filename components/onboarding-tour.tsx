'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, ArrowRight, X } from 'lucide-react'

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
  const [active, setActive] = useState(false)
  const [i, setI] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/org/onboarding')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.show) return
        setActive(true)
        setI(0)
        router.push(STEPS[0].route)
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = () => {
    setActive(false)
    fetch('/api/org/onboarding', { method: 'POST' }).catch(() => {})
  }

  if (!active) return null
  const step = STEPS[i]
  const isLast = i === STEPS.length - 1

  const next = () => {
    if (isLast) { finish(); return }
    const ni = i + 1
    setI(ni)
    router.push(STEPS[ni].route)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-emerald-500/30 bg-slate-900 p-5 text-white shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" /> {i + 1} / {STEPS.length}
          </span>
          <button onClick={finish} className="rounded p-1 text-slate-400 hover:text-white" aria-label="Закрыть">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-base font-bold">{step.title}</h3>
        <p className="mt-1 text-sm text-slate-300">{step.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <button onClick={finish} className="text-xs text-slate-400 hover:text-white">Пропустить тур</button>
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
