'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import {
  Bot,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  Webhook,
  Settings2,
  RefreshCw,
  MessageSquare,
  CalendarDays,
  AlertTriangle,
} from 'lucide-react'

type BotStatus = {
  hasToken: boolean
  hasChatId: boolean
  hasWebhookSecret: boolean
  botInfo: { username: string; first_name: string } | null
  webhookInfo: {
    url: string
    has_custom_certificate: boolean
    pending_update_count: number
    last_error_message?: string
  } | null
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
        ok
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          : 'bg-red-500/10 border-red-500/20 text-red-400'
      }`}
    >
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {label}
    </div>
  )
}

export default function TelegramPage() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupMsg, setSetupMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [reportLoading, setReportLoading] = useState<'daily' | 'weekly' | null>(null)
  const [reportMsg, setReportMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadStatus = async () => {
    setStatusLoading(true)
    try {
      const res = await fetch('/api/telegram/status')
      const data = await res.json()
      setStatus(data)
      // Auto-fill webhook URL hint
      if (typeof window !== 'undefined' && !webhookUrl) {
        setWebhookUrl(`${window.location.origin}/api/telegram/webhook`)
      }
    } catch {
      // ignore
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSetupWebhook = async () => {
    if (!webhookUrl) return
    setSetupLoading(true)
    setSetupMsg(null)
    try {
      const res = await fetch('/api/telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      })
      const data = await res.json()
      if (res.ok) {
        setSetupMsg({ ok: true, text: 'Вебхук успешно зарегистрирован!' })
        await loadStatus()
      } else {
        setSetupMsg({ ok: false, text: data.error || 'Ошибка регистрации вебхука' })
      }
    } catch {
      setSetupMsg({ ok: false, text: 'Сетевая ошибка' })
    } finally {
      setSetupLoading(false)
    }
  }

  const handleSendReport = async (type: 'daily' | 'weekly') => {
    setReportLoading(type)
    setReportMsg(null)
    try {
      const res = await fetch('/api/telegram/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await res.json()
      if (res.ok) {
        setReportMsg({
          ok: true,
          text: `${type === 'daily' ? 'Дневной' : 'Недельный'} отчёт отправлен в канал!`,
        })
      } else {
        setReportMsg({ ok: false, text: data.error || 'Ошибка отправки' })
      }
    } catch {
      setReportMsg({ ok: false, text: 'Сетевая ошибка' })
    } finally {
      setReportLoading(null)
    }
  }

  const isFullyConfigured = status?.hasToken && status?.hasChatId
  const webhookActive = !!status?.webhookInfo?.url

  return (
    <div className="app-shell-layout bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />
      <main className="app-main">
        <div className="app-page max-w-4xl space-y-6">
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-900/30 via-gray-900 to-cyan-900/30 p-6 border border-blue-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-10 pointer-events-none" />
            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-500/20 rounded-xl">
                  <Bot className="w-8 h-8 text-blue-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Telegram Bot
                  </h1>
                  <p className="text-sm text-gray-400">Финансовые отчёты и уведомления в Telegram</p>
                </div>
              </div>
              <button
                onClick={loadStatus}
                disabled={statusLoading}
                className="p-2 rounded-xl border border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Status */}
          <Card className="p-5 bg-gray-900/80 border-gray-800">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-gray-400" />
              Статус конфигурации
            </h2>

            {statusLoading ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Проверяю...
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge ok={!!status?.hasToken} label="TELEGRAM_BOT_TOKEN" />
                  <StatusBadge ok={!!status?.hasChatId} label="TELEGRAM_CHAT_ID" />
                  <StatusBadge ok={!!status?.hasWebhookSecret} label="TELEGRAM_WEBHOOK_SECRET" />
                  <StatusBadge ok={webhookActive} label="Вебхук активен" />
                </div>

                {status?.botInfo && (
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-gray-300">
                      Бот:{' '}
                      <span className="text-white font-medium">@{status.botInfo.username}</span>{' '}
                      ({status.botInfo.first_name})
                    </span>
                  </div>
                )}

                {status?.webhookInfo?.url && (
                  <div className="text-xs text-gray-500 bg-gray-800/50 rounded-lg p-3 font-mono break-all">
                    {status.webhookInfo.url}
                  </div>
                )}

                {status?.webhookInfo?.last_error_message && (
                  <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{status.webhookInfo.last_error_message}</span>
                  </div>
                )}

                {!status?.hasToken && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
                    <p className="text-amber-300 font-medium mb-2">Как настроить бота:</p>
                    <ol className="text-gray-400 space-y-1 list-decimal list-inside text-xs">
                      <li>Создайте бота через @BotFather в Telegram</li>
                      <li>
                        Добавьте{' '}
                        <code className="bg-gray-800 px-1 rounded">
                          TELEGRAM_BOT_TOKEN=...
                        </code>{' '}
                        в .env.local
                      </li>
                      <li>Создайте канал/чат и добавьте бота как администратора</li>
                      <li>
                        Добавьте{' '}
                        <code className="bg-gray-800 px-1 rounded">TELEGRAM_CHAT_ID=...</code> в
                        .env.local (ID чата)
                      </li>
                      <li>
                        Опционально:{' '}
                        <code className="bg-gray-800 px-1 rounded">
                          TELEGRAM_WEBHOOK_SECRET=...
                        </code>{' '}
                        — произвольная строка для защиты
                      </li>
                      <li>Зарегистрируйте вебхук ниже</li>
                    </ol>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Webhook Setup */}
          {status?.hasToken && (
            <Card className="p-5 bg-gray-900/80 border-gray-800">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Webhook className="w-4 h-4 text-gray-400" />
                Регистрация вебхука
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                Telegram будет отправлять входящие сообщения на этот URL. Должен быть публичным
                HTTPS.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://your-domain.com/api/telegram/webhook"
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500/50"
                />
                <button
                  onClick={handleSetupWebhook}
                  disabled={setupLoading || !webhookUrl}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                >
                  {setupLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Webhook className="w-4 h-4" />
                  )}
                  Зарегистрировать
                </button>
              </div>
              {setupMsg && (
                <div
                  className={`mt-3 text-xs rounded-lg px-3 py-2 ${
                    setupMsg.ok
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}
                >
                  {setupMsg.text}
                </div>
              )}
            </Card>
          )}

          {/* Send Reports */}
          {isFullyConfigured && (
            <Card className="p-5 bg-gray-900/80 border-gray-800">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Send className="w-4 h-4 text-gray-400" />
                Отправить отчёт в канал
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Ручная отправка финансового отчёта в настроенный Telegram-канал.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => handleSendReport('daily')}
                  disabled={!!reportLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
                >
                  {reportLoading === 'daily' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CalendarDays className="w-4 h-4" />
                  )}
                  Дневной отчёт
                </button>
                <button
                  onClick={() => handleSendReport('weekly')}
                  disabled={!!reportLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
                >
                  {reportLoading === 'weekly' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CalendarDays className="w-4 h-4" />
                  )}
                  Недельный отчёт
                </button>
              </div>
              {reportMsg && (
                <div
                  className={`mt-3 text-xs rounded-lg px-3 py-2 ${
                    reportMsg.ok
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}
                >
                  {reportMsg.text}
                </div>
              )}
            </Card>
          )}

          {/* Commands reference */}
          <Card className="p-5 bg-gray-900/80 border-gray-800">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              Команды бота
            </h2>
            <div className="space-y-2">
              {[
                { cmd: '/start', desc: 'Начало работы и список команд' },
                { cmd: '/today', desc: 'Финансовая сводка за сегодня' },
                { cmd: '/yesterday', desc: 'Финансовая сводка за вчера' },
                { cmd: '/week', desc: 'Сводка за последние 7 дней' },
                { cmd: '/month', desc: 'Сводка за последние 30 дней' },
                { cmd: '/cashflow', desc: 'Баланс и движение денег за 30 дней' },
                { cmd: '/help', desc: 'Список всех команд' },
              ].map(({ cmd, desc }) => (
                <div
                  key={cmd}
                  className="flex items-center gap-3 py-1.5 border-b border-gray-800/50 last:border-0"
                >
                  <code className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded font-mono w-28 shrink-0">
                    {cmd}
                  </code>
                  <span className="text-sm text-gray-400">{desc}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
