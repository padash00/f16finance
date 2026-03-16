'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'
import {
  CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2,
  Lock, LockOpen, RefreshCw, Shield, Users, X,
} from 'lucide-react'

// ==================== TYPES ====================
type RoleKey = 'manager' | 'marketer' | 'owner'
type Permission = { role: string; path: string; enabled: boolean }
type StaffRow = {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
  is_active: boolean
}
type AccountInfo = {
  staffId: string
  accountState: 'no_email' | 'no_account' | 'invited' | 'active'
  userId: string | null
  lastSignInAt: string | null
  emailConfirmedAt: string | null
}
type GeneratedPassword = {
  staffId: string
  password: string
  email: string
  visible: boolean
}

// ==================== CONSTANTS ====================
const ROLE_LABELS: Record<RoleKey, string> = {
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  owner: 'Владелец',
}

const ROLE_COLORS: Record<RoleKey, string> = {
  manager: 'blue',
  marketer: 'purple',
  owner: 'amber',
}

// All pages with labels — grouped
const PAGE_GROUPS: { group: string; pages: { path: string; label: string }[] }[] = [
  {
    group: 'Финансы',
    pages: [
      { path: '/income', label: 'Доходы' },
      { path: '/income/add', label: 'Добавить доход' },
      { path: '/income/analytics', label: 'Аналитика доходов' },
      { path: '/expenses', label: 'Расходы' },
      { path: '/expenses/add', label: 'Добавить расход' },
      { path: '/expenses/analysis', label: 'Анализ расходов' },
      { path: '/cashflow', label: 'Cash Flow' },
      { path: '/salary', label: 'Зарплата' },
      { path: '/reports', label: 'Отчёты' },
      { path: '/analysis', label: 'Аналитика' },
      { path: '/weekly-report', label: 'Недельный отчёт' },
      { path: '/tax', label: 'Налоги' },
      { path: '/profitability', label: 'Рентабельность' },
      { path: '/categories', label: 'Категории расходов' },
    ],
  },
  {
    group: 'AI и прогнозы',
    pages: [
      { path: '/forecast', label: 'AI Прогноз' },
      { path: '/ratings', label: 'Рейтинг операторов' },
      { path: '/goals', label: 'Цели и план' },
    ],
  },
  {
    group: 'Операторы',
    pages: [
      { path: '/operators', label: 'Операторы' },
      { path: '/operator-analytics', label: 'Аналитика операторов' },
      { path: '/kpi', label: 'KPI' },
      { path: '/tasks', label: 'Задачи' },
      { path: '/shifts', label: 'Смены' },
    ],
  },
  {
    group: 'Команда',
    pages: [
      { path: '/staff', label: 'Сотрудники' },
      { path: '/structure', label: 'Структура' },
      { path: '/birthdays', label: 'Дни рождения' },
    ],
  },
]

// Default paths per role (from access.ts)
const DEFAULT_PATHS: Record<RoleKey, string[]> = {
  manager: [
    '/income', '/income/add', '/income/analytics', '/expenses', '/expenses/add',
    '/expenses/analysis', '/cashflow', '/forecast', '/ratings', '/goals',
    '/weekly-report', '/birthdays', '/structure', '/operators', '/shifts',
    '/salary', '/tasks',
  ],
  marketer: ['/tasks'],
  owner: [
    '/income', '/income/add', '/income/analytics', '/expenses', '/expenses/add',
    '/expenses/analysis', '/cashflow', '/forecast', '/ratings', '/goals',
    '/categories', '/tax', '/profitability', '/reports', '/analysis',
    '/weekly-report', '/birthdays', '/structure', '/salary', '/operators',
    '/operator-analytics', '/staff', '/kpi', '/tasks', '/shifts',
  ],
}

const SQL_SCRIPT = `create table if not exists role_permissions (
  role text not null,
  path text not null,
  enabled boolean default true,
  primary key (role, path)
);`

// ==================== HELPERS ====================
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function accountStateLabel(state: AccountInfo['accountState']) {
  switch (state) {
    case 'active': return { label: 'Активен', color: 'text-emerald-400' }
    case 'invited': return { label: 'Приглашён', color: 'text-amber-400' }
    case 'no_account': return { label: 'Нет аккаунта', color: 'text-gray-500' }
    case 'no_email': return { label: 'Нет email', color: 'text-red-400' }
  }
}

