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
// clickFirst — data-tour элемента, по которому кликнуть перед подсветкой
// (открыть вкладку/раскрыть блок), чтобы целевая кнопка появилась в DOM.
type Step = { route: string; tour?: string; clickFirst?: string; title: string; text: string }

// Тур построен вокруг ЗАДАЧ, которые новичок не знает как сделать
// (завести точку, добавить товары, принять поставку, нанять, открыть кассу),
// а не вокруг отдельных кнопок. Каждый шаг ведёт на нужную страницу и обводит
// всю рабочую область целиком.
const STEPS: Step[] = [
  { route: '/dashboard', title: 'Добро пожаловать в Orda', text: 'Проведём по шагам запуска: заведём точку, добавим товары, примем поставку, наймём команду и откроем кассу. Займёт минуту — в любой момент можно нажать «Пропустить».' },
  { route: '/settings', tour: 'settings-companies', title: 'Шаг 1 · Заведи точку', text: 'Компания — это твоя бизнес-точка: к ней привязаны товары, сотрудники и деньги. Одна компания = одна точка. Начинается всё отсюда.' },
  { route: '/point-devices', tour: 'pd-new-project', title: 'Шаг 2 · Настрой кассу', text: 'Проект — как точка работает на кассе: добавь точку кнопкой «Добавить», отметь нужные функции (смены, доходы, долги, арена) и сохрани. Именно к проекту подключается операторская программа.' },
  { route: '/store/stock', clickFirst: 'store-tab-catalog', tour: 'catalog-add-item', title: 'Шаг 3 · Как добавить товары', text: 'Чтобы касса что-то продавала, заполни каталог. «Добавить товар» — завести по одному (название, штрихкод, цены). Рядом вкладка «Импорт Excel» — залить весь список разом.' },
  { route: '/store/stock', tour: 'store-tabs', title: 'Склад и витрина', text: 'Товар живёт в двух местах: «Склад» — подсобка (сюда падает приёмка), «Витрина» — то, что продаётся на кассе. «Движения» — вся история. Переключай эти вкладки.' },
  { route: '/store/documents', clickFirst: 'doc-tab-receipts', tour: 'receipt-new', title: 'Шаг 4 · Как принять поставку', text: 'Пришёл товар от поставщика — жми «Новый документ». Сейчас откроем эту форму и пройдём её по кнопкам.' },
  { route: '/store/documents', clickFirst: 'receipt-new', tour: 'receipt-quickadd', title: 'Приёмка · Добавь товары', text: 'Сюда добавляешь строки прихода: отсканируй штрихкод или введи название и жми «Добавить товар». Товар, которого ещё нет в каталоге, заведётся автоматически.' },
  { route: '/store/documents', clickFirst: 'receipt-new', tour: 'receipt-invoice', title: 'Приёмка · Накладная и ИИ', text: 'Загрузи файл накладной (обязательно) и нажми «Распознать ИИ» — он сам разложит строки и суммы. Останется только проверить.' },
  { route: '/store/documents', clickFirst: 'receipt-new', tour: 'receipt-submit', title: 'Приёмка · Проведи', text: 'Проверил строки и цены — жми «Провести приемку». Остатки на складе вырастут, цены обновятся, а сумма закупа уйдёт в расходы.' },
  { route: '/hr', tour: 'hr-hire', title: 'Шаг 5 · Как нанять сотрудника', text: 'Жми «Нанять»: имя, роль, ставка. Кассиру логин и пароль для веб-кассы выдаются сразу. При одной точке привязка автоматическая, при нескольких — выберешь точки и основную.' },
  { route: '/store/shifts', tour: 'page-header', title: 'Шаг 6 · Смена и касса', text: 'Открой смену по точке — оператор заходит в веб-кассу (пункт «Web POS» в меню) и продаёт товары карточками. Закрытие смены сводит выручку и наличные.' },
  { route: '/reports', tour: 'page-header', title: 'Готово · Финансы', text: 'Здесь видно результат: доходы, расходы, прибыль, маржа и аналитика по дням и точкам. Всё, точка запущена — можно работать.' },
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
      // Цель ещё не в DOM — кликаем открывашку (вкладку/блок), она может
      // отрисоваться не сразу после захода на страницу, поэтому пробуем каждый раз.
      if (!el && step.clickFirst) {
        const opener = document.querySelector(`[data-tour="${step.clickFirst}"]`) as HTMLElement | null
        opener?.click()
      }
      if (el) {
        // Мгновенный скролл (не smooth): плавная прокрутка порождает поток
        // scroll-событий → пересчёт rect на каждом кадре → мигание обводки.
        const r0 = el.getBoundingClientRect()
        const inView = r0.top >= 0 && r0.bottom <= (window.innerHeight || 0)
        if (!inView) { try { el.scrollIntoView({ block: 'center', behavior: 'auto' }) } catch {} }
        setTimeout(() => setRect(el.getBoundingClientRect()), inView ? 0 : 120)
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

  // Пересчёт позиции при скролле/ресайзе (throttle через rAF — без шторма setState).
  useEffect(() => {
    if (!step?.tour) return
    let raf = 0
    const recompute = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = document.querySelector(`[data-tour="${step.tour}"]`) as HTMLElement | null
        if (el) setRect(el.getBoundingClientRect())
      })
    }
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    return () => {
      if (raf) cancelAnimationFrame(raf)
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
    // rect не сбрасываем: эффект поиска сам обновит его (дырка плавно переедет),
    // а для шага без обводки — погасит. Сброс тут давал лишнее «моргание».
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
      {/* Затемнение + «дырка» с обводкой вокруг элемента (spotlight).
          Оба состояния — одинаковая опаклесть 0.62, чтобы при переходе между
          шагами яркость затемнения не пульсировала (это и давало «моргание»). */}
      {rect ? (
        <div
          className="pointer-events-none fixed z-[201] rounded-xl ring-2 ring-emerald-400 transition-[top,left,width,height] duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(2,6,23,0.62)',
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[201]" style={{ backgroundColor: 'rgba(2,6,23,0.62)' }} />
      )}

      {/* Карточка. stopPropagation на pointerdown — чтобы Radix-модалка
          (приёмка и т.п.) не закрывалась, считая клик по карточке «внешним». */}
      <div style={cardStyle}>
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto rounded-2xl border border-emerald-500/30 bg-white p-5 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-white"
        >
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
