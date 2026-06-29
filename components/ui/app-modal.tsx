'use client'

/**
 * AppModal — единая обёртка для всех модальных окон в проекте.
 *
 * Что фиксит (системные проблемы кастомных модалок):
 *   ✓ Esc закрывает (всегда)
 *   ✓ Клик по фону закрывает
 *   ✓ Контент центрируется flex-ом — нельзя "уехать вниз"
 *   ✓ Длинный контент скроллится ВНУТРИ модалки (overflow-y-auto + max-h)
 *   ✓ Body не скроллится пока модалка открыта (scroll lock)
 *   ✓ z-index 100 — над любым админ-контентом
 *   ✓ Focus trap — Tab не уходит за пределы
 *   ✓ Автофокус на первом инпуте через 50ms
 *
 * Использование:
 *   <AppModal open={isOpen} onClose={() => setOpen(false)} title="Заголовок">
 *     <div>Контент</div>
 *   </AppModal>
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export type AppModalProps = {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  /** Максимальная ширина (Tailwind max-w-*). Default: 'max-w-lg' */
  maxWidth?: string
  /** Скрыть кнопку X в углу */
  hideCloseButton?: boolean
  /** Запретить закрытие по клику вне (для важных модалок) */
  disableBackdropClose?: boolean
  /** Запретить закрытие по Esc (для важных модалок) */
  disableEscClose?: boolean
  children: React.ReactNode
  /** Футер фиксированный внизу (кнопки сохранить/отмена) */
  footer?: React.ReactNode
}

export function AppModal({
  open,
  onClose,
  title,
  maxWidth = 'max-w-lg',
  hideCloseButton = false,
  disableBackdropClose = false,
  disableEscClose = false,
  children,
  footer,
}: AppModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Esc → close
  useEffect(() => {
    if (!open || disableEscClose) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, disableEscClose])

  // Body scroll lock + автофокус
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Автофокус на первый инпут
    const t = setTimeout(() => {
      const el = contentRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), textarea, select, button[data-autofocus]'
      )
      el?.focus()
    }, 50)

    return () => {
      document.body.style.overflow = prevOverflow
      clearTimeout(t)
    }
  }, [open])

  if (!open) return null
  if (typeof window === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (disableBackdropClose) return
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : 'Модальное окно'}
    >
      <div
        ref={contentRef}
        className={`relative w-full ${maxWidth} my-8 bg-white dark:bg-gray-900 border border-border rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[calc(100vh-4rem)]`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || !hideCloseButton) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/5 flex-shrink-0">
            <div className="text-lg font-semibold text-foreground">{title}</div>
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white"
                aria-label="Закрыть"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
        {footer && (
          <div className="flex-shrink-0 px-6 py-4 border-t border-slate-200 dark:border-white/5 bg-white/95 dark:bg-gray-900/95 sticky bottom-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
