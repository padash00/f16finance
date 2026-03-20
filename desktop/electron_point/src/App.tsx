import { useState, useEffect } from 'react'
import { loadConfig, saveConfig, DEFAULT_API_URL } from '@/lib/config'
import { getCachedBootstrap, saveBootstrapCache } from '@/lib/cache'
import * as api from '@/lib/api'
import LoginPage from '@/pages/LoginPage'
import PointSelectPage from '@/pages/PointSelectPage'
import ShiftPage from '@/pages/ShiftPage'
import ScannerPage from '@/pages/ScannerPage'
import AdminLayout from '@/pages/admin/AdminLayout'
import type { AppConfig, AppView, CompanyOption, OperatorSession, AdminSession, BootstrapData } from '@/types'

// Типизируем window.electron (из preload.cjs)
declare global {
  interface Window {
    electron: {
      config: {
        get: () => Promise<Record<string, unknown>>
        set: (config: Record<string, unknown>) => Promise<{ ok: boolean }>
      }
      queue: {
        add: (data: { type: string; payload: unknown; localRef?: string }) => Promise<{ id: number }>
        list: (opts?: { status?: string }) => Promise<unknown[]>
        update: (data: { id: number; status: string; error?: string }) => Promise<{ ok: boolean }>
        done: (data: { id: number }) => Promise<{ ok: boolean }>
        count: () => Promise<number>
      }
      cache: {
        get: () => Promise<Record<string, unknown>>
        set: (data: Record<string, unknown>) => Promise<{ ok: boolean }>
      }
      dialog: {
        openFile: (opts?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
      }
      file: {
        readBuffer: (path: string) => Promise<Buffer>
      }
      app: {
        version: () => Promise<string>
      }
      shell: {
        openExternal: (url: string) => Promise<void>
      }
    }
  }
}

export default function App() {
  const [view, setView] = useState<AppView>({ screen: 'booting' })
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    const cfg = await loadConfig()
    // Всегда показываем Login — настройка токена доступна внутри Login через диалог
    setConfig(cfg)
    await showLogin(cfg)
  }

  async function showLogin(cfg: AppConfig | null) {
    if (!cfg) {
      setIsOffline(false)
      setView({ screen: 'login', bootstrap: emptyBootstrap() })
      return
    }

    setView({ screen: 'booting' })
    try {
      const bootstrap = await api.bootstrap(cfg)
      await saveBootstrapCache(bootstrap)
      setIsOffline(false)
      setView({ screen: 'login', bootstrap })
    } catch {
      // Нет сети — пробуем кеш
      const cached = await getCachedBootstrap()
      setIsOffline(true)
      setView({ screen: 'login', bootstrap: cached ?? emptyBootstrap() })
    }
  }

  function emptyBootstrap(): BootstrapData {
    return {
      device: {
        id: '',
        name: 'Не настроено',
        point_mode: 'unknown',
        feature_flags: { shift_report: true, income_report: true, debt_report: false },
      },
      company: { id: '', name: '', code: null },
      operators: [],
    }
  }

  // ─── Сохранение токена из диалога настройки ────────────────────────────────
  async function handleSaveConfig(newConfig: AppConfig) {
    await saveConfig(newConfig)
    setConfig(newConfig)
    await showLogin(newConfig)
  }

  // ─── Переход к рабочему экрану после выбора точки ─────────────────────────
  function proceedToApp(session: OperatorSession) {
    const bootstrap = session.bootstrap
    const flags = bootstrap.device.feature_flags

    if (flags.debt_report) {
      setView({ screen: 'scanner', bootstrap, session })
    } else {
      setView({ screen: 'shift', bootstrap, session })
    }
  }

  // ─── Вход оператора ────────────────────────────────────────────────────────
  function handleOperatorLogin(session: OperatorSession, allCompanies: CompanyOption[]) {
    if (allCompanies.length > 1) {
      setView({ screen: 'point-select', bootstrap: session.bootstrap, session, allCompanies })
    } else {
      proceedToApp(session)
    }
  }

  // ─── Выбор точки (при нескольких компаниях) ────────────────────────────────
  function handlePointSelect(company: CompanyOption) {
    if (view.screen !== 'point-select') return
    const session: OperatorSession = {
      ...view.session,
      company: { id: company.id, name: company.name, code: company.code },
      operator: { ...view.session.operator, role_in_company: company.role_in_company },
    }
    proceedToApp(session)
  }

  // ─── Вход администратора ───────────────────────────────────────────────────
  function handleAdminLogin(session: AdminSession) {
    const bootstrap = view.screen === 'login' ? view.bootstrap : undefined
    setView({ screen: 'admin', session, bootstrap })
  }

  // ─── Выход ────────────────────────────────────────────────────────────────
  function handleLogout() {
    showLogin(config)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (view.screen === 'booting') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <div className="h-9 drag-region absolute inset-x-0 top-0" />
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary">
          <span className="text-xl font-bold text-primary-foreground">F</span>
        </div>
        <span className="animate-spin h-5 w-5 border-2 border-border border-t-foreground rounded-full" />
        <p className="text-xs text-muted-foreground">Подключение...</p>
      </div>
    )
  }

  if (view.screen === 'login') {
    return (
      <LoginPage
        config={config}
        bootstrap={view.bootstrap}
        isOffline={isOffline}
        onOperatorLogin={handleOperatorLogin}
        onAdminLogin={handleAdminLogin}
        onSaveConfig={handleSaveConfig}
      />
    )
  }

  if (view.screen === 'point-select') {
    return (
      <PointSelectPage
        session={view.session}
        allCompanies={view.allCompanies}
        onSelect={handlePointSelect}
        onLogout={handleLogout}
      />
    )
  }

  if (view.screen === 'shift') {
    const flags = view.bootstrap.device.feature_flags
    return (
      <ShiftPage
        config={config!}
        bootstrap={view.bootstrap}
        session={view.session}
        isOffline={isOffline}
        onLogout={handleLogout}
        onSwitchToScanner={flags.debt_report ? () => setView({ ...view, screen: 'scanner' }) : undefined}
      />
    )
  }

  if (view.screen === 'scanner') {
    return (
      <ScannerPage
        config={config!}
        bootstrap={view.bootstrap}
        session={view.session}
        isOffline={isOffline}
        onLogout={handleLogout}
        onSwitchToShift={() => setView({ ...view, screen: 'shift' })}
      />
    )
  }

  if (view.screen === 'admin') {
    return (
      <AdminLayout
        config={config!}
        session={view.session}
        bootstrap={view.bootstrap}
        onLogout={handleLogout}
      />
    )
  }

  return null
}
