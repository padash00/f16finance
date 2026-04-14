import type { KioskState, KioskConfig, Game } from '@/types'

declare global {
  interface Window {
    kioskApi: {
      onState: (listener: (state: KioskState) => void) => () => void
      launchGame: (gameId: string) => Promise<{ ok: boolean; error?: string }>
      requestExtend: () => Promise<{ ok: boolean }>
      callOperator: () => Promise<{ ok: boolean }>
      setup: {
        load: () => Promise<Record<string, string>>
        save: (payload: Record<string, string>) => Promise<{ ok: boolean; error?: string }>
      }
      getConfig: () => Promise<KioskConfig>
      startSessionLocal: (payload: {
        durationSec: number
        tariffName: string
        games?: Game[]
      }) => Promise<{ ok: boolean; error?: string }>
    }
  }
}

export const ipc = {
  onState: (listener: (state: KioskState) => void) => window.kioskApi.onState(listener),
  launchGame: (gameId: string) => window.kioskApi.launchGame(gameId),
  requestExtend: () => window.kioskApi.requestExtend(),
  callOperator: () => window.kioskApi.callOperator(),
  getConfig: () => window.kioskApi.getConfig(),
  startSessionLocal: (payload: { durationSec: number; tariffName: string; games?: Game[] }) =>
    window.kioskApi.startSessionLocal(payload),
  setup: {
    load: () => window.kioskApi.setup.load(),
    save: (payload: Record<string, string>) => window.kioskApi.setup.save(payload),
  },
}
