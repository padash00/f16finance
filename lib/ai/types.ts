export type AssistantPage = 'global' | 'analysis' | 'reports' | 'expenses' | 'cashflow' | 'weekly-report' | 'forecast' | 'ratings'

export type SnapshotMetric = {
  label: string
  value: string | number | boolean
  hint?: string
}

export type SnapshotSection = {
  title: string
  metrics?: SnapshotMetric[]
  bullets?: string[]
}

export type PageSnapshot = {
  page: AssistantPage
  title: string
  generatedAt: string
  route?: string
  period?: {
    from?: string
    to?: string
    label?: string
  }
  summary: string[]
  sections: SnapshotSection[]
}

export type AssistantChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AssistantRequest = {
  page: AssistantPage
  prompt: string
  history?: AssistantChatMessage[]
  snapshot?: PageSnapshot | null
}

export type AssistantResponse = {
  text?: string
  error?: string
}
