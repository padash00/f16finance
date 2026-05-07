'use client'

/**
 * useModalEscape — минимальный хук для существующих кастомных модалок.
 *
 * Фиксит 3 системные проблемы одной строкой:
 *   ✓ Esc → onClose
 *   ✓ Body scroll lock пока модалка открыта (фон не скроллится)
 *   ✓ Скрипт автоматически снимается на unmount
 *
 * Использование:
 *   useModalEscape(showModal, () => setShowModal(false))
 *
 * Не трогает разметку — для бóльших изменений (центровка, focus trap)
 * используй <AppModal> wrapper из components/ui/app-modal.tsx.
 */

import { useEffect } from 'react'

export function useModalEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])
}
