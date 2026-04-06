import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { loadConfig, saveConfig } from '@/lib/config'
import { getCachedBootstrap, saveBootstrapCache, saveOperatorSession, loadOperatorSession, clearOperatorSession } from '@/lib/cache'
import * as api from '@/lib/api'
import { toastInfo } from '@/lib/toast'
import type { AppConfig, AppView, CompanyOption, OperatorSession, AdminSession, BootstrapData, AppUpdateState } from '@/types'

const LoginPage = lazy(() => import('@/pages/LoginPage'))
const PointSelectPage = lazy(() => import('@/pages/PointSelectPage'))
const ShiftPage = lazy(() => import('@/pages/ShiftPage'))
const InventorySalesPage = lazy(() => import('@/pages/InventorySalesPage'))
const InventoryReturnsPage = lazy(() => import('@/pages/InventoryReturnsPage'))
const ScannerPage = lazy(() => import('@/pages/ScannerPage'))
const InventoryRequestPage = lazy(() => import('@/pages/InventoryRequestPage'))
const OperatorCabinetPage = lazy(() => import('@/pages/OperatorCabinetPage'))
const ArenaPage = lazy(() => import('@/pages/ArenaPage'))
const SetupPage = lazy(() => import('@/pages/SetupPage'))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))

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
      updater: {
        getState: () => Promise<AppUpdateState>
        check: () => Promise<AppUpdateState>
        download: () => Promise<AppUpdateState>
        install: () => Promise<{ ok: boolean; error?: string }>
        openReleases: () => Promise<{ ok: boolean }>
        onStateChange: (callback: (state: AppUpdateState) => void) => () => void
      }
      shell: {
        openExternal: (url: string) => Promise<void>
      }
    }
  }
}

function canUseArena(bootstrap: BootstrapData) {
  return bootstrap.device.feature_flags?.arena_enabled === true
}

function canUseArenaForSession(session: OperatorSession) {
  return canUseArena(session.bootstrap)
}

function canUseScanner(bootstrap: BootstrapData) {
  const flags = bootstrap.device.feature_flags
  const pointMode = String(bootstrap.device.point_mode || '').trim().toLowerCase()
  const scannerModes = new Set(['cash-desk', 'universal', 'debts'])
  return flags.debt_report === true && scannerModes.has(pointMode)
}

function canUseInventoryRequests(bootstrap: BootstrapData) {
  const pointMode = String(bootstrap.device.point_mode || '').trim().toLowerCase()
  return new Set(['cash-desk', 'universal', 'debts']).has(pointMode)
}

function canUseInventorySales(bootstrap: BootstrapData) {
  const pointMode = String(bootstrap.device.point_mode || '').trim().toLowerCase()
  return new Set(['cash-desk', 'universal', 'debts']).has(pointMode)
}

function isOperatorAttachedToCurrentPoint(session: OperatorSession, bootstrap: BootstrapData) {
  // In project mode: check if selected company is one of the project's companies
  if (bootstrap.companies && bootstrap.companies.length > 0) {
    return bootstrap.companies.some((c) => c.id === session.company.id)
  }
  return session.company.id === bootstrap.company.id
}

function canUseScannerForSession(session: OperatorSession) {
  return canUseScanner(session.bootstrap) && isOperatorAttachedToCurrentPoint(session, session.bootstrap)
}

function canUseInventoryRequestsForSession(session: OperatorSession) {
  return canUseInventoryRequests(session.bootstrap) && isOperatorAttachedToCurrentPoint(session, session.bootstrap)
}

function canUseInventorySalesForSession(session: OperatorSession) {
  return canUseInventorySales(session.bootstrap) && isOperatorAttachedToCurrentPoint(session, session.bootstrap)
}

function getActiveOperatorSession(view: AppView): OperatorSession | null {
  if (
    view.screen === 'shift' ||
    view.screen === 'inventory-sale' ||
    view.screen === 'inventory-return' ||
    view.screen === 'scanner' ||
    view.screen === 'inventory-request' ||
    view.screen === 'arena' ||
    view.screen === 'operator-cabinet'
  ) {
    return view.session
  }
  return null
}

