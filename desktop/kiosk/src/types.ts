export interface KioskState {
  screen: 'idle' | 'active' | 'ended' | 'blocked'
  clubName: string
  stationCode: string
  stationId: string
  realtimeConnected: boolean
  deviceIp: string
  deviceMac: string
  active: boolean
  tariffName: string
  remainingSec: number
  bindingBlocked: boolean
  bindingReason: string
  games: Game[]
  game: GameProcessState | null
}

export interface Game {
  id: string
  title: string
  logoUrl: string
  exePath: string
  category: 'game' | 'browser' | 'app'
}

export interface GameProcessState {
  running: boolean
  pid?: number
}

export interface ClientSession {
  token: string
  clientId: string
  displayName: string
  username: string
  avatarUrl: string | null
  balance: number
}

export interface Tariff {
  id: string
  name: string
  durationMin: number
  price: number
  description?: string
}

export interface StationTheme {
  bgType: 'color' | 'gradient' | 'image' | 'video'
  bgValue: string
  accentColor: string
  logoUrl: string | null
  clubName: string
  announcement: string | null
}

export interface KioskConfig {
  serverBaseUrl: string
  clientSecret: string
  deviceToken: string
  stationCode: string
}

export type UiScreen =
  | 'setup'
  | 'welcome'
  | 'tariff'
  | 'shell'
  | 'profile'
  | 'ended'
  | 'blocked'
