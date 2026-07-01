'use client'

// Анимированные продукт-демо для лендинга: живые сценки вместо статичных карточек.
// Каждая демка — зацикленная мини-история (Telegram-приёмка, AI-копилот, офлайн-касса).
// Все уважают prefers-reduced-motion: без анимации показывается финальный кадр.

import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, CheckCircle2, CloudOff, FileText, RefreshCw, Wifi } from 'lucide-react'

const EASE = [0.16, 1, 0.3, 1] as const

/** Тикер AI-инсайтов: строки сменяют друг друга с мягким слайдом. */
export function InsightTicker({ items, intervalMs = 4200, className }: { items: string[]; intervalMs?: number; className?: string }) {
  const rm = useReducedMotion()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (rm) return
    const t = setInterval(() => setI((v) => (v + 1) % items.length), intervalMs)
    return () => clearInterval(t)
  }, [rm, items.length, intervalMs])
  return (
    <div className={className}>
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={rm ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={rm ? undefined : { opacity: 0, y: -10 }}
          transition={{ duration: 0.45, ease: EASE }}
          className="text-[13px] leading-[1.55] text-[#56657d]"
        >
          {items[i]}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Столбики графика, вырастающие при появлении во вьюпорте. */
export function GrowBars({ values, highlightLast = true }: { values: number[]; highlightLast?: boolean }) {
  const rm = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  return (
    <div ref={ref} className="flex h-12 items-end gap-1.5">
      {values.map((h, i) => (
        <motion.div
          key={i}
          initial={rm ? { height: `${h}%` } : { height: '8%' }}
          animate={inView ? { height: `${h}%` } : undefined}
          transition={{ duration: 0.7, ease: EASE, delay: 0.08 * i }}
          className={`flex-1 rounded-t-[3px] bg-gradient-to-t from-[#16a34a]/25 ${highlightLast && i === values.length - 1 ? 'to-[#16a34a]' : 'to-[#16a34a]/80'}`}
        />
      ))}
    </div>
  )
}

/** Бегущая строка чипов-возможностей (бесшовный marquee). */
export function FeatureMarquee({ items, duration = 44 }: { items: string[]; duration?: number }) {
  const rm = useReducedMotion()
  const row = (
    <div className="flex shrink-0 items-center gap-2.5 pr-2.5">
      {items.map((label) => (
        <span
          key={label}
          className="whitespace-nowrap rounded-full border border-[#d6dde8] bg-white px-4 py-1.5 text-[13px] font-medium text-[#475569]"
        >
          {label}
        </span>
      ))}
    </div>
  )
  if (rm) {
    return <div className="flex flex-wrap justify-center gap-2.5">{items.slice(0, 12).map((label) => (
      <span key={label} className="rounded-full border border-[#d6dde8] bg-white px-4 py-1.5 text-[13px] font-medium text-[#475569]">{label}</span>
    ))}</div>
  }
  return (
    <div className="relative overflow-hidden" style={{ maskImage: 'linear-gradient(90deg,transparent,black 8%,black 92%,transparent)' }}>
      <motion.div className="flex w-max" animate={{ x: ['0%', '-50%'] }} transition={{ duration, repeat: Infinity, ease: 'linear' }}>
        {row}
        {row}
      </motion.div>
    </div>
  )
}

// ─── Telegram-демо: фото накладной → приёмка ─────────────────────────────────

type TgMessage = { side: 'out' | 'in'; body: ReactNode }

function TgBubble({ side, children }: { side: 'out' | 'in'; children: ReactNode }) {
  return (
    <div className={`flex ${side === 'out' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          side === 'out'
            ? 'max-w-[82%] rounded-[14px] rounded-br-[4px] bg-[#16a34a] px-3.5 py-2.5 text-[13px] leading-[1.5] text-white'
            : 'max-w-[82%] rounded-[14px] rounded-bl-[4px] border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-[13px] leading-[1.5] text-[#0f2038]'
        }
      >
        {children}
      </div>
    </div>
  )
}

export function TelegramDemo() {
  const rm = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-60px' })
  const messages: TgMessage[] = [
    {
      side: 'out',
      body: (
        <span className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-white/20"><FileText className="h-5 w-5" /></span>
          <span>Фото накладной от поставщика</span>
        </span>
      ),
    },
    { side: 'in', body: <>Распознал накладную: <b>14 позиций на 182 400 ₸</b>. Все сопоставлены с каталогом. Создать приёмку?</> },
    { side: 'out', body: <>Да</> },
    { side: 'in', body: <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 shrink-0 text-[#16a34a]" />Приёмка создана, остатки склада обновлены.</span> },
    { side: 'in', body: <><b>Итоги дня:</b> выручка 412 800 ₸ (+8%), прибыль 96 200 ₸. Аномалий нет. Подробный отчёт — /report</> },
  ]
  const [step, setStep] = useState(rm ? messages.length : 0)
  useEffect(() => {
    if (rm || !inView) return
    const t = setInterval(() => setStep((s) => (s >= messages.length + 1 ? 0 : s + 1)), 1700)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rm, inView])
  return (
    <div ref={ref} className="rounded-[20px] border border-[#d6dde8] bg-[#eef2f8] p-4">
      <div className="flex items-center gap-2.5 border-b border-[#dbe3ee] pb-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#16a34a] text-white"><Bot className="h-4 w-4" /></span>
        <div>
          <div className="text-[13px] font-bold text-[#0f2038]">Orda Bot</div>
          <div className="text-[11px] text-[#64748b]">Telegram · онлайн</div>
        </div>
      </div>
      <div className="mt-3 flex min-h-[280px] flex-col justify-end gap-2">
        {messages.slice(0, Math.min(step, messages.length)).map((m, i) => (
          <motion.div
            key={i}
            initial={rm ? false : { opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <TgBubble side={m.side}>{m.body}</TgBubble>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─── AI-копилот: команда → выполнено ─────────────────────────────────────────

const COPILOT_SCENES = [
  { command: 'Дай Диане премию 5 000 ₸ за смену', result: 'Премия добавлена — попадёт в расчёт зарплаты этой недели.' },
  { command: 'Почему упала маржа на этой неделе?', result: 'Закупка «напитки» подорожала на 14%. Есть поставщик дешевле на 11% — экономия ~42 000 ₸/мес.' },
  { command: 'Создай промокод −10% на выходные', result: 'Промокод создан и активен: касса применит его автоматически.' },
  { command: 'Кто менял расходы вчера вечером?', result: 'Нашёл в журнале: 2 изменения, показываю кто, что и когда.' },
]

export function CopilotDemo() {
  const rm = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-60px' })
  const [scene, setScene] = useState(0)
  const [typed, setTyped] = useState(rm ? COPILOT_SCENES[0].command : '')
  const [showResult, setShowResult] = useState(rm)

  useEffect(() => {
    if (rm || !inView) return
    let cancelled = false
    const current = COPILOT_SCENES[scene].command
    setTyped('')
    setShowResult(false)
    let i = 0
    const typeTimer = setInterval(() => {
      if (cancelled) return
      i += 1
      setTyped(current.slice(0, i))
      if (i >= current.length) {
        clearInterval(typeTimer)
        setTimeout(() => { if (!cancelled) setShowResult(true) }, 500)
        setTimeout(() => { if (!cancelled) setScene((s) => (s + 1) % COPILOT_SCENES.length) }, 4200)
      }
    }, 38)
    return () => { cancelled = true; clearInterval(typeTimer) }
  }, [rm, inView, scene])

  return (
    <div ref={ref} className="rounded-[20px] border border-[#d6dde8] bg-white p-5 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#15803d]">
        <Bot className="h-4 w-4" />AI-копилот
      </div>
      <div className="mt-3 flex min-h-[52px] items-center rounded-[13px] border border-[#c8d1de] bg-[#f7f9fc] px-4 py-3">
        <span className="text-[14.5px] font-medium text-[#0f2038]">
          {typed}
          {!rm && <motion.span aria-hidden className="ml-0.5 inline-block h-[16px] w-[2px] translate-y-[3px] bg-[#16a34a]" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.9, repeat: Infinity }} />}
        </span>
      </div>
      <div className="mt-3 min-h-[76px]">
        <AnimatePresence mode="wait">
          {showResult && (
            <motion.div
              key={scene}
              initial={rm ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={rm ? undefined : { opacity: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="flex items-start gap-2.5 rounded-[13px] border border-[#16a34a]/25 bg-[#16a34a]/[0.06] px-4 py-3"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" />
              <span className="text-[13.5px] leading-[1.55] text-[#0f2038]">{COPILOT_SCENES[scene].result}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2 text-[12px] text-[#94a3b8]">Копилот выполняет действия сам — с учётом прав сотрудника и записью в журнал.</div>
    </div>
  )
}

// ─── Офлайн-касса: сеть упала → очередь → синхронизация ──────────────────────

const OFFLINE_TIMELINE = [
  { net: false, queue: 1, syncing: false, done: false },
  { net: false, queue: 2, syncing: false, done: false },
  { net: false, queue: 3, syncing: false, done: false },
  { net: true, queue: 3, syncing: true, done: false },
  { net: true, queue: 0, syncing: false, done: true },
] as const

export function OfflineDemo() {
  const rm = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-60px' })
  const [i, setI] = useState(rm ? OFFLINE_TIMELINE.length - 1 : 0)
  useEffect(() => {
    if (rm || !inView) return
    const t = setInterval(() => setI((v) => (v + 1) % OFFLINE_TIMELINE.length), 1500)
    return () => clearInterval(t)
  }, [rm, inView])
  const s = OFFLINE_TIMELINE[i]
  return (
    <div ref={ref} className="rounded-[16px] border border-[#e2e8f0] bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#64748b]">Касса · офлайн-режим</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={s.net ? 'on' : 'off'}
            initial={rm ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={rm ? undefined : { opacity: 0 }}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.net ? 'bg-[#16a34a]/10 text-[#15803d]' : 'bg-[#f97316]/10 text-[#c2570c]'}`}
          >
            {s.net ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {s.net ? 'Сеть восстановлена' : 'Нет интернета'}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-[12px] bg-[#f7f9fc] px-4 py-3">
        <span className="text-[13.5px] font-medium text-[#0f2038]">Продажи продолжаются</span>
        <AnimatePresence mode="wait">
          {s.done ? (
            <motion.span key="done" initial={rm ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#15803d]">
              <CheckCircle2 className="h-4 w-4" />Синхронизировано
            </motion.span>
          ) : s.syncing ? (
            <motion.span key="sync" initial={rm ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0f2038]">
              <RefreshCw className="h-4 w-4 animate-spin text-[#16a34a]" />Отправка очереди…
            </motion.span>
          ) : (
            <motion.span key={`q${s.queue}`} initial={rm ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[12.5px] font-semibold text-[#c2570c]">
              В очереди: {s.queue}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
