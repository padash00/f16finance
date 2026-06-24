'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

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
    <div className="p-6 text-slate-900 dark:text-white">
      <h1 className="mb-5 text-2xl font-semibold">Аудит платформы</h1>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Событий пока нет.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-white/[0.02] px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-600 dark:text-violet-300">{ENTITY_LABELS[e.entity_type] || e.entity_type}</span>
                <span className="text-slate-700 dark:text-slate-200">{e.action}</span>
              </div>
              <span className="text-[11px] text-slate-500">{fmtDt(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
