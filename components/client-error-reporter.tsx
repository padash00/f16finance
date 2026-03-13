'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export function ClientErrorReporter() {
  const pathname = usePathname()

  useEffect(() => {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'page_view',
        area: pathname,
        pathname,
        source: 'client-navigation',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      }),
    }).catch(() => null)

    const report = (payload: { area: string; message: string; source: string; stack?: string | null }) => {
      fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'client_error',
          ...payload,
          pathname,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      }).catch(() => null)
    }

    const onError = (event: ErrorEvent) => {
      report({
        area: pathname || 'window',
        message: event.message || 'Unhandled client error',
        source: event.filename || 'window.error',
        stack: event.error?.stack || null,
      })
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      report({
        area: pathname || 'window',
        message: reason?.message || String(reason || 'Unhandled rejection'),
        source: 'unhandledrejection',
        stack: reason?.stack || null,
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [pathname])

  return null
}
