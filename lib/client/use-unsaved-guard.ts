'use client'

/**
 * Защита несохранённой формы в модалке.
 *
 *   const guardClose = useUnsavedGuard(isDirty)
 *   <Dialog open={open} onOpenChange={(v) => { if (!v) guardClose(() => setOpen(false)) }}>
 *
 * Если форма грязная — показывает фирменный диалог «Закрыть без сохранения?»;
 * чистая — закрывает сразу. Плюс beforeunload на закрытие вкладки.
 */

import { useCallback, useEffect } from 'react'

import { confirmDialog } from '@/components/ui/confirm-dialog'

export function useUnsavedGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  return useCallback(
    async (close: () => void) => {
      if (!isDirty) {
        close()
        return
      }
      const ok = await confirmDialog({
        title: 'Закрыть без сохранения?',
        description: 'В форме есть несохранённые изменения — они будут потеряны.',
        confirmLabel: 'Закрыть',
        cancelLabel: 'Вернуться к форме',
        destructive: true,
      })
      if (ok) close()
    },
    [isDirty],
  )
}
