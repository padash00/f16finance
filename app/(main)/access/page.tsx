'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'
import {
  ACCESS_PAGE_GROUPS,
  getBuiltinRoleDefaultPaths,
} from '@/lib/core/access'
import {
  CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2,
  Lock, LockOpen, Pencil, Plus, RefreshCw, Shield, Trash2, Users, X, Briefcase, Save,
} from 'lucide-react'

// ==================== TYPES ====================
type Permission = { role: string; path: string; enabled: boolean }
type Position = { id: string; name: string; description: string | null; is_builtin: boolean; created_at: string | null }
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
const BUILTIN_LABELS: Record<string, string> = {
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  owner: 'Владелец',
  other: 'Прочие',
}
const PAGE_GROUPS = ACCESS_PAGE_GROUPS.map((group) => ({
  group: group.group,
  pages: group.pages.map((page) => ({
    path: page.path,
    label: page.label,
  })),
}))


const SQL_POSITIONS = `create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_builtin boolean default false,
  created_at timestamptz default now()
);
insert into positions (name, description, is_builtin) values
  ('owner', 'Владелец — полный доступ', true),
  ('manager', 'Руководитель — оперативное управление', true),
  ('marketer', 'Маркетолог — только задачи', true)
on conflict (name) do nothing;`

const SQL_PERMS = `create table if not exists role_permissions (
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

function posLabel(pos: Position) {
  return pos.is_builtin ? (BUILTIN_LABELS[pos.name] ?? pos.name) : pos.name
}

// ==================== PAGE ====================
export default function AccessPage() {
  const [tab, setTab] = useState<'positions' | 'permissions' | 'accounts'>('positions')

  // --- Positions state ---
  const [positions, setPositions] = useState<Position[]>([])
  const [positionsLoading, setPositionsLoading] = useState(true)
  const [posTableExists, setPosTableExists] = useState<boolean | null>(null)
  const [newPosName, setNewPosName] = useState('')
  const [newPosDesc, setNewPosDesc] = useState('')
  const [creatingPos, setCreatingPos] = useState(false)
  const [editingPos, setEditingPos] = useState<Position | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [posCopied, setPosCopied] = useState(false)

  // --- Permissions state ---
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [permsLoading, setPermsLoading] = useState(true)
  const [permsTableExists, setPermsTableExists] = useState<boolean | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [permsCopied, setPermsCopied] = useState(false)
  const [selectedRole, setSelectedRole] = useState<string>('')

  // --- Accounts state ---
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [generatedPasswords, setGeneratedPasswords] = useState<GeneratedPassword[]>([])
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null)
  const [inviteMessage, setInviteMessage] = useState<{ staffId: string; text: string; ok: boolean } | null>(null)
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null)
  const [editingEmailValue, setEditingEmailValue] = useState('')
  const [savingEmailId, setSavingEmailId] = useState<string | null>(null)
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null)
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null)

  // ---- Load positions ----
  const loadPositions = useCallback(() => {
    setPositionsLoading(true)
    fetch('/api/admin/positions')
      .then(r => r.json())
      .then(data => {
        setPosTableExists(data.tableExists !== false)
        setPositions(data.data ?? [])
        if (!selectedRole && data.data?.length) setSelectedRole(data.data[0].name)
      })
      .catch(() => setPosTableExists(false))
      .finally(() => setPositionsLoading(false))
  }, [selectedRole])

  useEffect(() => { loadPositions() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Load permissions ----
  useEffect(() => {
    setPermsLoading(true)
    fetch('/api/admin/role-permissions')
      .then(r => r.json())
      .then(data => {
        setPermsTableExists(data.tableExists !== false)
        setPermissions(data.data ?? [])
      })
      .catch(() => setPermsTableExists(false))
      .finally(() => setPermsLoading(false))
  }, [])

  // Set default selected role when positions load
  useEffect(() => {
    if (!selectedRole && positions.length > 0) setSelectedRole(positions[0].name)
  }, [positions, selectedRole])

  // ---- Load staff + accounts ----
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    try {
      const { data: staffList } = await supabase
        .from('staff')
        .select('id, full_name, email, role, is_active')
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

  // ---- Position CRUD ----
  const handleCreatePosition = async () => {
    const name = newPosName.trim()
    if (!name) return
    setCreatingPos(true)
    try {
      const res = await fetch('/api/admin/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, description: newPosDesc.trim() || null }),
      })
      const data = await res.json()
      if (data.ok) {
        setPositions(prev => [...prev, data.data])
        setNewPosName('')
        setNewPosDesc('')
      } else {
        alert(data.error || 'Ошибка')
      }
    } catch { alert('Ошибка сети') }
    setCreatingPos(false)
  }

  const startEdit = (pos: Position) => {
    setEditingPos(pos)
    setEditName(pos.name)
    setEditDesc(pos.description || '')
  }

  const handleSaveEdit = async () => {
    if (!editingPos) return
    setSavingEdit(true)
    try {
      const res = await fetch('/api/admin/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: editingPos.id, name: editName.trim(), description: editDesc.trim() || null }),
      })
      const data = await res.json()
      if (data.ok) {
        setPositions(prev => prev.map(p => p.id === editingPos.id ? data.data : p))
        setEditingPos(null)
      } else {
        alert(data.error || 'Ошибка')
      }
    } catch { alert('Ошибка сети') }
    setSavingEdit(false)
  }

  const handleDeletePosition = async (pos: Position) => {
    if (!confirm(`Удалить должность "${posLabel(pos)}"? Все права доступа этой должности тоже удалятся.`)) return
    setDeletingId(pos.id)
    try {
      const res = await fetch('/api/admin/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: pos.id }),
      })
      const data = await res.json()
      if (data.ok) {
        setPositions(prev => prev.filter(p => p.id !== pos.id))
        setPermissions(prev => prev.filter(p => p.role !== pos.name))
        if (selectedRole === pos.name) setSelectedRole(positions.find(p => p.id !== pos.id)?.name ?? '')
      } else {
        alert(data.error || 'Ошибка')
      }
    } catch { alert('Ошибка сети') }
    setDeletingId(null)
  }

  const isEnabled = useCallback((role: string, path: string): boolean => {
  const override = permissions.find(p => p.role === role && p.path === path)
  if (override) return override.enabled

  if (role === 'manager' || role === 'marketer' || role === 'owner') {
    return getBuiltinRoleDefaultPaths(role).includes(path)
  }

  return false
}, [permissions])

  const togglePermission = useCallback(async (role: string, path: string) => {
    const current = isEnabled(role, path)
    const newEnabled = !current
    const key = `${role}:${path}`
    setSavingKey(key)
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
      setPermissions(prev => {
        const filtered = prev.filter(p => !(p.role === role && p.path === path))
        return [...filtered, { role, path, enabled: current }]
      })
    }
    setSavingKey(null)
  }, [isEnabled])

  const bulkToggle = useCallback(async (role: string, enabled: boolean) => {
    const allPaths = PAGE_GROUPS.flatMap(g => g.pages.map(p => p.path))
    setPermissions(prev => {
      const filtered = prev.filter(p => p.role !== role)
      return [...filtered, ...allPaths.map(path => ({ role, path, enabled }))]
    })
    await Promise.all(allPaths.map(path =>
      fetch('/api/admin/role-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, path, enabled }),
      })
    ))
  }, [])

  const resetToDefault = useCallback(async (role: string) => {
  const allPaths = PAGE_GROUPS.flatMap(g => g.pages.map(p => p.path))
  const defaults =
    role === 'manager' || role === 'marketer' || role === 'owner'
      ? getBuiltinRoleDefaultPaths(role)
      : []

  setPermissions(prev => {
    const filtered = prev.filter(p => p.role !== role)
    return [...filtered, ...allPaths.map(path => ({ role, path, enabled: defaults.includes(path) }))]
  })

  await Promise.all(
    allPaths.map(path =>
      fetch('/api/admin/role-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, path, enabled: defaults.includes(path) }),
      })
    )
  )
}, [])

  // ---- Staff role change ----
  const saveStaffRole = useCallback(async (staffId: string, newRole: string) => {
    setSavingRoleId(staffId)
    const member = staff.find(s => s.id === staffId)
    if (!member) { setSavingRoleId(null); return }
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'staff',
          action: 'update',
          id: staffId,
          payload: { name: member.full_name || 'Сотрудник', email: member.email || null, role: newRole },
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setStaff(prev => prev.map(s => s.id === staffId ? { ...s, role: newRole } : s))
        setChangingRoleId(null)
      } else {
        alert(data.error || 'Ошибка')
      }
    } catch { alert('Ошибка сети') }
    setSavingRoleId(null)
  }, [staff])

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

  // ---- Change email ----
  const saveEmail = useCallback(async (staffId: string) => {
    const newEmail = editingEmailValue.trim().toLowerCase()
    if (!newEmail) return
    setSavingEmailId(staffId)
    try {
      const res = await fetch('/api/admin/staff-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'changeEmail', staffId, newEmail }),
      })
      const data = await res.json()
      if (data.ok) {
        setStaff(prev => prev.map(s => s.id === staffId ? { ...s, email: data.email } : s))
        setEditingEmailId(null)
        loadAccounts()
      } else {
        alert(data.error || 'Ошибка')
      }
    } catch { alert('Ошибка сети') }
    setSavingEmailId(null)
  }, [editingEmailValue, loadAccounts])

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

  // ---- Stats ----
  const enabledCount = useMemo(() => {
    const allPaths = PAGE_GROUPS.flatMap(g => g.pages.map(p => p.path))
    return allPaths.filter(path => isEnabled(selectedRole, path)).length
  }, [selectedRole, isEnabled])
  const totalCount = PAGE_GROUPS.flatMap(g => g.pages).length

  const allPositionNames = useMemo(() => positions.map(p => p.name), [positions])

  return (
    <div className="app-page max-w-5xl space-y-5">

      <AdminPageHeader
        title="Права доступа"
        description="Должности, права на страницы и аккаунты сотрудников"
        accent="blue"
        icon={<Shield className="h-5 w-5" aria-hidden />}
        toolbar={
          <div
            className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/20 p-1"
            role="tablist"
            aria-label="Раздел прав доступа"
          >
            {([
              { key: 'positions' as const, icon: Briefcase, label: 'Должности' },
              { key: 'permissions' as const, icon: Lock, label: 'Права доступа' },
              { key: 'accounts' as const, icon: Users, label: 'Аккаунты и пароли' },
            ]).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  tab === key ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {/* ============ TAB: POSITIONS ============ */}
      {tab === 'positions' && (
        <>
          {/* SQL setup notice */}
          {posTableExists === false && (
            <Card className="p-5 bg-yellow-500/5 border border-yellow-500/30">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-yellow-400" />
                <h2 className="text-sm font-semibold text-yellow-300">Требуются таблицы в Supabase</h2>
              </div>
              <p className="text-xs text-gray-400 mb-3">Выполните в Supabase → SQL Editor:</p>
              <div className="relative">
                <pre className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs text-gray-300 overflow-x-auto">{SQL_POSITIONS}</pre>
                <button
                  onClick={() => { navigator.clipboard.writeText(SQL_POSITIONS); setPosCopied(true); setTimeout(() => setPosCopied(false), 2000) }}
                  className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                >
                  {posCopied ? '✓ Скопировано' : 'Копировать'}
                </button>
              </div>
            </Card>
          )}

          {/* Create new position */}
          <Card className="p-5 bg-gray-900/80 border-gray-800">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              Создать новую должность
            </h2>
            <div className="flex gap-3 flex-wrap">
              <input
                type="text"
                placeholder="Название (напр. бухгалтер)"
                value={newPosName}
                onChange={e => setNewPosName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreatePosition()}
                className="flex-1 min-w-40 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="Описание (необязательно)"
                value={newPosDesc}
                onChange={e => setNewPosDesc(e.target.value)}
                className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleCreatePosition}
                disabled={!newPosName.trim() || creatingPos || posTableExists === false}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded-xl text-sm text-emerald-300 font-semibold transition-colors disabled:opacity-40"
              >
                {creatingPos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Создать
              </button>
            </div>
          </Card>

          {/* Positions list */}
          {positionsLoading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Загрузка...</span>
            </div>
          ) : (
            <div className="space-y-2">
              {positions.map(pos => (
                <Card key={pos.id} className="p-4 bg-gray-900/80 border-gray-800">
                  {editingPos?.id === pos.id ? (
                    <div className="flex gap-3 flex-wrap items-center">
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="flex-1 min-w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                      <input
                        type="text"
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        placeholder="Описание"
                        className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={handleSaveEdit}
                        disabled={savingEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 transition-colors"
                      >
                        {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Сохранить
                      </button>
                      <button onClick={() => setEditingPos(null)} className="text-gray-600 hover:text-gray-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${pos.is_builtin ? 'bg-violet-500/20' : 'bg-blue-500/20'}`}>
                          <Briefcase className={`w-4 h-4 ${pos.is_builtin ? 'text-violet-400' : 'text-blue-400'}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-white">{posLabel(pos)}</p>
                            {pos.is_builtin && (
                              <span className="text-xs px-1.5 py-0.5 bg-violet-500/15 border border-violet-500/20 rounded text-violet-400">встроенная</span>
                            )}
                            <span className="text-xs text-gray-600 font-mono">{pos.name}</span>
                          </div>
                          {pos.description && <p className="text-xs text-gray-500 truncate">{pos.description}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => { setTab('permissions'); setSelectedRole(pos.name) }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          Настроить права
                        </button>
                        {!pos.is_builtin && (
                          <>
                            <button
                              onClick={() => startEdit(pos)}
                              className="p-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeletePosition(pos)}
                              disabled={deletingId === pos.id}
                              className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 transition-colors disabled:opacity-50"
                            >
                              {deletingId === pos.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              ))}

              {positions.length === 0 && !positionsLoading && (
                <Card className="p-8 text-center bg-gray-900/80 border-gray-800">
                  <p className="text-sm text-gray-500">Должностей пока нет. Создайте первую выше.</p>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* ============ TAB: PERMISSIONS ============ */}
      {tab === 'permissions' && (
        <>
          {permsTableExists === false && (
            <Card className="p-5 bg-yellow-500/5 border border-yellow-500/30">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-yellow-400" />
                <h2 className="text-sm font-semibold text-yellow-300">Требуется таблица role_permissions в Supabase</h2>
              </div>
              <div className="relative">
                <pre className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs text-gray-300 overflow-x-auto">{SQL_PERMS}</pre>
                <button
                  onClick={() => { navigator.clipboard.writeText(SQL_PERMS); setPermsCopied(true); setTimeout(() => setPermsCopied(false), 2000) }}
                  className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg"
                >
                  {permsCopied ? '✓ Скопировано' : 'Копировать'}
                </button>
              </div>
            </Card>
          )}

          {permsLoading || positionsLoading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Загрузка...</span>
            </div>
          ) : (
            <>
              {/* Position selector */}
              <div className="flex gap-2 flex-wrap">
                {positions.map(pos => {
                  const allPaths = PAGE_GROUPS.flatMap(g => g.pages.map(p => p.path))
                  const count = allPaths.filter(path => isEnabled(pos.name, path)).length
                  const isSelected = selectedRole === pos.name
                  return (
                    <button
                      key={pos.id}
                      onClick={() => setSelectedRole(pos.name)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                        isSelected
                          ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                          : 'bg-gray-900/50 border-gray-700 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {posLabel(pos)}
                      <span className={`text-xs px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-white/10' : 'bg-gray-800'}`}>
                        {count}/{totalCount}
                      </span>
                    </button>
                  )
                })}
              </div>

              {selectedRole && (
                <>
                  {/* Info + bulk actions */}
                  <div className="flex items-center gap-3 text-sm text-gray-400 flex-wrap">
                    <LockOpen className="w-4 h-4 text-emerald-400" />
                    <span>Доступно страниц: <span className="text-white font-semibold">{enabledCount}</span> из <span className="text-white font-semibold">{totalCount}</span></span>
                    <span className="flex items-center gap-2 ml-2 flex-wrap">
                      <button
                        onClick={() => bulkToggle(selectedRole, true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg text-xs text-emerald-300 transition-colors"
                      >
                        <LockOpen className="w-3.5 h-3.5" /> Включить всё
                      </button>
                      <button
                        onClick={() => bulkToggle(selectedRole, false)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs text-red-300 transition-colors"
                      >
                        <Lock className="w-3.5 h-3.5" /> Выключить всё
                      </button>
                      {(selectedRole === 'manager' || selectedRole === 'marketer' || selectedRole === 'owner') && (
  <button
    onClick={() => resetToDefault(selectedRole)}
    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
  >
    <RefreshCw className="w-3.5 h-3.5" /> Сбросить к стандарту
  </button>
)}
                    </span>
                  </div>

                  {/* Pages grid — ALL pages are toggleable */}
                  <div className="space-y-4">
                    {PAGE_GROUPS.map(group => (
                      <Card key={group.group} className="p-4 bg-gray-900/80 border-gray-800">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{group.group}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {group.pages.map(page => {
                            const enabled = isEnabled(selectedRole, page.path)
                            const key = `${selectedRole}:${page.path}`
                            const isSaving = savingKey === key
                            return (
                              <div
                                key={page.path}
                                className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${
                                  enabled ? 'bg-gray-800/60 border-gray-700' : 'bg-gray-900/40 border-gray-800 opacity-60'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {enabled
                                    ? <LockOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    : <Lock className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                                  }
                                  <div className="min-w-0">
                                    <p className="text-sm text-gray-200 truncate">{page.label}</p>
                                    <p className="text-xs text-gray-600">{page.path}</p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => togglePermission(selectedRole, page.path)}
                                  disabled={isSaving}
                                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                                    enabled ? 'bg-emerald-500' : 'bg-gray-700'
                                  } ${isSaving ? 'opacity-50' : 'cursor-pointer'}`}
                                >
                                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              )}
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
              {staff.filter(s => s.is_active).map(s => {
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
                            {editingEmailId === s.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="email"
                                  autoFocus
                                  value={editingEmailValue}
                                  onChange={e => setEditingEmailValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEmail(s.id); if (e.key === 'Escape') setEditingEmailId(null) }}
                                  className="text-xs bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-white w-48 focus:outline-none focus:border-blue-500"
                                />
                                <button
                                  onClick={() => saveEmail(s.id)}
                                  disabled={savingEmailId === s.id}
                                  className="px-2 py-1 text-xs bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 rounded-lg text-blue-300 transition-colors disabled:opacity-50"
                                >
                                  {savingEmailId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Сохранить'}
                                </button>
                                <button onClick={() => setEditingEmailId(null)} className="text-gray-600 hover:text-gray-400">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setEditingEmailId(s.id); setEditingEmailValue(s.email || '') }}
                                className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
                                title="Изменить логин"
                              >
                                <Pencil className="w-3 h-3" />
                                {s.email || 'нет email'}
                              </button>
                            )}

                            {/* Role / position picker */}
                            {changingRoleId === s.id ? (
                              <div className="flex items-center gap-1">
                                <select
                                  defaultValue={s.role || ''}
                                  onChange={e => saveStaffRole(s.id, e.target.value)}
                                  className="text-xs bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                >
                                  <option value="">— выберите —</option>
                                  {allPositionNames.map(name => (
                                    <option key={name} value={name}>{BUILTIN_LABELS[name] ?? name}</option>
                                  ))}
                                </select>
                                {savingRoleId === s.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                                <button onClick={() => setChangingRoleId(null)} className="text-gray-600 hover:text-gray-400">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setChangingRoleId(s.id)}
                                className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
                                title="Изменить должность"
                              >
                                <Briefcase className="w-3 h-3" />
                                {s.role ? (BUILTIN_LABELS[s.role] ?? s.role) : 'нет должности'}
                              </button>
                            )}

                            <span className={`text-xs font-medium ${stateInfo.color}`}>{stateInfo.label}</span>
                            {account?.lastSignInAt && (
                              <span className="text-xs text-gray-600">вход: {fmtDate(account.lastSignInAt)}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {s.email && (
                          <button
                            onClick={() => sendInvite(s.id)}
                            disabled={sendingInviteId === s.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors disabled:opacity-50"
                          >
                            {sendingInviteId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            {account?.accountState === 'no_account' || account?.accountState === 'no_email' ? 'Пригласить' : 'Сбросить пароль (email)'}
                          </button>
                        )}
                        {(account?.accountState === 'active' || account?.accountState === 'invited') && (
                          <button
                            onClick={() => generatePassword(s.id)}
                            disabled={generatingId === s.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-lg text-xs text-blue-300 transition-colors disabled:opacity-50"
                          >
                            {generatingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                            Новый пароль
                          </button>
                        )}
                      </div>
                    </div>

                    {inviteMessage?.staffId === s.id && (
                      <div className={`mt-3 p-2.5 rounded-lg text-xs ${inviteMessage.ok ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
                        {inviteMessage.text}
                      </div>
                    )}

                    {genPwd && (
                      <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-xs text-emerald-300 font-medium">Новый пароль установлен</span>
                          </div>
                          <button onClick={() => setGeneratedPasswords(prev => prev.filter(p => p.staffId !== s.id))} className="text-gray-600 hover:text-gray-400">
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
                            onClick={() => navigator.clipboard.writeText(genPwd.password)}
                            className="p-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 transition-colors"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5">
                          Аккаунт: <span className="text-gray-400">{genPwd.email}</span> · Скопируй и передай пользователю.
                        </p>
                      </div>
                    )}
                  </Card>
                )
              })}

              {staff.filter(s => s.is_active).length === 0 && (
                <Card className="p-8 bg-gray-900/80 border-gray-800 text-center">
                  <p className="text-sm text-gray-500">Активных сотрудников не найдено</p>
                </Card>
              )}
            </div>
          )}
        </>
      )}

    </div>
  )
}
