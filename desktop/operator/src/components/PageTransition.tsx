import { motion, AnimatePresence } from 'framer-motion'
import type { ReactNode } from 'react'

interface PageTransitionProps {
  /** Уникальный ключ страницы — при смене запускает выход → вход */
  pageKey: string
  children: ReactNode
}

/**
 * Глобальная обёртка для смены страниц/режимов в operator.
 * Плавный fade + slight slide. Уважает prefers-reduced-motion (motion library).
 */
export function PageTransition({ pageKey, children }: PageTransitionProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex h-full w-full flex-col"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** Для микро-блоков (карточки, тосты) — мягкое появление снизу */
export function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}
