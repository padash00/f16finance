'use client'

// Кинематографичные motion-примитивы для лендинга (framer-motion).
// Серверная страница импортирует их как client-островки: контент рендерится
// на сервере (SEO сохраняется), оживает анимацией при попадании во вьюпорт.
// Все анимации уважают prefers-reduced-motion.

import { animate, motion, useInView, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'

const EASE = [0.16, 1, 0.3, 1] as const

/** Появление блока при скролле: плавный fade + подъём. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 24,
}: {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
}) {
  const rm = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={rm ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

/** Контейнер со ступенчатым появлением детей (используется с StaggerItem). */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
    >
      {children}
    </motion.div>
  )
}

/** Один элемент в Stagger-контейнере. */
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const rm = useReducedMotion()
  return (
    <motion.div
      className={className}
      variants={
        rm
          ? { hidden: {}, show: {} }
          : { hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }
      }
    >
      {children}
    </motion.div>
  )
}

/** Появление hero-контента при загрузке (не по скроллу). */
export function HeroIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const rm = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={rm ? false : { opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

/** Счётчик, «накручивающийся» от 0 до значения при появлении во вьюпорте. */
export function CountUp({ value, suffix = '', duration = 1.4 }: { value: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const rm = useReducedMotion()
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (!inView) return
    if (rm) {
      setDisplay(value)
      return
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    })
    return () => controls.stop()
  }, [inView, rm, value, duration])
  const formatted = Math.round(display)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (
    <span ref={ref} className="tabular-nums">
      {formatted}
      {suffix}
    </span>
  )
}

/** Пульсирующая точка LIVE-индикатора. */
export function LiveDot({ className }: { className?: string }) {
  const rm = useReducedMotion()
  return (
    <motion.span
      className={className ?? 'h-1.5 w-1.5 rounded-full bg-[var(--color-accent-teal)]'}
      animate={rm ? undefined : { opacity: [1, 0.25, 1], scale: [1, 0.75, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

/** Текст с медленно переливающимся градиентом (для выделения в заголовке). */
export function ShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  const rm = useReducedMotion()
  return (
    <motion.span
      className={className}
      style={{
        backgroundImage: 'linear-gradient(110deg,#ffb25c,#ff9c57,#ff7b4d,#ffce8f,#ffb25c)',
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }}
      animate={rm ? undefined : { backgroundPosition: ['0% 50%', '200% 50%'] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
    >
      {children}
    </motion.span>
  )
}

/** Анимированное ambient-свечение за контентом — кинематографичная атмосфера. */
export function AmbientGlow() {
  const rm = useReducedMotion()
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* базовый тёмный градиент (перенесён сюда, чтобы свечение было видно) */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#050a14_0%,#07101d_55%,#050a14_100%)]" />
      {/* цветные дрейфующие свечения — заметные */}
      <motion.div
        className="absolute -top-32 left-[-8%] h-[560px] w-[560px] rounded-full bg-[#ff8c46]/40 blur-[120px]"
        animate={rm ? undefined : { x: [0, 70, 0], y: [0, 44, 0] }}
        transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-[24%] right-[-8%] h-[540px] w-[540px] rounded-full bg-[#10d6c2]/28 blur-[120px]"
        animate={rm ? undefined : { x: [0, -56, 0], y: [0, 64, 0] }}
        transition={{ duration: 23, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-14%] left-[22%] h-[500px] w-[500px] rounded-full bg-[#ffb25c]/26 blur-[130px]"
        animate={rm ? undefined : { x: [0, 48, 0], y: [0, -46, 0] }}
        transition={{ duration: 27, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-[4%] left-[34%] h-[460px] w-[460px] rounded-full bg-[#ff7b4d]/22 blur-[150px]"
        animate={rm ? undefined : { x: [0, -36, 0], y: [0, 50, 0] }}
        transition={{ duration: 31, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}
