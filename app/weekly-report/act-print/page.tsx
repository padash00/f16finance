'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { ActBody, type ActData } from '@/components/admin/weekly-act-print'

function ActPrintContent() {
  const params = useSearchParams()
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const [data, setData] = useState<ActData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!from || !to) {
      setError('Не указан период (from/to)')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/weekly-act?from=${from}&to=${to}`, { cache: 'no-store' })
        const j = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(j?.error || 'Ошибка загрузки')
        setData(j.data as ActData)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Ошибка загрузки')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [from, to])

  return (
    <div className="min-h-screen bg-white p-6 text-black">
      <style jsx global>{`
        @page { size: A4 landscape; margin: 8mm; }
        html, body { background: #fff !important; }
        [data-claude-assistant], [data-global-assistant], [data-toaster], [data-sonner-toaster], .sonner-toaster, [data-radix-toast-viewport] { display: none !important; }
      `}</style>
      {error ? (
        <div className="text-rose-600">{error}</div>
      ) : !data ? (
        <div className="text-slate-500">Загрузка…</div>
      ) : (
        <div className="act-paper mx-auto max-w-[1140px]">
          <ActBody data={data} />
        </div>
      )}
    </div>
  )
}

export default function WeeklyActPrintPage() {
  return (
    <Suspense fallback={null}>
      <ActPrintContent />
    </Suspense>
  )
}
