'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Receipt, RotateCcw, Clapperboard } from 'lucide-react'
import { PageSkeleton } from '@/components/skeleton'

const fallback = () => <div className="app-page-wide py-4"><PageSkeleton stats={3} rows={8} cols={6} /></div>

const Receipts = dynamic(() => import('@/app/(main)/pos-receipts/page'), { ssr: false, loading: fallback })
const Returns = dynamic(() => import('@/app/(main)/pos-returns/page'), { ssr: false, loading: fallback })
const Advertising = dynamic(() => import('@/app/(main)/store/advertising/page'), { ssr: false, loading: fallback })

type Tab = 'receipts' | 'returns' | 'advertising'
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'receipts', label: 'История чеков', icon: Receipt },
  { key: 'returns', label: 'Возврат товара', icon: RotateCcw },
  { key: 'advertising', label: 'Реклама', icon: Clapperboard },
]

export default function StoreCashboxPage() {
  const [tab, setTab] = useState<Tab>('receipts')

  return (
    <div className="app-page-wide space-y-4">
      <AdminPageHeader
        title="Касса"
        description="Чеки, возвраты и реклама на экране клиента"
        icon={<Receipt className="h-5 w-5" />}
        accent="emerald"
        backHref="/store"
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-border bg-white dark:bg-slate-950/50 p-1">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all sm:px-4 ${tab === key ? 'bg-surface-hover text-foreground shadow-sm ring-1 ring-slate-200 dark:ring-white/10' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'}`}
              >
                <Icon className={`h-4 w-4 ${tab === key ? 'text-emerald-600 dark:text-emerald-300' : ''}`} />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'receipts' && <Receipts embedded />}
      {tab === 'returns' && <Returns embedded />}
      {tab === 'advertising' && <Advertising embedded />}
    </div>
  )
}
