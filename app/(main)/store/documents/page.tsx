'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { FileText, PackagePlus, Upload, ArchiveX, ScanSearch, Loader2 } from 'lucide-react'

const fallback = () => <div className="app-page-wide flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>

const Receipts = dynamic(() => import('@/app/(main)/store/receipts/page'), { ssr: false, loading: fallback })
const Postings = dynamic(() => import('@/app/(main)/store/postings/page'), { ssr: false, loading: fallback })
const Writeoffs = dynamic(() => import('@/app/(main)/store/writeoffs/page'), { ssr: false, loading: fallback })
const Revisions = dynamic(() => import('@/app/(main)/store/revisions/page'), { ssr: false, loading: fallback })

type Tab = 'receipts' | 'postings' | 'writeoffs' | 'revisions'
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'receipts', label: 'Приёмка', icon: PackagePlus },
  { key: 'postings', label: 'Оприходование', icon: Upload },
  { key: 'writeoffs', label: 'Списания', icon: ArchiveX },
  { key: 'revisions', label: 'Ревизия', icon: ScanSearch },
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

      {tab === 'receipts' && <Receipts embedded />}
      {tab === 'postings' && <Postings embedded />}
      {tab === 'writeoffs' && <Writeoffs embedded />}
      {tab === 'revisions' && <Revisions embedded />}
    </div>
  )
}
