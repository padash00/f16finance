'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { FileText, PackagePlus, Upload, ArchiveX, ScanSearch, CalendarClock } from 'lucide-react'
import { PageSkeleton } from '@/components/skeleton'

const fallback = () => <div className="app-page-wide py-4"><PageSkeleton stats={3} rows={8} cols={7} /></div>

const Receipts = dynamic(() => import('@/app/(main)/store/receipts/page'), { ssr: false, loading: fallback })
const Postings = dynamic(() => import('@/app/(main)/store/postings/page'), { ssr: false, loading: fallback })
const Writeoffs = dynamic(() => import('@/app/(main)/store/writeoffs/page'), { ssr: false, loading: fallback })
const Revisions = dynamic(() => import('@/app/(main)/store/revisions/page'), { ssr: false, loading: fallback })
const Expiry = dynamic(() => import('@/app/(main)/store/expiry/page'), { ssr: false, loading: fallback })

type Tab = 'receipts' | 'postings' | 'writeoffs' | 'revisions' | 'expiry'
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'receipts', label: 'Приёмка', icon: PackagePlus },
  { key: 'postings', label: 'Оприходование', icon: Upload },
  { key: 'writeoffs', label: 'Списания', icon: ArchiveX },
  { key: 'revisions', label: 'Ревизия', icon: ScanSearch },
  { key: 'expiry', label: 'Срок годности', icon: CalendarClock },
]

export default function StoreDocumentsPage() {
  const [tab, setTab] = useState<Tab>('receipts')

  return (
    <div className="app-page-wide space-y-4">
      <AdminPageHeader
        title="Документы"
        description="Приёмка, оприходование, списания и ревизия — в одном месте"
        icon={<FileText className="h-5 w-5" />}
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
                <Icon className={`h-4 w-4 ${tab === key ? 'text-emerald-700 dark:text-emerald-300' : ''}`} />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'receipts' && <Receipts embedded />}
      {tab === 'postings' && <Postings embedded />}
      {tab === 'writeoffs' && <Writeoffs embedded />}
      {tab === 'revisions' && <Revisions embedded />}
      {tab === 'expiry' && <Expiry embedded />}
    </div>
  )
}
