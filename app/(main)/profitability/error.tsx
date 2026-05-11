'use client'

import { useEffect } from 'react'

export default function ProfitabilityError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Profitability page error:', error)
  }, [error])

  return (
    <div className="app-page-wide space-y-4 p-8">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
        <h2 className="text-xl font-semibold text-red-300 mb-2">Ошибка на странице ОПиУ</h2>
        <p className="text-sm text-red-200 mb-4">{error.message || 'Неизвестная ошибка'}</p>
        {error.digest ? (
          <p className="text-xs text-red-400 mb-4">Digest: {error.digest}</p>
        ) : null}
        {error.stack ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-red-300 hover:text-red-200">
              Технические детали (для разработчика)
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
