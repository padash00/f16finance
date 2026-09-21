'use client'

/**
 * Единое модальное окно проекта.
 *
 *   <AppModal open={open} onClose={close} title="Приёмка" footer={<Buttons />}>
 *     <div>Контент</div>
 *   </AppModal>
 *
 * Рендерится в portal на document.body — не обрезается родительскими
 * overflow/transform (см. заметку про template с transform: translateY(0)).
 *
 * Этажи наложения в проекте:
 *   z-[100] — это окно
 *   z-[150] — confirmDialog поверх него («Удалить?», вызванное из модалки)
 *   z-[200] — тосты, всегда поверх всего
 * Раньше окно и тосты делили z-[100], и предупреждение уезжало под окно.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type Tone = 'default' | 'danger' | 'warning' | 'success'

const TONES: Record<Tone, { chip: string; line: string }> = {
  default: { chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300', line: 'from-emerald-400/80' },
  danger: { chip: 'bg-rose-500/12 text-rose-700 dark:text-rose-300', line: 'from-rose-400/80' },
  warning: { chip: 'bg-amber-500/14 text-amber-700 dark:text-amber-300', line: 'from-amber-400/80' },
  success: { chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300', line: 'from-emerald-400/80' },
}

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
  /** Подзаголовок под названием — что это за окно и что тут произойдёт */
  description?: React.ReactNode
  /** Иконка слева от заголовка, в цветном чипе по тону */
  icon?: React.ReactNode
  /** Смысловой акцент: обычное окно, опасное действие, предупреждение */
  tone?: Tone
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
  description,
  icon,
  tone = 'default',
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

  const t = TONES[tone]
  const hasHeader = Boolean(title || description || !hideCloseButton)

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-slate-950/70 p-0 backdrop-blur-[3px] animate-in fade-in duration-150 sm:items-center sm:p-6"
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
        className={[
          'relative flex w-full flex-col overflow-hidden bg-card shadow-2xl ring-1 ring-black/5 dark:ring-white/10',
          // Телефон — лист снизу на всю ширину, десктоп — карточка по центру
          'max-h-[92dvh] rounded-t-3xl sm:max-h-[calc(100dvh-4rem)] sm:rounded-2xl',
          'animate-in duration-200 slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 sm:fade-in',
          maxWidth,
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Тонкая полоса сверху: тон окна виден раньше, чем прочитан заголовок */}
        <div className={`h-[3px] w-full shrink-0 bg-gradient-to-r ${t.line} to-transparent`} />

        {/* Хват для листа на телефоне */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" />

        {hasHeader && (
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              {icon ? (
                <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${t.chip}`}>{icon}</div>
              ) : null}
              <div className="min-w-0">
                {title ? (
                  <div className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
                    {title}
                  </div>
                ) : null}
                {description ? (
                  <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</div>
                ) : null}
              </div>
            </div>
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="shrink-0 rounded-xl p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground active:scale-95"
                aria-label="Закрыть"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Прокручивается только тело — шапка и кнопки всегда на виду */}
        <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 ${hasHeader ? 'border-t border-border' : ''}`}>
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-border bg-surface-hover/40 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
