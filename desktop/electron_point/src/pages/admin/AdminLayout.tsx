import { useState } from 'react'
import { ReceiptText, Package, CreditCard, Settings, LogOut, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { syncQueue } from '@/lib/offline'
import { toastSuccess, toastError } from '@/lib/toast'
import ShiftHistoryPage from './ShiftHistoryPage'
import DebtHistoryPage from './DebtHistoryPage'
import ProductsPage from './ProductsPage'
import DevicesPage from './DevicesPage'
import type { AppConfig, BootstrapData, AdminSession } from '@/types'

interface Props {
  config: AppConfig
  session: AdminSession
  bootstrap?: BootstrapData
  onLogout: () => void
}

type Tab = 'shifts' | 'debts' | 'products' | 'devices'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'shifts', label: 'Смены', icon: ReceiptText },
  { id: 'debts', label: 'Долги', icon: CreditCard },
  { id: 'products', label: 'Товары', icon: Package },
  { id: 'devices', label: 'Устройства', icon: Settings },
]

export default function AdminLayout({ config, session, bootstrap, onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('shifts')
  const [syncing, setSyncing] = useState(false)

  async function doSync() {
    setSyncing(true)
    try {
      const { synced, failed } = await syncQueue(config)
      if (synced > 0) toastSuccess(`Синхронизировано: ${synced} ${synced === 1 ? 'запись' : 'записей'}`)
      if (failed > 0) toastError(`Не удалось синхронизировать: ${failed}`)
      if (synced === 0 && failed === 0) toastSuccess('Очередь пустая')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="drag-region flex h-14 items-center justify-between border-b bg-card px-5 gap-4 shrink-0">
        <div className="flex items-center gap-3 no-drag">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">F</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Суперадминистратор</p>
            <p className="text-xs text-muted-foreground">
              {session.email}
              {bootstrap?.company.name ? ` · ${bootstrap.company.name}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-drag">
          <Button variant="ghost" size="sm" onClick={doSync} disabled={syncing} className="text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-48 shrink-0 border-r bg-sidebar flex flex-col py-3 gap-1 px-2">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left cursor-pointer no-drag',
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

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {activeTab === 'shifts' && <ShiftHistoryPage config={config} session={session} bootstrap={bootstrap} />}
          {activeTab === 'debts' && <DebtHistoryPage config={config} session={session} bootstrap={bootstrap} />}
          {activeTab === 'products' && <ProductsPage config={config} session={session} bootstrap={bootstrap} />}
          {activeTab === 'devices' && <DevicesPage config={config} session={session} />}
        </main>
      </div>
    </div>
  )
}
