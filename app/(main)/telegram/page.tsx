'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  MessageSquare,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  Users2,
  Webhook,
  XCircle,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

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

type AllowedUser = {
  id: string
  telegram_user_id: string
  label: string | null
  can_finance: boolean
  created_at: string
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function SectionToggle({
  title,
  icon: Icon,
  open,
  onToggle,
  children,
  badge,
}: {
  title: string
  icon: any
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  badge?: string
}) {
  return (
    <Card className="bg-gray-900/80 border-gray-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-800 rounded-lg">
            <Icon className="w-4 h-4 text-gray-400" />
          </div>
          <span className="text-sm font-semibold text-white">{title}</span>
          {badge && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
              {badge}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-800/60 pt-4">{children}</div>}
    </Card>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function TelegramPage() {
  // Status
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  // Allowed users
  const [users, setUsers] = useState<AllowedUser[]>([])
  const [tableExists, setTableExists] = useState<boolean | null>(null)
  const [usersLoading, setUsersLoading] = useState(true)
  const [newUserId, setNewUserId] = useState('')
  const [newUserLabel, setNewUserLabel] = useState('')
  const [newUserFinance, setNewUserFinance] = useState(true)
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Webhook
  const [webhookUrl, setWebhookUrl] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupMsg, setSetupMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Reports
  const [reportLoading, setReportLoading] = useState<'daily' | 'weekly' | null>(null)
  const [reportMsg, setReportMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Staff Telegram IDs
  const [staffMembers, setStaffMembers] = useState<Array<{ id: string; full_name: string; role: string; telegram_chat_id: string | null; is_active: boolean }>>([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null)
  const [editingTgId, setEditingTgId] = useState('')
  const [staffSaveLoading, setStaffSaveLoading] = useState<string | null>(null)
  const [staffSaveMsg, setStaffSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Section visibility
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    status: true,
    users: true,
    staff: false,
    webhook: false,
    reports: false,
    commands: false,
    sql: false,
  })

  const toggle = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))

  // ── Load ──

  const loadStatus = async () => {
    setStatusLoading(true)
    try {
      const res = await fetch('/api/telegram/status')
      const data = await res.json()
      setStatus(data)
      if (typeof window !== 'undefined' && !webhookUrl) {
        // Force HTTPS — Telegram requires it; HTTP causes 307 redirect
        const origin = window.location.origin.replace(/^http:/, 'https:')
        setWebhookUrl(`${origin}/api/telegram/webhook`)
      }
    } catch {}
    finally { setStatusLoading(false) }
  }

  const loadUsers = async () => {
    setUsersLoading(true)
    try {
      const res = await fetch('/api/telegram/allowed-users')
      const data = await res.json()
      setUsers(data.data ?? [])
      setTableExists(data.tableExists ?? false)
    } catch {}
    finally { setUsersLoading(false) }
  }

  const loadStaff = async () => {
    setStaffLoading(true)
    try {
      const res = await fetch('/api/telegram/staff-ids')
      const data = await res.json()
      setStaffMembers(data.data ?? [])
    } catch {}
    finally { setStaffLoading(false) }
  }

  useEffect(() => {
    loadStatus()
    loadUsers()
    loadStaff()
  }, [])

  // ── Actions ──

  const handleAddUser = async () => {
    if (!newUserId.trim()) return
    setAddLoading(true)
    setAddError(null)
    try {
      const res = await fetch('/api/telegram/allowed-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_user_id: newUserId.trim(),
          label: newUserLabel.trim() || null,
          can_finance: newUserFinance,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка добавления')
      setNewUserId('')
      setNewUserLabel('')
      setNewUserFinance(true)
      await loadUsers()
    } catch (e: any) {
      setAddError(e.message)
    } finally {
      setAddLoading(false)
    }
  }

  const handleToggleFinance = async (user: AllowedUser) => {
    await fetch('/api/telegram/allowed-users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, label: user.label, can_finance: !user.can_finance }),
    })
    await loadUsers()
  }

  const handleDeleteUser = async (id: string) => {
    await fetch(`/api/telegram/allowed-users?id=${id}`, { method: 'DELETE' })
    await loadUsers()
  }

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
        setSetupMsg({ ok: false, text: data.error || 'Ошибка' })
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
        setReportMsg({ ok: true, text: `${type === 'daily' ? 'Дневной' : 'Недельный'} отчёт отправлен!` })
      } else {
        setReportMsg({ ok: false, text: data.error || 'Ошибка отправки' })
      }
    } catch {
      setReportMsg({ ok: false, text: 'Сетевая ошибка' })
    } finally {
      setReportLoading(null)
    }
  }

  const isConfigured = status?.hasToken
  const webhookActive = !!status?.webhookInfo?.url

  const SQL_TEXT = `-- Run this in Supabase SQL Editor
create table if not exists telegram_allowed_users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text unique not null,
  label text,
  can_finance boolean default true,
  created_at timestamptz default now()
);`

  return (
    <>
        <div className="app-page max-w-3xl space-y-4">

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
                  <p className="text-sm text-gray-400">
                    {status?.botInfo ? `@${status.botInfo.username}` : 'Управление ботом и доступами'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { loadStatus(); loadUsers(); loadStaff() }}
                disabled={statusLoading}
                className="p-2 rounded-xl border border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* ── 1. Status ── */}
          <SectionToggle title="Статус бота" icon={Settings2} open={openSections.status} onToggle={() => toggle('status')}>
            {statusLoading ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Проверяю...
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge ok={!!status?.hasToken} label="BOT_TOKEN" />
                  <StatusBadge ok={!!status?.hasChatId} label="CHAT_ID" />
                  <StatusBadge ok={!!status?.hasWebhookSecret} label="WEBHOOK_SECRET" />
                  <StatusBadge ok={webhookActive} label="Вебхук активен" />
                </div>

                {status?.botInfo && (
                  <div className="flex items-center gap-2 text-sm text-gray-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Бот:{' '}
                    <span className="text-white font-medium">@{status.botInfo.username}</span>
                    <span className="text-gray-500">({status.botInfo.first_name})</span>
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
                    {status.webhookInfo.last_error_message}
                  </div>
                )}

                {!status?.hasToken && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-gray-400 space-y-1">
                    <p className="text-amber-300 font-semibold text-sm mb-2">Как настроить:</p>
                    <p>1. Создайте бота через <strong className="text-white">@BotFather</strong> → получите токен</p>
                    <p>2. Добавьте в Vercel env: <code className="bg-gray-800 px-1 rounded text-gray-300">TELEGRAM_BOT_TOKEN</code></p>
                    <p>3. Создайте канал/группу, добавьте бота как админа</p>
                    <p>4. Добавьте в Vercel env: <code className="bg-gray-800 px-1 rounded text-gray-300">TELEGRAM_CHAT_ID</code></p>
                    <p>5. Опционально: <code className="bg-gray-800 px-1 rounded text-gray-300">TELEGRAM_WEBHOOK_SECRET</code> — любая строка</p>
                    <p>6. Зарегистрируйте вебхук в разделе ниже</p>
                  </div>
                )}
              </div>
            )}
          </SectionToggle>

          {/* ── 2. Allowed Users ── */}
          <SectionToggle
            title="Доступ к финансовым командам"
            icon={Shield}
            open={openSections.users}
            onToggle={() => toggle('users')}
            badge={users.length > 0 ? String(users.length) : undefined}
          >
            {tableExists === false && (
              <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300 space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4" />
                  Таблица не создана в Supabase
                </div>
                <p className="text-gray-400">
                  Раскройте раздел «SQL для Supabase» внизу и выполните скрипт в SQL Editor.
                  После этого обновите страницу.
                </p>
              </div>
            )}

            <p className="text-xs text-gray-500 mb-4">
              Только пользователи из этого списка могут использовать финансовые команды бота
              (/today, /week, /month и т.д.). Чужие пользователи получат отказ.
            </p>

            {/* Add user form */}
            <div className="rounded-xl border border-gray-700 bg-gray-800/30 p-4 mb-4 space-y-3">
              <p className="text-xs font-medium text-gray-300">Добавить пользователя</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  placeholder="Telegram User ID (числовой)"
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500/50"
                />
                <input
                  type="text"
                  value={newUserLabel}
                  onChange={(e) => setNewUserLabel(e.target.value)}
                  placeholder="Имя (необязательно)"
                  className="w-40 px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500/50"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newUserFinance}
                    onChange={(e) => setNewUserFinance(e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-500"
                  />
                  <span className="text-xs text-gray-400">Доступ к финансовым командам</span>
                </label>
                <button
                  onClick={handleAddUser}
                  disabled={addLoading || !newUserId.trim() || tableExists === false}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-xl transition-colors"
                >
                  {addLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Добавить
                </button>
              </div>
              {addError && (
                <p className="text-xs text-red-400">{addError}</p>
              )}
              <p className="text-xs text-gray-600">
                Свой Telegram ID: напишите боту <span className="text-gray-400">@userinfobot</span> — он вернёт числовой ID
              </p>
            </div>

            {/* Users list */}
            {usersLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-6 text-gray-600 text-sm">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Список пуст — никто не имеет доступа к финансовым командам
              </div>
            ) : (
              <div className="space-y-2">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-gray-800/40 border border-gray-700/50"
                  >
                    <div className={`p-1.5 rounded-lg ${user.can_finance ? 'bg-emerald-500/10' : 'bg-gray-700'}`}>
                      {user.can_finance ? (
                        <UserCheck className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <UserX className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">
                        {user.label || `ID: ${user.telegram_user_id}`}
                      </p>
                      <p className="text-xs text-gray-500 font-mono">{user.telegram_user_id}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          user.can_finance
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            : 'bg-gray-700 border-gray-600 text-gray-500'
                        }`}
                      >
                        {user.can_finance ? 'Финансы' : 'Нет доступа'}
                      </span>
                      <button
                        onClick={() => handleToggleFinance(user)}
                        className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
                        title={user.can_finance ? 'Отключить доступ' : 'Включить доступ'}
                      >
                        {user.can_finance ? (
                          <UserX className="w-3.5 h-3.5" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionToggle>

          {/* ── Staff Telegram IDs ── */}
          <SectionToggle
            title="Сотрудники — Telegram ID"
            icon={Users2}
            open={openSections.staff}
            onToggle={() => toggle('staff')}
            badge={staffMembers.filter(s => s.telegram_chat_id).length > 0 ? `${staffMembers.filter(s => s.telegram_chat_id).length} привязано` : undefined}
          >
            <p className="text-xs text-gray-500 mb-4">
              Привяжите Telegram ID к каждому сотруднику чтобы они могли использовать финансовые команды бота по своей роли.
              Узнать ID: написать <span className="text-gray-400">@userinfobot</span> в Telegram.
            </p>

            {staffLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
              </div>
            ) : staffMembers.length === 0 ? (
              <p className="text-sm text-gray-600">Нет сотрудников в системе</p>
            ) : (
              <div className="space-y-2">
                {staffMembers.map((member) => {
                  const roleLabel: Record<string, string> = { owner: 'Владелец', manager: 'Руководитель', marketer: 'Маркетолог', other: 'Другой' }
                  const isEditing = editingStaffId === member.id
                  return (
                    <div key={member.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-800/40 border border-gray-700/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">{member.full_name}</p>
                        <p className="text-xs text-gray-500">{roleLabel[member.role] || member.role}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              value={editingTgId}
                              onChange={(e) => setEditingTgId(e.target.value)}
                              placeholder="Telegram User ID"
                              className="w-36 px-2 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-xs text-gray-200 outline-none focus:border-blue-500/50"
                            />
                            <button
                              onClick={async () => {
                                setStaffSaveLoading(member.id)
                                const res = await fetch('/api/telegram/staff-ids', {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ id: member.id, telegram_chat_id: editingTgId }),
                                })
                                const data = await res.json()
                                setStaffSaveLoading(null)
                                if (res.ok) {
                                  setStaffSaveMsg({ ok: true, text: `Сохранено для ${member.full_name}` })
                                  setEditingStaffId(null)
                                  loadStaff()
                                } else {
                                  setStaffSaveMsg({ ok: false, text: data.error || 'Ошибка' })
                                }
                              }}
                              disabled={staffSaveLoading === member.id}
                              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                            >
                              {staffSaveLoading === member.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Сохранить'}
                            </button>
                            <button
                              onClick={() => setEditingStaffId(null)}
                              className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className={`text-xs font-mono ${member.telegram_chat_id ? 'text-blue-400' : 'text-gray-600'}`}>
                              {member.telegram_chat_id || 'не привязан'}
                            </span>
                            <button
                              onClick={() => { setEditingStaffId(member.id); setEditingTgId(member.telegram_chat_id || '') }}
                              className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
                {staffSaveMsg && (
                  <div className={`text-xs rounded-lg px-3 py-2 ${staffSaveMsg.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                    {staffSaveMsg.text}
                  </div>
                )}
              </div>
            )}
          </SectionToggle>

          {/* ── 3. Webhook ── */}
          {isConfigured && (
            <SectionToggle title="Регистрация вебхука" icon={Webhook} open={openSections.webhook} onToggle={() => toggle('webhook')}>
              <p className="text-xs text-gray-500 mb-3">
                Telegram отправляет сообщения на этот URL. Должен быть публичным HTTPS-адресом.
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
                  {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Webhook className="w-4 h-4" />}
                  Зарегистрировать
                </button>
              </div>
              {setupMsg && (
                <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${setupMsg.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {setupMsg.text}
                </div>
              )}
            </SectionToggle>
          )}

          {/* ── 4. Send Reports ── */}
          {isConfigured && status?.hasChatId && (
            <SectionToggle title="Отправить отчёт в канал" icon={Send} open={openSections.reports} onToggle={() => toggle('reports')}>
              <p className="text-xs text-gray-500 mb-4">
                Ручная отправка финансового отчёта в настроенный Telegram-канал.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => handleSendReport('daily')}
                  disabled={!!reportLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
                >
                  {reportLoading === 'daily' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
                  Дневной отчёт
                </button>
                <button
                  onClick={() => handleSendReport('weekly')}
                  disabled={!!reportLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
                >
                  {reportLoading === 'weekly' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
                  Недельный отчёт
                </button>
              </div>
              {reportMsg && (
                <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${reportMsg.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {reportMsg.text}
                </div>
              )}
            </SectionToggle>
          )}

          {/* ── 5. Commands ── */}
          <SectionToggle title="Команды бота" icon={MessageSquare} open={openSections.commands} onToggle={() => toggle('commands')}>
            <div className="space-y-1.5">
              {[
                { cmd: '/start', desc: 'Начало работы — список команд', locked: false },
                { cmd: '/help', desc: 'Список команд и подсказки', locked: false },
                { cmd: '/today', desc: 'Финансовая сводка за сегодня', locked: true },
                { cmd: '/yesterday', desc: 'Сводка за вчера', locked: true },
                { cmd: '/week', desc: 'Сводка за последние 7 дней', locked: true },
                { cmd: '/month', desc: 'Сводка за последние 30 дней', locked: true },
                { cmd: '/cashflow', desc: 'Баланс и движение денег за 30 дней', locked: true },
                { cmd: '#123 принял', desc: 'Ответ по задаче — взял в работу', locked: false },
                { cmd: '#123 готово', desc: 'Ответ по задаче — завершил', locked: false },
              ].map(({ cmd, desc, locked }) => (
                <div key={cmd} className="flex items-center gap-3 py-1.5 border-b border-gray-800/40 last:border-0">
                  <code className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded font-mono w-32 shrink-0 truncate">
                    {cmd}
                  </code>
                  <span className="text-sm text-gray-400 flex-1">{desc}</span>
                  {locked && (
                    <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded whitespace-nowrap">
                      🔒 доступ
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-600">
              🔒 — требует наличия в списке разрешённых пользователей выше
            </p>
          </SectionToggle>

          {/* ── 6. SQL ── */}
          <SectionToggle title="SQL для Supabase" icon={Settings2} open={openSections.sql} onToggle={() => toggle('sql')}>
            <p className="text-xs text-gray-500 mb-3">
              Выполните этот SQL в Supabase → SQL Editor для создания таблицы разрешённых пользователей.
            </p>
            <div className="relative">
              <pre className="text-xs text-gray-300 bg-gray-800/60 rounded-xl p-4 overflow-x-auto font-mono leading-relaxed border border-gray-700">
                {SQL_TEXT}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(SQL_TEXT)}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white transition-colors"
                title="Скопировать"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </SectionToggle>

        </div>
    </>
  )
}
