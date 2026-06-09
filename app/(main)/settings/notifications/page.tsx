'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Bell, MessageSquare, Send, Bell as BellIcon } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

const EVENT_LABELS: Record<string, { label: string; subtitle?: string }> = {
  team_chat_message: { label: 'Сообщения в команд-чате', subtitle: 'Когда кто-то пишет в общем чате' },
  dm: { label: 'Личные сообщения', subtitle: 'Прямые сообщения от коллег' },
  announcement: { label: 'Объявления', subtitle: 'Объявления от владельца' },
  mention: { label: 'Упоминания @me', subtitle: 'Когда тебя упомянули в чате' },
  shift_assigned: { label: 'Назначена смена', subtitle: 'Менеджер поставил тебе смену' },
  shift_changed: { label: 'Изменения в смене', subtitle: 'Смена перенесена или отменена' },
  task_assigned: { label: 'Новая задача' },
  task_commented: { label: 'Комментарий к задаче' },
  debt_overdue: { label: 'Просроченные долги', subtitle: 'Только для владельца' },
  debt_added: { label: 'Новый долг' },
  birthday: { label: 'Дни рождения', subtitle: 'Поздравления с ДР коллег' },
  holiday: { label: 'Праздники РК' },
  news_post: { label: 'Новый пост в ленте' },
}

const CHANNEL_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  push: { label: 'Push', icon: BellIcon, color: 'text-amber-300' },
  telegram: { label: 'Telegram', icon: Send, color: 'text-blue-300' },
  in_app: { label: 'В приложении', icon: MessageSquare, color: 'text-purple-300' },
}

type Pref = { channel: string; event_type: string; enabled: boolean }

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<Pref[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/me/notification-prefs', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) {
        setPrefs(j.prefs || [])
        setChannels(j.channels || [])
        setEvents(j.events || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const isEnabled = (channel: string, event: string): boolean => {
    const found = prefs.find(p => p.channel === channel && p.event_type === event)
    // По умолчанию все включены
    return found ? found.enabled : true
  }

  const toggle = async (channel: string, event: string, enabled: boolean) => {
    setPrefs(prev => {
      const filtered = prev.filter(p => !(p.channel === channel && p.event_type === event))
      return [...filtered, { channel, event_type: event, enabled }]
    })
    await fetch('/api/me/notification-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, eventType: event, enabled }),
    })
  }

  return (
    <div className="app-page-tight space-y-5">
      <AdminPageHeader
        title="Уведомления"
        description="Выбери что хочешь получать и как"
        icon={<Bell className="h-5 w-5" />}
        accent="blue"
        backHref="/settings"
      />

      {loading && <Card className="p-6 text-center text-muted-foreground text-sm">Загрузка...</Card>}

      {!loading && events.map(eventType => {
        const meta = EVENT_LABELS[eventType] || { label: eventType }
        return (
          <Card key={eventType} className="p-4 border-border bg-card">
            <div className="mb-3">
              <div className="text-sm font-semibold text-foreground">{meta.label}</div>
              {meta.subtitle && (
                <div className="text-xs text-muted-foreground mt-0.5">{meta.subtitle}</div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {channels.map(channel => {
                const ch = CHANNEL_LABELS[channel] || { label: channel, icon: Bell, color: 'text-slate-300' }
                const Icon = ch.icon
                const enabled = isEnabled(channel, eventType)
                return (
                  <button
                    key={channel}
                    onClick={() => toggle(channel, eventType, !enabled)}
                    className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      enabled
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                        : 'border-border bg-background/50 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${enabled ? 'text-amber-300' : ch.color}`} />
                    <span className="text-xs font-medium">{ch.label}</span>
                    {enabled && <span className="text-[10px]">✓</span>}
                  </button>
                )
              })}
            </div>
          </Card>
        )
      })}

      <Card className="p-4 border-blue-500/30 bg-blue-500/[0.04]">
        <div className="flex items-start gap-3">
          <div className="text-2xl">ℹ️</div>
          <div className="text-sm text-muted-foreground">
            <p className="text-foreground font-medium mb-1">Как работают каналы</p>
            <ul className="space-y-1 text-xs">
              <li>• <strong>Push</strong> — уведомление на телефон (требует $99 Apple Developer аккаунт, в работе)</li>
              <li>• <strong>Telegram</strong> — отправит в твой telegram_chat_id (заполнить в профиле)</li>
              <li>• <strong>В приложении</strong> — красная точка / счётчик в шапке</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}
