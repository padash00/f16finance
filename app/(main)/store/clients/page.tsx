'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Users2, Tags, Loader2 } from 'lucide-react'

const fallback = () => <div className="app-page-wide flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>

const Customers = dynamic(() => import('@/app/(main)/customers/page'), { ssr: false, loading: fallback })
const Discounts = dynamic(() => import('@/app/(main)/discounts/page'), { ssr: false, loading: fallback })

type Tab = 'customers' | 'discounts'
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'customers', label: 'Клиенты', icon: Users2 },
  { key: 'discounts', label: 'Скидки и промокоды', icon: Tags },
]

export default function StoreClientsPage() {
  const [tab, setTab] = useState<Tab>('customers')

  return (
    <div className="app-page-wide space-y-4">
      <AdminPageHeader
        title="Клиенты"
        description="Клиенты, лояльность, скидки и промокоды"
        icon={<Users2 className="h-5 w-5" />}
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
                <Icon className={`h-4 w-4 ${tab === key ? 'text-emerald-600 dark:text-emerald-300' : ''}`} />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'customers' && <Customers embedded />}
      {tab === 'discounts' && <Discounts embedded />}
    </div>
  )
}
