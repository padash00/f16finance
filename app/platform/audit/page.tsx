'use client'

import { useEffect, useState } from 'react'
import { Loader2, ScrollText } from 'lucide-react'

type Entry = {
  id: string
  entity_type: string
  entity_id: string | null
  action: string
  payload: any
  created_at: string
}

const ENTITY_LABELS: Record<string, string> = {
  organization: 'Организация',
  invoice: 'Счёт',
  subscription: 'Подписка',
  organization_member: 'Участник',
  organization_addon: 'Модуль',
  organization_package: 'Пакет',
  feature_grant: 'Доступ',
}
const fmtDt = (s: string) => new Date(s).toLocaleString('ru-RU')

export default function PlatformAuditPage() {
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/platform/audit', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setRows(j.data || []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Аудит платформы</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Лента действий по всем клиентам: кто и что менял.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center dark:border-white/15 dark:bg-white/[0.02]">
          <ScrollText className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm font-medium">Событий пока нет</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Здесь появятся изменения по клиентам, счетам и подпискам.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
          <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {rows.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 text-sm transition hover:bg-slate-50 dark:bg-transparent dark:hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                    {ENTITY_LABELS[e.entity_type] || e.entity_type}
                  </span>
                  <span className="text-slate-700 dark:text-slate-200">{e.action}</span>
                </div>
                <span className="tabular-nums text-[11px] text-slate-400 dark:text-slate-500">{fmtDt(e.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
