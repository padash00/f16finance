'use client'

import { Lock } from 'lucide-react'

const FEATURE_UPGRADE: Record<string, { name: string; plan: string }> = {
  ai_reports: { name: 'AI-отчёты и прогнозирование', plan: 'Рост' },
  inventory: { name: 'Склад и инвентаризация', plan: 'Рост' },
  web_pos: { name: 'Web POS и терминалы', plan: 'Предприятие' },
  telegram: { name: 'Telegram-интеграция', plan: 'Рост' },
  custom_branding: { name: 'Брендирование', plan: 'Предприятие' },
  excel_exports: { name: 'Excel-экспорт', plan: 'Рост' },
}

interface PaywallGateProps {
  enabled: boolean
  feature?: string
  children: React.ReactNode
  className?: string
}

// SaaS subscription gating removed — always render children
export function PaywallGate({ enabled, feature, children, className }: PaywallGateProps) {
  return <div className={className}>{children}</div>
}
