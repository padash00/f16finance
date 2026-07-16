'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  XCircle,
  RefreshCw,
} from 'lucide-react'

type Flag = {
  id: string
  source_table: 'team_chat' | 'direct_messages'
  source_message_id: string
  author_user_id: string | null
  author_name: string
  recipient_user_id: string | null
  message_text: string
  severity: number
  categories: string[]
  ai_summary: string | null
  ai_model: string | null
  status: 'pending' | 'confirmed' | 'dismissed'
  created_at: string
  reviewer_note: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  cash_skim: 'Сговор / кража',
  data_leak: 'Утечка данных',
  harassment: 'Харассмент',
  threat: 'Угрозы',
  profanity: 'Грубость',
  other: 'Другое',
}

const CATEGORY_COLORS: Record<string, string> = {
  cash_skim: 'bg-red-500/15 text-red-300 border-red-500/30',
  data_leak: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  harassment: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  threat: 'bg-red-500/15 text-red-300 border-red-500/30',
  profanity: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  other: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
}

type Tab = 'pending' | 'confirmed' | 'dismissed'

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ModerationPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [flags, setFlags] = useState<Flag[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/moderation?status=${tab}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setFlags(body.flags || [])
      setPendingCount(body.pendingCount || 0)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    load()
  }, [load])

  const act = async (id: string, status: 'confirmed' | 'dismissed') => {
    setActingId(id)
    try {
      const res = await fetch('/api/admin/moderation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        alert(err?.error || `HTTP ${res.status}`)
      } else {
        // Оптимистично убираем из текущего списка если статус сменился
        setFlags(prev => prev.filter(f => f.id !== id))
        if (tab === 'pending') setPendingCount(c => Math.max(0, c - 1))
      }
    } finally {
      setActingId(null)
    }
  }

  const severityColor = (s: number) =>
    s >= 8 ? 'text-red-400' : s >= 6 ? 'text-orange-400' : s >= 4 ? 'text-amber-400' : 'text-yellow-400'

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Модерация ИИ"
        description="Подозрительные сообщения отмечены ИИ. Проверяй и реагируй."
        icon={<ShieldAlert className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        }
        toolbar={
          <div className="flex gap-1 border-b border-border overflow-x-auto">
            {([
              { id: 'pending' as const, label: `На рассмотрении ${pendingCount > 0 ? `(${pendingCount})` : ''}`, icon: AlertTriangle },
              { id: 'confirmed' as const, label: 'Подтверждённые', icon: ShieldCheck },
              { id: 'dismissed' as const, label: 'Отклонённые', icon: XCircle },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  tab === id ? 'border-red-500 text-red-300' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <Card className="p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
          {error}
        </Card>
      )}

      {!loading && flags.length === 0 && !error && (
        <Card className="p-10 border-border bg-card text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <p className="text-muted-foreground">
            {tab === 'pending' ? 'Нет новых флагов — всё чисто 👌' : 'Список пуст'}
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {flags.map(flag => (
          <Card key={flag.id} className="p-4 border-border bg-card">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className={`text-2xl font-bold ${severityColor(flag.severity)}`}>
                  {flag.severity}
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{flag.author_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {flag.source_table === 'team_chat' ? 'Командный чат' : 'Личное сообщение'} ·{' '}
                    {fmtDate(flag.created_at)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {flag.categories.map(cat => (
                  <span
                    key={cat}
                    className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${
                      CATEGORY_COLORS[cat] || CATEGORY_COLORS.other
                    }`}
                  >
                    {CATEGORY_LABELS[cat] || cat}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-background/50 border border-border rounded-lg p-3 mb-3">
              <div className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">Сообщение</div>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">{flag.message_text}</p>
            </div>

            {flag.ai_summary && (
              <div className="flex items-start gap-2 mb-3 p-3 rounded-lg bg-orange-500/[0.05] border border-orange-500/20">
                <Sparkles className="w-4 h-4 text-orange-300 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-orange-300 font-semibold mb-0.5">Анализ ИИ</div>
                  <p className="text-sm text-foreground">{flag.ai_summary}</p>
                </div>
              </div>
            )}

            {flag.status === 'pending' && (
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => act(flag.id, 'dismissed')}
                  disabled={actingId === flag.id}
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Отклонить (всё ок)
                </Button>
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => act(flag.id, 'confirmed')}
                  disabled={actingId === flag.id}
                >
                  <ShieldCheck className="w-4 h-4 mr-1" />
                  Подтвердить нарушение
                </Button>
              </div>
            )}
            {flag.status !== 'pending' && flag.reviewer_note && (
              <div className="text-xs text-muted-foreground mt-2 italic">
                Заметка: {flag.reviewer_note}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
