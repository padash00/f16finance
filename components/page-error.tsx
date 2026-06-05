'use client'

import { useEffect } from 'react'

/**
 * Переиспользуемая граница ошибки сегмента. Вместо «белого экрана» при сбое
 * рендера показывает понятное сообщение + кнопку «Попробовать ещё раз».
 * Использование: app/(main)/<segment>/error.tsx → <PageError {...props} title="..." />
 */
export function PageError({
  error,
  reset,
  title,
}: {
  error: Error & { digest?: string }
  reset: () => void
  title: string
}) {
  useEffect(() => {
    console.error(`${title}:`, error)
  }, [error, title])

  return (
    <div className="app-page-wide space-y-4 p-8">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
        <h2 className="mb-2 text-xl font-semibold text-red-300">{title}</h2>
        <p className="mb-4 text-sm text-red-200">{error.message || 'Неизвестная ошибка'}</p>
        {error.digest ? <p className="mb-4 text-xs text-red-400">Digest: {error.digest}</p> : null}
        {error.stack ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-red-300 hover:text-red-200">
              Технические детали
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-red-200">
              {error.stack}
            </pre>
          </details>
        ) : null}
        <button
          onClick={reset}
          className="mt-6 rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-100 hover:bg-red-500/30"
        >
          Попробовать ещё раз
        </button>
      </div>
    </div>
  )
}
