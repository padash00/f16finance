export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
const listeners = new Set<Listener>()

function notify() {
  const copy = [...toasts]
  listeners.forEach(l => l(copy))
}

export function addToast(type: ToastType, message: string, duration = 4000) {
  const id = Math.random().toString(36).slice(2, 10)
  toasts = [...toasts, { id, type, message }]
  notify()
  setTimeout(() => dismissToast(id), duration)
}

export function dismissToast(id: string) {
  toasts = toasts.filter(t => t.id !== id)
  notify()
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener([...toasts])
  return () => listeners.delete(listener)
}

export const toastSuccess = (msg: string, duration?: number) => addToast('success', msg, duration)
export const toastError = (msg: string, duration?: number) => addToast('error', msg, duration)
export const toastWarning = (msg: string, duration?: number) => addToast('warning', msg, duration)
export const toastInfo = (msg: string, duration?: number) => addToast('info', msg, duration)