// ==================== PAGE ====================
export default function AccessPage() {
  const [tab, setTab] = useState<'permissions' | 'accounts'>('permissions')

  // --- Permissions state ---
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [permsLoading, setPermsLoading] = useState(true)
  const [tableExists, setTableExists] = useState<boolean | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [selectedRole, setSelectedRole] = useState<RoleKey>('manager')

  // --- Accounts state ---
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [generatedPasswords, setGeneratedPasswords] = useState<GeneratedPassword[]>([])
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null)
  const [inviteMessage, setInviteMessage] = useState<{ staffId: string; text: string; ok: boolean } | null>(null)

  // ---- Load permissions ----
  useEffect(() => {
    setPermsLoading(true)
    fetch('/api/admin/role-permissions')
      .then(r => r.json())
      .then(data => {
        setTableExists(data.tableExists !== false)
        setPermissions(data.data ?? [])
      })
      .catch(() => setTableExists(false))
      .finally(() => setPermsLoading(false))
  }, [])

  // ---- Load staff + accounts ----
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    try {
      const { data: staffList } = await supabase
        .from('staff')
        .select('id, full_name, email, role, is_active')
        .eq('is_active', true)
        .order('full_name')
      setStaff(staffList ?? [])

      if (!staffList || staffList.length === 0) return

      const ids = staffList.map((s: StaffRow) => s.id).join(',')
      const accountRes = await fetch(`/api/admin/staff-accounts?staffIds=${ids}`).then(r => r.json())
      setAccounts(accountRes.items ?? [])
    } catch {}
    setAccountsLoading(false)
  }, [])

  useEffect(() => {
    if (tab === 'accounts') loadAccounts()
  }, [tab, loadAccounts])

  // ---- Permission helpers ----
  const isEnabled = useCallback((role: RoleKey, path: string): boolean => {
    const override = permissions.find(p => p.role === role && p.path === path)
    if (override) return override.enabled
    // default: check if path is in the default list for this role
    return DEFAULT_PATHS[role].includes(path)
  }, [permissions])

  const togglePermission = useCallback(async (role: RoleKey, path: string) => {
    const current = isEnabled(role, path)
    const newEnabled = !current
    const key = `${role}:${path}`
    setSavingKey(key)

    // Optimistic update
    setPermissions(prev => {
      const filtered = prev.filter(p => !(p.role === role && p.path === path))
      return [...filtered, { role, path, enabled: newEnabled }]
    })

    try {
      await fetch('/api/admin/role-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, path, enabled: newEnabled }),
      })
    } catch {
      // Revert on error
      setPermissions(prev => {
        const filtered = prev.filter(p => !(p.role === role && p.path === path))
        return [...filtered, { role, path, enabled: current }]
      })
    }
    setSavingKey(null)
  }, [isEnabled])

  // ---- Password generation ----
  const generatePassword = useCallback(async (staffId: string) => {
    setGeneratingId(staffId)
    try {
      const res = await fetch('/api/admin/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId }),
      })
      const data = await res.json()
      if (data.password) {
        setGeneratedPasswords(prev => {
          const filtered = prev.filter(p => p.staffId !== staffId)
          return [...filtered, { staffId, password: data.password, email: data.email, visible: true }]
        })
      }
    } catch {}
    setGeneratingId(null)
  }, [])

  // ---- Invite ----
  const sendInvite = useCallback(async (staffId: string) => {
    setSendingInviteId(staffId)
    setInviteMessage(null)
    try {
      const res = await fetch('/api/admin/staff-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inviteStaffAccount', staffId }),
      })
      const data = await res.json()
      setInviteMessage({ staffId, text: data.message || data.error || 'Готово', ok: !!data.ok })
      if (data.ok) loadAccounts()
    } catch {
      setInviteMessage({ staffId, text: 'Ошибка отправки', ok: false })
    }
    setSendingInviteId(null)
    setTimeout(() => setInviteMessage(null), 5000)
  }, [loadAccounts])

  // ---- Compute stats for selected role ----
  const enabledCount = useMemo(() => {
    const allPaths = PAGE_GROUPS.flatMap(g => g.pages.map(p => p.path))
    return allPaths.filter(path => isEnabled(selectedRole, path)).length
  }, [selectedRole, isEnabled])

  const totalCount = PAGE_GROUPS.flatMap(g => g.pages).length

  return (
    <div className="app-shell-layout bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />
      <main className="app-main">
        <div className="app-page max-w-5xl space-y-5">

          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900/60 via-gray-900 to-blue-900/20 p-6 border border-slate-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-slate-600 rounded-full blur-3xl opacity-10 pointer-events-none" />
            <div className="flex items-center gap-3 relative z-10">
              <div className="p-3 bg-slate-500/20 rounded-xl">
                <Shield className="w-8 h-8 text-slate-300" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  Права доступа
                </h1>
                <p className="text-sm text-gray-400">Управление разрешениями ролей и паролями сотрудников</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 p-1 bg-gray-900/80 border border-gray-800 rounded-xl w-fit">
            <button
              onClick={() => setTab('permissions')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === 'permissions' ? 'bg-slate-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Lock className="w-4 h-4" />
              Права ролей
            </button>
            <button
              onClick={() => setTab('accounts')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === 'accounts' ? 'bg-slate-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Users className="w-4 h-4" />
              Аккаунты и пароли
            </button>
          </div>

          {/* ============ TAB: PERMISSIONS ============ */}
          {tab === 'permissions' && (
            <>
              {/* SQL setup */}
              {tableExists === false && (
                <Card className="p-5 bg-yellow-500/5 border border-yellow-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-yellow-400" />
                    <h2 className="text-sm font-semibold text-yellow-300">Требуется таблица в Supabase</h2>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">Выполните в Supabase → SQL Editor:</p>
                  <div className="relative">
                    <pre className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs text-gray-300 overflow-x-auto">{SQL_SCRIPT}</pre>
                    <button
                      onClick={() => { navigator.clipboard.writeText(SQL_SCRIPT); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                      className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                    >
                      {copied ? '✓ Скопировано' : 'Копировать'}
                    </button>
                  </div>
                </Card>
              )}

              {permsLoading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Загрузка...</span>
                </div>
              ) : (
                <>
                  {/* Role selector */}
                  <div className="flex gap-2">
                    {(Object.keys(ROLE_LABELS) as RoleKey[]).map(role => (
                      <button
                        key={role}
                        onClick={() => setSelectedRole(role)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                          selectedRole === role
                            ? role === 'manager' ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                              : role === 'marketer' ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                              : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                            : 'bg-gray-900/50 border-gray-700 text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {ROLE_LABELS[role]}
                      </button>
                    ))}
                  </div>

                  {/* Info bar */}
                  <div className="flex items-center gap-3 text-sm text-gray-400">
                    <LockOpen className="w-4 h-4 text-emerald-400" />
                    <span>Доступно страниц: <span className="text-white font-semibold">{enabledCount}</span> из <span className="text-white font-semibold">{totalCount}</span></span>
                    <span className="text-gray-600">·</span>
                    <span className="text-xs text-gray-500">Изменения вступают в силу при следующем входе пользователя</span>
                  </div>

                  {/* Pages grid */}
                  <div className="space-y-4">
                    {PAGE_GROUPS.map(group => {
                      const inDefault = group.pages.filter(p => DEFAULT_PATHS[selectedRole].includes(p.path))
                      if (inDefault.length === 0 && selectedRole !== 'owner') return null
                      return (
                        <Card key={group.group} className="p-4 bg-gray-900/80 border-gray-800">
                          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{group.group}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {group.pages.map(page => {
                              const inRoleDefault = DEFAULT_PATHS[selectedRole].includes(page.path)
                              const enabled = isEnabled(selectedRole, page.path)
                              const key = `${selectedRole}:${page.path}`
                              const isSaving = savingKey === key

                              return (
                                <div
                                  key={page.path}
                                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${
                                    enabled
                                      ? 'bg-gray-800/60 border-gray-700'
                                      : 'bg-gray-900/40 border-gray-800 opacity-50'
                                  } ${!inRoleDefault ? 'opacity-30' : ''}`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {enabled
                                      ? <LockOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                      : <Lock className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                    }
                                    <div className="min-w-0">
                                      <p className="text-sm text-gray-200 truncate">{page.label}</p>
                                      <p className="text-xs text-gray-600">{page.path}</p>
                                    </div>
                                  </div>
                                  {inRoleDefault ? (
                                    <button
                                      onClick={() => togglePermission(selectedRole, page.path)}
                                      disabled={isSaving}
                                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                                        enabled ? 'bg-emerald-500' : 'bg-gray-700'
                                      } ${isSaving ? 'opacity-50' : 'cursor-pointer'}`}
                                    >
                                      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                  ) : (
                                    <span className="text-xs text-gray-700">нет доступа</span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {/* ============ TAB: ACCOUNTS ============ */}
          {tab === 'accounts' && (
            <>
              {accountsLoading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Загрузка...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {staff.filter(s => s.role !== 'other' && s.is_active).map(s => {
                    const account = accounts.find(a => a.staffId === s.id)
                    const stateInfo = accountStateLabel(account?.accountState ?? 'no_email')
                    const genPwd = generatedPasswords.find(p => p.staffId === s.id)

                    return (
                      <Card key={s.id} className="p-4 bg-gray-900/80 border-gray-800">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 bg-slate-700 rounded-xl flex items-center justify-center text-sm font-bold text-slate-300 shrink-0">
                              {(s.full_name || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{s.full_name || 'Без имени'}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-gray-500">{s.email || 'нет email'}</span>
                                {s.role && (
                                  <span className="text-xs px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">
                                    {ROLE_LABELS[s.role as RoleKey] ?? s.role}
                                  </span>
                                )}
                                <span className={`text-xs font-medium ${stateInfo.color}`}>{stateInfo.label}</span>
                                {account?.lastSignInAt && (
                                  <span className="text-xs text-gray-600">вход: {fmtDate(account.lastSignInAt)}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Invite / Reset */}
                            {s.email && (
                              <button
                                onClick={() => sendInvite(s.id)}
                                disabled={sendingInviteId === s.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors disabled:opacity-50"
                              >
                                {sendingInviteId === s.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <RefreshCw className="w-3.5 h-3.5" />
                                }
                                {account?.accountState === 'no_account' || account?.accountState === 'no_email' ? 'Пригласить' : 'Сбросить пароль (email)'}
                              </button>
                            )}

                            {/* Generate password */}
                            {account?.accountState === 'active' || account?.accountState === 'invited' ? (
                              <button
                                onClick={() => generatePassword(s.id)}
                                disabled={generatingId === s.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-lg text-xs text-blue-300 transition-colors disabled:opacity-50"
                              >
                                {generatingId === s.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <KeyRound className="w-3.5 h-3.5" />
                                }
                                Новый пароль
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {/* Invite message */}
                        {inviteMessage?.staffId === s.id && (
                          <div className={`mt-3 p-2.5 rounded-lg text-xs ${inviteMessage.ok ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
                            {inviteMessage.text}
                          </div>
                        )}

                        {/* Generated password display */}
                        {genPwd && (
                          <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-xs text-emerald-300 font-medium">Новый пароль установлен</span>
                              </div>
                              <button
                                onClick={() => setGeneratedPasswords(prev => prev.filter(p => p.staffId !== s.id))}
                                className="text-gray-600 hover:text-gray-400"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className={`flex-1 text-sm font-mono bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-700 text-white tracking-widest ${genPwd.visible ? '' : 'blur-sm select-none'}`}>
                                {genPwd.password}
                              </code>
                              <button
                                onClick={() => setGeneratedPasswords(prev => prev.map(p => p.staffId === s.id ? { ...p, visible: !p.visible } : p))}
                                className="p-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 transition-colors"
                              >
                                {genPwd.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => { navigator.clipboard.writeText(genPwd.password); }}
                                className="p-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 transition-colors"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1.5">
                              Аккаунт: <span className="text-gray-400">{genPwd.email}</span> · Скопируй и передай пользователю. Пароль показывается один раз.
                            </p>
                          </div>
                        )}
                      </Card>
                    )
                  })}

                  {staff.filter(s => s.role !== 'other' && s.is_active).length === 0 && (
                    <Card className="p-8 bg-gray-900/80 border-gray-800 text-center">
                      <p className="text-sm text-gray-500">Сотрудники не найдены</p>
                    </Card>
                  )}
                </div>
              )}
            </>
          )}

        </div>
      </main>
    </div>
  )
}
