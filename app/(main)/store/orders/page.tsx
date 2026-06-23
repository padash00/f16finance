'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { ClipboardList, History, Truck, Loader2 } from 'lucide-react'

const fallback = () => <div className="app-page-wide flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>

const Requests = dynamic(() => import('@/app/(main)/store/requests/page'), { ssr: false, loading: fallback })
const Journal = dynamic(() => import('@/app/(main)/store/requests-journal/page'), { ssr: false, loading: fallback })
const Purchase = dynamic(() => import('@/app/(main)/store/purchase-orders/page'), { ssr: false, loading: fallback })

type Tab = 'requests' | 'journal' | 'purchase'
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'requests', label: 'Заявки', icon: ClipboardList },
  { key: 'journal', label: 'Журнал', icon: History },
  { key: 'purchase', label: 'Заявки поставщикам', icon: Truck },
]

export default function StoreOrdersPage() {
  const [tab, setTab] = useState<Tab>('requests')

  return (
    <div className="app-page-wide space-y-4">
      <AdminPageHeader
        title="Заявки"
        description="Заявки точек, журнал и заказы поставщикам"
        icon={<ClipboardList className="h-5 w-5" />}
        accent="emerald"
        backHref="/store"
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/50 p-1">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${tab === key ? 'bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200 dark:ring-white/10' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
              >
                <Icon className={`h-4 w-4 ${tab === key ? 'text-emerald-700 dark:text-emerald-300' : ''}`} />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'requests' && <Requests embedded />}
      {tab === 'journal' && <Journal embedded />}
      {tab === 'purchase' && <Purchase embedded />}
    </div>
  )
}
