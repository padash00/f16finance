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
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="drag-region flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-card px-5">
        <div className="no-drag flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">F</span>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-none">Глобальный администратор</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{session.email}</span>
              {bootstrap?.device?.name ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">
                  Текущий терминал подключён
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="no-drag flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={doSync} disabled={syncing} className="text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r bg-sidebar px-2 py-3">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'no-drag flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
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
