'use client'

/**
 * Undo-удаление: строка мгновенно исчезает из UI, реальное удаление уходит на
 * сервер через 5 секунд, тост показывает «Отменить». Отмена — возвращаем строку,
 * запрос не отправляется.
 *
 *   deleteWithUndo({
 *     message: 'Расход удалён',
 *     hide: () => setRows(prev => prev.filter(r => r.id !== id)),
 *     restore: () => setRows(prev => [row, ...prev]),
 *     commit: async () => { await fetch(...DELETE...) },
 *   })
 *
 * commit вызывается один раз (после таймера или на pagehide — чтобы удаление
 * не потерялось при закрытии вкладки во время отсчёта).
 */

import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'

const UNDO_MS = 5000

export function deleteWithUndo(params: {
  message: string
  hide: () => void
  restore: () => void
  commit: () => Promise<void>
  onCommitError?: (error: unknown) => void
}) {
  const { message, hide, restore, commit, onCommitError } = params
  let done = false
  let undone = false

  const runCommit = () => {
    if (done || undone) return
    done = true
    window.removeEventListener('pagehide', runCommit)
    void commit().catch((error) => {
      // Сервер отказал — возвращаем строку, чтобы UI не врал
      restore()
      if (onCommitError) onCommitError(error)
      else toast({ description: 'Не удалось удалить — запись восстановлена', duration: 4000 })
    })
  }

  hide()
  const timer = window.setTimeout(runCommit, UNDO_MS)
  window.addEventListener('pagehide', runCommit)

  const t = toast({
    description: message,
    duration: UNDO_MS,
    action: (
      <ToastAction
        altText="Отменить удаление"
        onClick={() => {
          undone = true
          window.clearTimeout(timer)
          window.removeEventListener('pagehide', runCommit)
          restore()
        }}
      >
        Отменить
      </ToastAction>
    ),
  })
  void t
}
