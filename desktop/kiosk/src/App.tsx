import { useEffect, useState } from 'react'
import { ipc } from '@/lib/ipc'
import type { KioskState, ClientSession, KioskConfig, UiScreen, StationTheme, Game } from '@/types'
import { fetchTheme, fetchCatalog, fetchProfile } from '@/lib/api'

import SetupScreen from '@/screens/SetupScreen'
import WelcomeScreen from '@/screens/WelcomeScreen'
import TariffScreen from '@/screens/TariffScreen'
import ShellScreen from '@/screens/ShellScreen'
import ProfileScreen from '@/screens/ProfileScreen'
import EndedScreen from '@/screens/EndedScreen'
import BlockedScreen from '@/screens/BlockedScreen'

const isSetupMode = window.location.search.includes('screen=setup')
const isDev = import.meta.env.DEV

// Проверяем что preload загрузился
if (!window.kioskApi && !isSetupMode) {
  document.body.style.cssText = 'background:#07080a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace;font-size:14px;'
  document.body.innerHTML = '<div style="text-align:center"><p style="color:#f87171">Ошибка: preload не загрузился</p><p style="color:#6b7280;margin-top:8px">Переустановите Orda Kiosk</p></div>'
}

export default function App() {
  const [kioskState, setKioskState] = useState<KioskState | null>(null)
  const [client, setClient] = useState<ClientSession | null>(null)
  const [config, setConfig] = useState<KioskConfig | null>(null)
  const [theme, setTheme] = useState<StationTheme | null>(null)
  const [catalog, setCatalog] = useState<Game[]>([])
  const [uiScreen, setUiScreen] = useState<UiScreen>(isSetupMode ? 'setup' : 'welcome')
  const [pingBanner, setPingBanner] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)

  // Конфиг + тема + каталог из API
  useEffect(() => {
    if (isSetupMode) return
    ipc.getConfig().then((cfg) => {
      setConfig(cfg)
      fetchTheme(cfg).then(setTheme).catch(() => null)
      fetchCatalog(cfg).then(setCatalog).catch(() => null)
    }).catch(() => null)
  }, [])

  // Слушаем состояние от main process
  useEffect(() => {
    if (isSetupMode) return
    return ipc.onState((state) => setKioskState(state))
  }, [])

  useEffect(() => {
    if (!kioskState?.stationId || !config || config.stationId) return
    setConfig({ ...config, stationId: kioskState.stationId })
  }, [kioskState?.stationId, config])

  // Авто-обновление: слушаем уведомление о новой версии
  useEffect(() => {
    if (isSetupMode || !window.kioskApi.onUpdateAvailable) return
    return window.kioskApi.onUpdateAvailable((info: { version: string }) => {
      setUpdateAvailable(info.version)
    })
  }, [])

  // Тест связи — показываем баннер при получении ping
  useEffect(() => {
    if (isSetupMode || !window.kioskApi.onPing) return
    return window.kioskApi.onPing(() => {
      setPingBanner(true)
      setTimeout(() => setPingBanner(false), 4000)
    })
  }, [])

  // Обновляем баланс клиента каждые 30 сек пока он залогинен
  useEffect(() => {
    if (!client || !config) return
    const interval = setInterval(async () => {
      try {
        const updated = await fetchProfile(config, client.token)
        setClient((prev) => prev ? { ...prev, balance: updated.balance } : prev)
      } catch { /* ignore — не критично */ }
    }, 30000)
    return () => clearInterval(interval)
  }, [client?.token, config])

  // Безопасность: блокируем правый клик и drag-drop в renderer
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault()
    document.addEventListener('contextmenu', prevent)
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', prevent)
    return () => {
      document.removeEventListener('contextmenu', prevent)
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', prevent)
    }
  }, [])

  // Переключаем экраны на основе kiosk state
  useEffect(() => {
    if (!kioskState || uiScreen === 'setup' || uiScreen === 'profile') return

    if (kioskState.screen === 'blocked') { setUiScreen('blocked'); return }
    if (kioskState.screen === 'ended') { setUiScreen('ended'); return }

    if (kioskState.screen === 'active') {
      if (uiScreen === 'welcome' || uiScreen === 'tariff') setUiScreen('shell')
      return
    }

    // idle — возвращаем на приветствие
    if (uiScreen === 'shell' || uiScreen === 'ended') {
      setUiScreen('welcome')
      setClient(null)
    }
  }, [kioskState?.screen])

  function handleLoginSuccess(session: ClientSession) {
    setClient(session)
    setUiScreen(kioskState?.screen === 'active' ? 'shell' : 'tariff')
  }

  function handleLogout() {
    setClient(null)
    setUiScreen('welcome')
  }

  // Объединяем каталог из API с играми из WS (WS приоритетнее — оператор может передать свой список)
  const effectiveGames = kioskState?.games?.length ? kioskState.games : catalog

  function renderScreen() {
    if (uiScreen === 'setup') return <SetupScreen />
    if (uiScreen === 'blocked' && kioskState) return <BlockedScreen reason={kioskState.bindingReason} />
    if (uiScreen === 'ended') return <EndedScreen onExtend={() => ipc.requestExtend()} onLogout={handleLogout} accentColor={theme?.accentColor} />
    if (uiScreen === 'welcome') {
      return (
        <WelcomeScreen
          theme={theme}
          config={config}
          onLoginSuccess={handleLoginSuccess}
          onGuestActivated={() => setUiScreen('shell')}
        />
      )
    }
    if (uiScreen === 'tariff' && config) {
      return (
        <TariffScreen
          client={client!}
          config={config}
          onActivated={() => setUiScreen('shell')}
          onBack={() => setUiScreen('welcome')}
          accentColor={theme?.accentColor}
        />
      )
    }
    if (uiScreen === 'profile' && config) {
      return (
        <ProfileScreen
          client={client!}
          config={config}
          onBack={() => setUiScreen('shell')}
          onLogout={handleLogout}
          onClientUpdated={setClient}
          accentColor={theme?.accentColor}
        />
      )
    }
    if (uiScreen === 'shell' && kioskState) {
      return (
        <ShellScreen
          kioskState={{ ...kioskState, games: effectiveGames }}
          client={client}
          onProfile={() => setUiScreen('profile')}
          onExtend={() => ipc.requestExtend()}
          onCallOperator={() => ipc.callOperator()}
          onLaunchGame={(id) => ipc.launchGame(id)}
          accentColor={theme?.accentColor}
        />
      )
    }
    return (
      <div className="h-screen flex items-center justify-center bg-[#07080a]">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      {renderScreen()}
      {pingBanner && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-none">
          <div className="bg-green-500 text-white text-2xl font-bold px-10 py-6 rounded-2xl shadow-2xl">
            ✓ Связь работает! Realtime подключён.
          </div>
        </div>
      )}
      {updateAvailable && (
        <div className="fixed top-0 inset-x-0 z-[9999] flex items-center justify-center gap-3 bg-blue-900/95 border-b border-blue-500/40 px-6 py-3">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
          <p className="text-blue-200 text-sm font-medium">Доступно обновление v{updateAvailable} — установится при следующем перезапуске</p>
        </div>
      )}
      {kioskState?.offlineMode && (
        <div className="fixed top-0 inset-x-0 z-[9998] flex items-center justify-center gap-3 bg-red-900/95 border-b border-red-500/40 px-6 py-3 pointer-events-none">
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
          <p className="text-red-200 text-sm font-medium">Нет подключения к серверу — обратитесь к оператору</p>
        </div>
      )}
      {kioskState && (
        <div className="fixed bottom-2 left-2 z-[9999] text-[10px] font-mono bg-black/70 text-white px-2 py-1 rounded space-y-0.5 pointer-events-none select-none">
          <div>
            <span className="text-white/50">id:</span> {kioskState.stationId ? kioskState.stationId.slice(0, 8) : '—'}
            {' · '}
            <span className="text-white/50">hb:</span> <span className={kioskState.heartbeatStatus === 'ok' ? 'text-green-400' : kioskState.heartbeatStatus === 'pending' ? 'text-yellow-400' : 'text-red-400'}>{kioskState.heartbeatStatus}</span>
            {' · '}
            <span className="text-white/50">rt:</span> <span className={kioskState.realtimeConnected ? 'text-green-400' : 'text-red-400'}>{kioskState.realtimeConnected ? '✓' : '✗'}</span>
          </div>
        </div>
      )}
    </>
  )
}
