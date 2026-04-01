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

export function PaywallGate({ enabled, feature, children, className }: PaywallGateProps) {
  if (enabled) return <div className={className}>{children}</div>

  const meta = feature ? FEATURE_UPGRADE[feature] : null

  return (
    <div className={`relative overflow-hidden rounded-xl ${className ?? ''}`}>
      <div className="pointer-events-none select-none opacity-20 blur-[2px]">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-[1px]">
        <div className="mx-4 max-w-sm rounded-2xl border border-violet-500/30 bg-slate-900/95 p-6 text-center shadow-xl">
          <div className="mb-3 mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/20">
            <Lock className="h-5 w-5 text-violet-400" />
          </div>
          <h3 className="font-semibold text-white">
            {meta ? meta.name : 'Функция недоступна'}
          </h3>
          {meta && (
            <p className="mt-1.5 text-sm text-slate-400">
              Доступно на тарифе{' '}
              <span className="font-medium text-violet-300">{meta.plan}</span>
            </p>
          )}
          <p className="mt-4 text-xs text-slate-500">
            Обратитесь к владельцу аккаунта для обновления тарифа.
          </p>
        </div>
      </div>
    </div>
  )
}
