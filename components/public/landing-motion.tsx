'use client'

// Кинематографичные motion-примитивы для лендинга (framer-motion).
// Серверная страница импортирует их как client-островки: контент рендерится
// на сервере (SEO сохраняется), оживает анимацией при попадании во вьюпорт.
// Все анимации уважают prefers-reduced-motion.

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

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
