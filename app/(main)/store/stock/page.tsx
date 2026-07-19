'use client'

import { usePersistentState } from '@/lib/client/use-persistent-state'
import dynamic from 'next/dynamic'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Warehouse, Store, History, Tags } from 'lucide-react'
import { PageSkeleton } from '@/components/skeleton'

const fallback = () => <PageSkeleton stats={0} rows={8} cols={5} />

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
  const [tab, setTab] = usePersistentState<Tab>('store.stock.tab', 'warehouse')

  return (
    <div className="app-page-wide space-y-4">
      <AdminPageHeader
        title="Склад"
        description="Склад, витрина, движения и каталог"
        icon={<Warehouse className="h-5 w-5" />}
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

      {tab === 'warehouse' && <WarehouseTab embedded />}
      {tab === 'showcase' && <Showcase embedded />}
      {tab === 'movements' && <Movements embedded />}
      {tab === 'catalog' && <Catalog embedded />}
    </div>
  )
}
