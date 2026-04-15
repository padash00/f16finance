import { useEffect, useState } from 'react'
import { ipc } from '@/lib/ipc'
import type { KioskState, ClientSession, KioskConfig, UiScreen, StationTheme, Game } from '@/types'
import { fetchTheme, fetchCatalog } from '@/lib/api'

import SetupScreen from '@/screens/SetupScreen'
import WelcomeScreen from '@/screens/WelcomeScreen'
import TariffScreen from '@/screens/TariffScreen'
import ShellScreen from '@/screens/ShellScreen'
import ProfileScreen from '@/screens/ProfileScreen'
import EndedScreen from '@/screens/EndedScreen'
import BlockedScreen from '@/screens/BlockedScreen'

const isSetupMode = window.location.search.includes('screen=setup')
const isDev = import.meta.env.DEV

export default function App() {
  const [kioskState, setKioskState] = useState<KioskState | null>(null)
  const [client, setClient] = useState<ClientSession | null>(null)
  const [config, setConfig] = useState<KioskConfig | null>(null)
  const [theme, setTheme] = useState<StationTheme | null>(null)
  const [catalog, setCatalog] = useState<Game[]>([])
  const [uiScreen, setUiScreen] = useState<UiScreen>(isSetupMode ? 'setup' : 'welcome')
  const [pingBanner, setPingBanner] = useState(false)

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

  // Тест связи — показываем баннер при получении ping
  useEffect(() => {
    if (isSetupMode || !window.kioskApi.onPing) return
    return window.kioskApi.onPing(() => {
      setPingBanner(true)
      setTimeout(() => setPingBanner(false), 4000)
    })
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
