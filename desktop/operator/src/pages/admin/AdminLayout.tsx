import { useState } from 'react'
import { ReceiptText, CreditCard, Settings, LogOut, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { syncQueue } from '@/lib/offline'
import { toastSuccess, toastError } from '@/lib/toast'
import ShiftHistoryPage from './ShiftHistoryPage'
import DebtHistoryPage from './DebtHistoryPage'
import DevicesPage from './DevicesPage'
import type { AppConfig, BootstrapData, AdminSession } from '@/types'

interface Props {
  config: AppConfig
  session: AdminSession
  bootstrap?: BootstrapData
  onLogout: () => void
}

type Tab = 'shifts' | 'debts' | 'devices'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'shifts', label: 'Смены', icon: ReceiptText },
  { id: 'debts', label: 'Долги', icon: CreditCard },
  { id: 'devices', label: 'Устройства', icon: Settings },
]

export default function AdminLayout({ config, session, bootstrap, onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('shifts')
  const [syncing, setSyncing] = useState(false)

  async function doSync() {
    setSyncing(true)
    try {
      const { synced, failed } = await syncQueue(config)
      if (synced > 0) toastSuccess(`Синхронизировано: ${synced}`)
      if (failed > 0) toastError(`Не удалось синхронизировать: ${failed}`)
      if (synced === 0 && failed === 0) toastSuccess('Очередь пустая')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-500/10" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-blue-500/5 blur-3xl dark:bg-blue-500/10" />
      <header className="drag-region relative z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/80 px-5 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/80">
        <div className="no-drag flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-[11px] font-bold tracking-tight text-white shadow-md shadow-emerald-500/30">
            OP
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-none">Глобальный администратор</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{session.email}</span>
              {bootstrap?.device?.name ? (
                <span className="rounded-full border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px]">
                  Текущий терминал подключён
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="no-drag flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={doSync} disabled={syncing} className="text-slate-500 dark:text-slate-400">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-500 dark:text-slate-400">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r bg-white/60 dark:bg-slate-900/60 px-2 py-3">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'no-drag flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-all',
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-emerald-500/15 to-teal-500/15 border border-emerald-500/30 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-sidebar-foreground hover:bg-white/5 hover:text-slate-900 dark:text-slate-100',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {tab.label}
              </button>
            )
          })}
        </nav>

        <main className="flex-1 overflow-auto">
          {activeTab === 'shifts' && <ShiftHistoryPage config={config} session={session} bootstrap={bootstrap} />}
          {activeTab === 'debts' && <DebtHistoryPage config={config} session={session} bootstrap={bootstrap} />}
          {activeTab === 'devices' && <DevicesPage config={config} session={session} />}
        </main>
      </div>
    </div>
  )
}