function isTaskOpen(status: string) {
  return !['done', 'archived'].includes(status)
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function UpdateBanner({
  state,
  onCheck,
  onDownload,
  onInstall,
  onOpenReleases,
}: {
  state: AppUpdateState | null
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
  onOpenReleases: () => void
}) {
  if (!state || state.status === 'development' || state.status === 'idle') return null

  const progressPercent = Math.max(0, Math.min(100, Math.round(state.progress?.percent || 0)))

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] w-[min(92vw,380px)]">
      <div className="pointer-events-auto rounded-3xl border border-white/10 bg-black/90 p-4 shadow-2xl backdrop-blur-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Обновление Orda Point</p>
            <p className="mt-1 text-xs text-white/65">
              Текущая версия {state.currentVersion}
              {state.latestVersion ? ` · новая ${state.latestVersion}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenReleases}
            className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-white/75 transition hover:border-white/20 hover:text-white"
          >
            Релизы
          </button>
        </div>

        {state.status === 'checking' && (
          <p className="text-sm text-white/80">Проверяем, вышла ли новая версия...</p>
        )}

        {state.status === 'available' && (
          <>
            <p className="text-sm text-white/85">
              Доступна новая версия. Программа может сама скачать обновление и предложить установку.
            </p>
            {state.releaseNotes && (
              <p className="mt-2 line-clamp-3 text-xs text-white/55">{state.releaseNotes}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onDownload}
                className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                Скачать обновление
              </button>
              <button
                type="button"
                onClick={onCheck}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/20 hover:text-white"
              >
                Проверить ещё раз
              </button>
            </div>
          </>
        )}

        {state.status === 'downloading' && (
          <>
            <p className="text-sm text-white/85">Скачиваем новую версию...</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-white/60">
              <span>{progressPercent}%</span>
              <span>
                {formatBytes(state.progress?.transferred || 0)} / {formatBytes(state.progress?.total || 0)}
              </span>
            </div>
          </>
        )}

        {state.status === 'downloaded' && (
          <>
            <p className="text-sm text-white/85">
              Обновление скачано. Осталось перезапустить программу, и новая версия установится автоматически.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onInstall}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                Перезапустить и обновить
              </button>
              <button
                type="button"
                onClick={onOpenReleases}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/20 hover:text-white"
              >
                Что нового
              </button>
            </div>
          </>
        )}

        {state.status === 'installing' && (
          <p className="text-sm text-white/85">Закрываем программу и устанавливаем обновление...</p>
        )}

        {state.status === 'error' && (
          <>
            <p className="text-sm text-rose-300">{state.error || 'Не удалось обновить приложение.'}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onCheck}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                Повторить
              </button>
              <button
                type="button"
                onClick={onOpenReleases}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/20 hover:text-white"
              >
                Открыть релизы
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<AppView>({ screen: 'booting' })
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null)
  const seenTaskIdsRef = useRef<Set<string> | null>(null)
  const latestViewRef = useRef<AppView>({ screen: 'booting' })
  const bootstrapNonce = useRef(0)

  useEffect(() => {
    latestViewRef.current = view
  }, [view])

  // Auto-logout when API returns 401 (session expired)
  useEffect(() => {
    async function handleUnauthorized() {
      const current = latestViewRef.current
      const isInApp = current.screen !== 'booting' && current.screen !== 'setup' && current.screen !== 'login'
      if (isInApp) {
        await clearOperatorSession().catch(() => null)
        showLogin(config)
      }
    }
    window.addEventListener('orda:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('orda:unauthorized', handleUnauthorized)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  useEffect(() => { init() }, [])

  useEffect(() => {
    let unsubscribe = () => {}

    async function initUpdater() {
      try {
        const state = await window.electron.updater.getState()
        setUpdateState(state)
      } catch {
        // ignore initial updater read errors
      }

      unsubscribe = window.electron.updater.onStateChange((state) => {
        setUpdateState(state)
      })
    }

    void initUpdater()

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const session = getActiveOperatorSession(view)
    if (!config || !session) {
      seenTaskIdsRef.current = null
      return
    }

    let cancelled = false

    async function pollTasks() {
      try {
        const payload = await api.getPointOperatorTasks(config, session)
        if (cancelled) return

        const activeTasks = (payload.tasks || []).filter((task) => isTaskOpen(task.status))
        const currentIds = new Set(activeTasks.map((task) => String(task.id)))

        if (seenTaskIdsRef.current === null) {
          seenTaskIdsRef.current = currentIds
          return
        }

        const newTasks = activeTasks.filter((task) => !seenTaskIdsRef.current?.has(String(task.id)))
        seenTaskIdsRef.current = currentIds

        if (newTasks.length === 0) return

        const message =
          newTasks.length === 1
            ? `Новая задача: ${newTasks[0].title}`
            : `Новых задач: ${newTasks.length}`

        toastInfo(message, 7000)

        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'default') {
            Notification.requestPermission().catch(() => null)
          }

          if (Notification.permission === 'granted') {
            const notification = new Notification('Orda Point', {
              body: message,
            })
            notification.onclick = () => {
              const currentView = latestViewRef.current
              if (
                currentView.screen === 'shift' ||
                currentView.screen === 'inventory-sale' ||
                currentView.screen === 'inventory-return' ||
                currentView.screen === 'scanner' ||
                currentView.screen === 'inventory-request' ||
                currentView.screen === 'operator-cabinet'
              ) {
                setView({
                  screen: 'operator-cabinet',
                  bootstrap: currentView.bootstrap,
                  session: currentView.session,
                  returnTo:
                    currentView.screen === 'scanner'
                      ? 'scanner'
                      : currentView.screen === 'inventory-return'
                        ? 'return'
                      : currentView.screen === 'inventory-sale'
                        ? 'sale'
                        : 'shift',
                })
              }
            }
          }
        }
      } catch {
        // silently ignore polling errors; cabinet/tasks screen shows explicit errors on demand
      }
    }

    void pollTasks()
    const interval = window.setInterval(() => {
      void pollTasks()
    }, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [config, view])

  async function init() {
    const cfg = await loadConfig()
    setConfig(cfg)
    await showLogin(cfg)
  }

  async function showLogin(cfg: AppConfig | null) {
    if (!cfg) {
      setIsOffline(false)
      setView({ screen: 'setup' })
      return
    }

    setView({ screen: 'booting' })
    try {
      // Сначала сессия: bootstrap без x-point-company-id даёт режим первой компании проекта,
      // из‑за этого UI «чужой точки» при мульти-точке, пока API отвечает по выбранной компании.
      const cachedSession = await loadOperatorSession()
      const bootstrap = await api.bootstrap(cfg, cachedSession?.company?.id)
      saveBootstrapCache(bootstrap).catch(() => null) // fire and forget
      setIsOffline(false)

      if (cachedSession) {
        const session: typeof cachedSession = { ...cachedSession, bootstrap }
        setView(canUseScannerForSession(session)
          ? { screen: 'scanner', bootstrap, session }
          : { screen: 'shift', bootstrap, session })
        return
      }

      setView({ screen: 'login', bootstrap })
    } catch {
      const [cached] = await Promise.allSettled([getCachedBootstrap()])
      const cachedBootstrap = cached.status === 'fulfilled' ? cached.value : null
      setIsOffline(true)
      setView(cachedBootstrap ? { screen: 'login', bootstrap: cachedBootstrap } : { screen: 'setup' })
    }
  }

  function emptyBootstrap(): BootstrapData {
    return {
      device: {
        id: '',
        name: 'Не настроено',
        point_mode: 'unknown',
        feature_flags: {
          shift_report: true,
          income_report: true,
          debt_report: false,
          kaspi_daily_split: false,
          start_cash_prompt: false,
          arena_enabled: false,
          arena_shift_auto_totals: false,
        },
      },
      company: { id: '', name: '', code: null },
      companies: [],
      operators: [],
    }
  }

  // ─── Сохранение токена из диалога настройки ────────────────────────────────
  async function handleSaveConfig(newConfig: AppConfig) {
    await saveConfig(newConfig)
    setConfig(newConfig)
    await showLogin(newConfig)
  }

  function handleOpenSetup() {
    setView({ screen: 'setup' })
  }

  // ─── Переход к рабочему экрану после выбора точки ─────────────────────────
  async function proceedToApp(session: OperatorSession) {
    // Re-fetch bootstrap with the selected company so per-company point_mode
    // and feature_flags overrides are applied correctly
    let bootstrap = session.bootstrap
    if (config && session.company.id) {
      const nonce = ++bootstrapNonce.current
      try {
        const freshBootstrap = await api.bootstrap(config, session.company.id)
        // Ignore stale responses if another proceedToApp call started after this one
        if (nonce !== bootstrapNonce.current) return
        bootstrap = freshBootstrap
        await saveBootstrapCache(bootstrap)
      } catch {
        // fallback to existing bootstrap on error (e.g. offline)
      }
    }
    const updatedSession = { ...session, bootstrap }
    saveOperatorSession(updatedSession).catch(() => null)

    if (canUseScannerForSession(updatedSession)) {
      setView({ screen: 'scanner', bootstrap, session: updatedSession })
    } else {
      setView({ screen: 'shift', bootstrap, session: updatedSession })
    }
  }

  // ─── Вход оператора ────────────────────────────────────────────────────────
  async function prefetchBootstrapForDefaultCompany(session: OperatorSession): Promise<BootstrapData> {
    if (!config || !session.company.id) return session.bootstrap
    try {
      const b = await api.bootstrap(config, session.company.id)
      await saveBootstrapCache(b)
      return b
    } catch {
      return session.bootstrap
    }
  }

  function handleOperatorLogin(session: OperatorSession, allCompanies: CompanyOption[]) {
    if (allCompanies.length > 1) {
      void (async () => {
        const bootstrap = await prefetchBootstrapForDefaultCompany(session)
        setView({
          screen: 'point-select',
          bootstrap,
          session: { ...session, bootstrap },
          allCompanies,
        })
      })()
      return
    }
    void proceedToApp(session)
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
  async function handleLogout() {
    await clearOperatorSession().catch(() => null)
    showLogin(config)
  }

  async function handleAdminLogout() {
    if (view.screen === 'admin' && config) {
      await api.logoutAdmin(config, view.session.token).catch(() => null)
    }
    showLogin(config)
  }

  async function handleCheckForUpdates() {
    try {
      const state = await window.electron.updater.check()
      setUpdateState(state)
      if (state.status === 'idle') {
        toastInfo('Новых обновлений пока нет.', 4000)
      }
    } catch {
      toastInfo('Не удалось проверить обновления.', 5000)
    }
  }

  async function handleDownloadUpdate() {
    try {
      const state = await window.electron.updater.download()
      setUpdateState(state)
    } catch {
      toastInfo('Не удалось скачать обновление.', 5000)
    }
  }

  async function handleInstallUpdate() {
    try {
      const result = await window.electron.updater.install()
      if (!result.ok) {
        toastInfo(result.error || 'Обновление ещё не готово к установке.', 5000)
      }
    } catch {
      toastInfo('Не удалось запустить установку обновления.', 5000)
    }
  }

  function handleOpenReleases() {
    window.electron.updater.openReleases().catch(() => null)
  }

  function handleOpenOperatorCabinet(returnTo: 'shift' | 'sale' | 'return' | 'scanner') {
    if (
      view.screen !== 'shift' &&
      view.screen !== 'inventory-sale' &&
      view.screen !== 'inventory-return' &&
      view.screen !== 'scanner'
    ) return
    setView({ screen: 'operator-cabinet', bootstrap: view.bootstrap, session: view.session, returnTo })
  }

  function withUpdateBanner(content: ReactNode) {
    return (
      <>
        <Suspense fallback={null}>{content}</Suspense>
        <UpdateBanner
          state={updateState}
          onCheck={handleCheckForUpdates}
          onDownload={handleDownloadUpdate}
          onInstall={handleInstallUpdate}
          onOpenReleases={handleOpenReleases}
        />
      </>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (view.screen === 'booting') {
    return withUpdateBanner(
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <div className="h-9 drag-region absolute inset-x-0 top-0" />
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary">
          <span className="text-xl font-bold text-primary-foreground">F</span>
        </div>
        <span className="animate-spin h-5 w-5 border-2 border-border border-t-foreground rounded-full" />
        <p className="text-xs text-muted-foreground">Подключение...</p>
      </div>,
    )
  }

  if (view.screen === 'setup') {
    return withUpdateBanner(
      <SetupPage
        initialConfig={config}
        onDone={handleSaveConfig}
        onCancel={config ? () => showLogin(config) : undefined}
      />,
    )
  }

  if (view.screen === 'login') {
    return withUpdateBanner(
      <LoginPage
        config={config!}
        bootstrap={view.bootstrap}
        isOffline={isOffline}
        onOperatorLogin={handleOperatorLogin}
        onAdminLogin={handleAdminLogin}
        onOpenSetup={handleOpenSetup}
      />,
    )
  }

  if (view.screen === 'point-select') {
    return withUpdateBanner(
      <PointSelectPage
        session={view.session}
        allCompanies={view.allCompanies}
        onSelect={handlePointSelect}
        onLogout={handleLogout}
      />,
    )
  }

  if (view.screen === 'shift') {
    return withUpdateBanner(
      <ShiftPage
        config={config!}
        bootstrap={view.bootstrap}
        session={view.session}
        isOffline={isOffline}
        onLogout={handleLogout}
        onSwitchToSale={canUseInventorySalesForSession(view.session) ? () => setView({ ...view, screen: 'inventory-sale' }) : undefined}
        onSwitchToReturn={canUseInventorySalesForSession(view.session) ? () => setView({ ...view, screen: 'inventory-return' }) : undefined}
        onSwitchToScanner={canUseScannerForSession(view.session) ? () => setView({ ...view, screen: 'scanner' }) : undefined}
        onSwitchToRequest={canUseInventoryRequestsForSession(view.session) ? () => setView({ ...view, screen: 'inventory-request' }) : undefined}
        onSwitchToArena={canUseArenaForSession(view.session) ? () => setView({ ...view, screen: 'arena' }) : undefined}
        onOpenCabinet={() => handleOpenOperatorCabinet('shift')}
      />,
    )
  }

  if (view.screen === 'inventory-sale') {
    return withUpdateBanner(
      <InventorySalesPage
        config={config!}
        bootstrap={view.bootstrap}
        session={view.session}
        onLogout={handleLogout}
        onSwitchToShift={() => setView({ ...view, screen: 'shift' })}
        onSwitchToReturn={() => setView({ ...view, screen: 'inventory-return' })}
        onSwitchToScanner={canUseScannerForSession(view.session) ? () => setView({ ...view, screen: 'scanner' }) : undefined}
        onSwitchToRequest={canUseInventoryRequestsForSession(view.session) ? () => setView({ ...view, screen: 'inventory-request' }) : undefined}
        onOpenCabinet={() => handleOpenOperatorCabinet('sale')}
      />,
    )
  }

  if (view.screen === 'inventory-return') {
    return withUpdateBanner(
      <InventoryReturnsPage
        config={config!}
        bootstrap={view.bootstrap}
        session={view.session}
        onLogout={handleLogout}
        onSwitchToShift={() => setView({ ...view, screen: 'shift' })}
        onSwitchToSale={() => setView({ ...view, screen: 'inventory-sale' })}
        onSwitchToScanner={canUseScannerForSession(view.session) ? () => setView({ ...view, screen: 'scanner' }) : undefined}
        onSwitchToRequest={canUseInventoryRequestsForSession(view.session) ? () => setView({ ...view, screen: 'inventory-request' }) : undefined}
        onOpenCabinet={() => handleOpenOperatorCabinet('return')}
      />,
    )
  }

  if (view.screen === 'scanner') {
    return withUpdateBanner(
      <ErrorBoundary pageName="scanner">
        <ScannerPage
          config={config!}
          bootstrap={view.bootstrap}
          session={view.session}
          isOffline={isOffline}
          onLogout={handleLogout}
          onSwitchToShift={() => setView({ ...view, screen: 'shift' })}
          onSwitchToSale={canUseInventorySalesForSession(view.session) ? () => setView({ ...view, screen: 'inventory-sale' }) : undefined}
          onSwitchToRequest={canUseInventoryRequestsForSession(view.session) ? () => setView({ ...view, screen: 'inventory-request' }) : undefined}
          onSwitchToArena={canUseArenaForSession(view.session) ? () => setView({ ...view, screen: 'arena' }) : undefined}
          onOpenCabinet={() => handleOpenOperatorCabinet('scanner')}
        />
      </ErrorBoundary>,
    )
  }

  if (view.screen === 'arena') {
    return withUpdateBanner(
      <ErrorBoundary pageName="arena">
        <ArenaPage
          config={config!}
          bootstrap={view.bootstrap}
          session={view.session}
          onLogout={handleLogout}
          onSwitchToShift={() => setView({ ...view, screen: 'shift' })}
          onSwitchToSale={canUseInventorySalesForSession(view.session) ? () => setView({ ...view, screen: 'inventory-sale' }) : undefined}
          onSwitchToScanner={canUseScannerForSession(view.session) ? () => setView({ ...view, screen: 'scanner' }) : undefined}
          onSwitchToRequest={canUseInventoryRequestsForSession(view.session) ? () => setView({ ...view, screen: 'inventory-request' }) : undefined}
          onOpenCabinet={() => handleOpenOperatorCabinet('shift')}
        />
      </ErrorBoundary>,
    )
  }

  if (view.screen === 'inventory-request') {
    return withUpdateBanner(
      <InventoryRequestPage
        config={config!}
        bootstrap={view.bootstrap}
        session={view.session}
        onLogout={handleLogout}
        onSwitchToShift={() => setView({ ...view, screen: 'shift' })}
        onSwitchToSale={canUseInventorySalesForSession(view.session) ? () => setView({ ...view, screen: 'inventory-sale' }) : undefined}
        onSwitchToReturn={canUseInventorySalesForSession(view.session) ? () => setView({ ...view, screen: 'inventory-return' }) : undefined}
        onSwitchToScanner={canUseScannerForSession(view.session) ? () => setView({ ...view, screen: 'scanner' }) : undefined}
        onOpenCabinet={() => handleOpenOperatorCabinet('shift')}
      />,
    )
  }

  if (view.screen === 'operator-cabinet') {
    return withUpdateBanner(
      <ErrorBoundary pageName="cabinet">
        <OperatorCabinetPage
          config={config!}
          bootstrap={view.bootstrap}
          session={view.session}
          returnTo={view.returnTo}
          onBackToWork={() =>
            setView({
              screen:
                view.returnTo === 'sale'
                  ? 'inventory-sale'
                  : view.returnTo === 'return'
                    ? 'inventory-return'
                    : view.returnTo,
              bootstrap: view.bootstrap,
              session: view.session,
            })
          }
          onLogout={handleLogout}
        />
      </ErrorBoundary>,
    )
  }

  if (view.screen === 'admin') {
    return withUpdateBanner(
      <AdminLayout
        config={config!}
        session={view.session}
        bootstrap={view.bootstrap}
        onLogout={handleAdminLogout}
      />,
    )
  }

  return withUpdateBanner(null)
}
