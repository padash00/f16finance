'use client'

/**
 * Фирменная замена window.confirm(): промис-API + один хост в layout.
 *
 *   const ok = await confirmDialog({
 *     title: 'Удалить расход?',
 *     description: 'Действие можно будет отменить в течение 5 секунд.',
 *     confirmLabel: 'Удалить',
 *     destructive: true,
 *   })
 *
 * <ConfirmDialogHost /> монтируется один раз в app/(main)/layout.tsx.
 */

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void }

let enqueue: ((p: PendingConfirm) => void) | null = null

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!enqueue) {
      // Хост не смонтирован (не (main)-layout) — деградируем в системный confirm
      resolve(window.confirm(options.title + (options.description ? `\n\n${options.description}` : '')))
      return
    }
    enqueue({ ...options, resolve })
  })
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  useEffect(() => {
    enqueue = (p) => setPending(p)
    return () => { enqueue = null }
  }, [])

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) close(false) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          {pending?.description ? <DialogDescription>{pending.description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {pending?.cancelLabel || 'Отмена'}
          </Button>
          <Button
            type="button"
            variant={pending?.destructive ? 'destructive' : 'default'}
            autoFocus
            onClick={() => close(true)}
          >
            {pending?.confirmLabel || 'Подтвердить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
