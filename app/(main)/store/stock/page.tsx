'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Warehouse, Store, History, Tags, Loader2 } from 'lucide-react'

const fallback = () => <div className="app-page-wide flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>

const WarehouseTab = dynamic(() => import('@/app/(main)/store/warehouse/page'), { ssr: false, loading: fallback })
const Showcase = dynamic(() => import('@/app/(main)/store/showcase/page'), { ssr: false, loading: fallback })
const Movements = dynamic(() => import('@/app/(main)/store/movements/page'), { ssr: false, loading: fallback })
const Catalog = dynamic(() => import('@/app/(main)/inventory/catalog/page').then((m) => m.CatalogPageContent), { ssr: false, loading: fallback })

type Tab = 'warehouse' | 'showcase' | 'movements' | 'catalog'
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'warehouse', label: 'Склад', icon: Warehouse },
  { key: 'showcase', label: 'Витрина', icon: Store },
  { key: 'movements', label: 'Движения', icon: History },
  { key: 'catalog', label: 'Каталог', icon: Tags },
]

export default function StoreStockPage() {
  const [tab, setTab] = useState<Tab>('warehouse')

  return (
    <div className="app-page-wide space-y-4">
      <AdminPageHeader
        title="Склад"
        description="Склад, витрина, движения и каталог"
        icon={<Warehouse className="h-5 w-5" />}
        accent="emerald"
        backHref="/store"
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-slate-950/50 p-1">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${tab === key ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10' : 'text-slate-400 hover:text-white'}`}
              >
                <Icon className={`h-4 w-4 ${tab === key ? 'text-emerald-300' : ''}`} />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'warehouse' && <WarehouseTab embedded />}
      {tab === 'showcase' && <Showcase embedded />}
      {tab === 'movements' && <Movements embedded />}
      {tab === 'catalog' && <Catalog embedded />}
    </div>
  )
}
