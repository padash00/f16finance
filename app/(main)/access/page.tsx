'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { CapabilitiesPanel } from '@/components/admin/capabilities-panel'
import { UserOverridesPanel } from '@/components/admin/user-overrides-panel'
import { supabase } from '@/lib/supabaseClient'
import { useCapabilities } from '@/lib/client/use-capabilities'
import {
  CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2,
  Lock, Pencil, Plus, RefreshCw, Shield, Trash2, Users, X, Briefcase, Save, SlidersHorizontal,
} from 'lucide-react'

// ==================== TYPES ====================
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

// ==================== INDUSTRIAL DESIGN TOKENS ====================
// Тёплый чёрный + 1px-границы + один сигнальный цвет (янтарь), без скруглений.
const SIGNAL = '#FFB800'
const card = 'border border-white/10 bg-white/[0.015]'
const sectionTitle = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40'
const btnNeutral = 'inline-flex items-center gap-1.5 border border-white/15 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/5 disabled:opacity-50'
const btnSignal = 'inline-flex items-center gap-1.5 border border-[#FFB800]/45 bg-[#FFB800]/10 px-3 py-1.5 text-xs font-semibold text-[#FFB800] transition-colors hover:bg-[#FFB800]/20 disabled:opacity-40'
const btnDanger = 'inline-flex items-center gap-1.5 border border-[#FF3B30]/30 bg-[#FF3B30]/10 px-2.5 py-1.5 text-xs text-[#FF3B30] transition-colors hover:bg-[#FF3B30]/20 disabled:opacity-50'
const inputCls = 'border border-white/15 bg-black px-3 py-2 text-sm text-white placeholder-white/25 focus:border-[#FFB800] focus:outline-none'

// ==================== HELPERS ====================
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function accountStateLabel(state: AccountInfo['accountState']) {
  switch (state) {
    case 'active': return { label: 'активен', color: 'text-[#00E676]' }
    case 'invited': return { label: 'приглашён', color: 'text-[#FFB800]' }
    case 'no_account': return { label: 'нет аккаунта', color: 'text-white/40' }
    case 'no_email': return { label: 'нет email', color: 'text-[#FF3B30]' }
  }
}

function posLabel(pos: Position) {
  return pos.is_builtin ? (BUILTIN_LABELS[pos.name] ?? pos.name) : pos.name
}

// ==================== PAGE ====================
export default function AccessPage() {
  const { can } = useCapabilities()
  const [tab, setTab] = useState<'positions' | 'permissions' | 'accounts'>('positions')

  // --- Positions state ---
  const [positions, setPositions] = useState<Position[]>([])
  const [positionsLoading, setPositionsLoading] = useState(true)
  const [posTableExists, setPosTableExists] = useState<boolean | null>(null)
  const [newPosName, setNewPosName] = useState('')
  const [newPosDesc, setNewPosDesc] = useState('')
  const [creatingPos, setCreatingPos] = useState(false)
  const [newPosSeed, setNewPosSeed] = useState<'closed' | 'open' | 'copy_from'>('closed')
  const [newPosCopyFrom, setNewPosCopyFrom] = useState('')
  const [editingPos, setEditingPos] = useState<Position | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [posCopied, setPosCopied] = useState(false)
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
  const [overridesFor, setOverridesFor] = useState<{ userId: string; name: string; role: string | null } | null>(null)

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
        body: JSON.stringify({
          action: 'create',
          name,
          description: newPosDesc.trim() || null,
          seed: newPosSeed,
          copy_from_role: newPosSeed === 'copy_from' ? newPosCopyFrom : undefined,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setPositions(prev => [...prev, data.data])
        setNewPosName('')
        setNewPosDesc('')
        setNewPosSeed('closed')
        setNewPosCopyFrom('')
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
        if (selectedRole === pos.name) setSelectedRole(positions.find(p => p.id !== pos.id)?.name ?? '')
      } else if (data.error === 'in-use') {
        alert(data.message || `Роль используется ${data.count} сотрудниками — переназначьте их сначала через вкладку Аккаунты.`)
      } else {
        alert(data.error || 'Ошибка')
      }
    } catch { alert('Ошибка сети') }
    setDeletingId(null)
  }

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

  const allPositionNames = useMemo(() => positions.map(p => p.name), [positions])

  const TABS = [
    { key: 'positions' as const, icon: Briefcase, label: 'Должности' },
    { key: 'permissions' as const, icon: Lock, label: 'Права' },
    { key: 'accounts' as const, icon: Users, label: 'Аккаунты' },
  ]

  return (
    <div className="app-page-wide space-y-4 font-mono text-white">

      {/* ============ HEADER ============ */}
      <div className={`${card} bg-[#0B0C0A]`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5 md:px-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center border" style={{ borderColor: `${SIGNAL}66`, backgroundColor: `${SIGNAL}1a`, color: SIGNAL }}>
              <Shield className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-[0.22em] text-white">Доступ</h1>
              <p className="mt-0.5 text-[11px] text-white/40">Должности · права · аккаунты сотрудников</p>
            </div>
          </div>
          <Link href="/" className="text-[11px] uppercase tracking-wider text-white/40 transition-colors hover:text-white">
            ← назад
          </Link>
        </div>

        {/* TABS — segmented, sharp, signal-active */}
        <div className="flex flex-wrap" role="tablist" aria-label="Раздел прав доступа">
          {TABS.map(({ key, icon: Icon, label }) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 border-r border-white/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  active ? 'text-black' : 'text-white/45 hover:bg-white/5 hover:text-white/80'
                }`}
                style={active ? { backgroundColor: SIGNAL } : undefined}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ============ TAB: POSITIONS ============ */}
      {tab === 'positions' && (
        <>
          {posTableExists === false && (
            <div className="border border-[#FFB800]/30 bg-[#FFB800]/[0.04] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4" style={{ color: SIGNAL }} />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#FFB800]">Требуются таблицы в Supabase</h2>
              </div>
              <div className="relative">
                <pre className="overflow-x-auto border border-white/10 bg-black p-4 text-[11px] leading-relaxed text-white/70">{SQL_POSITIONS}</pre>
                <button
                  onClick={() => { navigator.clipboard.writeText(SQL_POSITIONS); setPosCopied(true); setTimeout(() => setPosCopied(false), 2000) }}
                  className="absolute right-2 top-2 border border-white/15 bg-black px-2 py-1 text-[11px] text-white/70 hover:bg-white/5"
                >
                  {posCopied ? '✓ скопировано' : 'копировать'}
                </button>
              </div>
            </div>
          )}

          {/* Create new position */}
          {can('access.create_role') && (
          <div className={`${card} p-5`}>
            <h2 className={`${sectionTitle} mb-4 flex items-center gap-2`}>
              <Plus className="h-3.5 w-3.5" style={{ color: SIGNAL }} />
              Создать должность
            </h2>
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                placeholder="Название (напр. бухгалтер)"
                value={newPosName}
                onChange={e => setNewPosName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreatePosition()}
                className={`${inputCls} min-w-40 flex-1`}
              />
              <input
                type="text"
                placeholder="Описание (необязательно)"
                value={newPosDesc}
                onChange={e => setNewPosDesc(e.target.value)}
                className={`${inputCls} min-w-48 flex-1`}
              />
              <button
                onClick={handleCreatePosition}
                disabled={!newPosName.trim() || creatingPos || posTableExists === false || (newPosSeed === 'copy_from' && !newPosCopyFrom)}
                className={btnSignal}
              >
                {creatingPos ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Создать
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-white/35">Стартовые права:</span>
              <select
                value={newPosSeed}
                onChange={e => setNewPosSeed(e.target.value as 'closed' | 'open' | 'copy_from')}
                className="border border-white/15 bg-black px-2 py-1.5 text-xs text-white focus:border-[#FFB800] focus:outline-none"
              >
                <option value="closed">Без прав (настрою сам)</option>
                <option value="open">Полный доступ (все права)</option>
                <option value="copy_from">Скопировать с роли…</option>
              </select>
              {newPosSeed === 'copy_from' && (
                <select
                  value={newPosCopyFrom}
                  onChange={e => setNewPosCopyFrom(e.target.value)}
                  className="border border-white/15 bg-black px-2 py-1.5 text-xs text-white focus:border-[#FFB800] focus:outline-none"
                >
                  <option value="">— выберите роль —</option>
                  {allPositionNames.map(name => (
                    <option key={name} value={name}>{BUILTIN_LABELS[name] ?? name}</option>
                  ))}
                </select>
              )}
              {newPosSeed === 'open' && (
                <span className="text-[11px] text-[#FFB800]/80">⚠ роль получит все права</span>
              )}
            </div>
          </div>
          )}

          {/* Positions list */}
          {positionsLoading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-white/40">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-xs uppercase tracking-wider">Загрузка…</span>
            </div>
          ) : (
            <div className="space-y-px">
              {positions.map(pos => (
                <div key={pos.id} className={`${card} p-4`}>
                  {editingPos?.id === pos.id ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className={`${inputCls} min-w-32 flex-1 py-1.5`}
                      />
                      <input
                        type="text"
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        placeholder="Описание"
                        className={`${inputCls} min-w-48 flex-1 py-1.5`}
                      />
                      <button onClick={handleSaveEdit} disabled={savingEdit} className={btnSignal}>
                        {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Сохранить
                      </button>
                      <button onClick={() => setEditingPos(null)} className="text-white/30 hover:text-white/60">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-8 w-8 shrink-0 place-items-center border" style={{ borderColor: `${SIGNAL}55`, backgroundColor: `${SIGNAL}14`, color: SIGNAL }}>
                          <Briefcase className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-white">{posLabel(pos)}</p>
                            <span className="text-[11px] text-white/35">{pos.name}</span>
                            {pos.is_builtin && (
                              <span className="border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/40">базовая</span>
                            )}
                          </div>
                          {pos.description && <p className="truncate text-xs text-white/40">{pos.description}</p>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => { setTab('permissions'); setSelectedRole(pos.name) }}
                          className={btnNeutral}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Права
                        </button>
                        {can('access.edit_role') && !pos.is_builtin && (
                          <button onClick={() => startEdit(pos)} className="border border-white/15 p-1.5 text-white/50 transition-colors hover:bg-white/5">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {can('access.delete_role') && !pos.is_builtin && (
                          <button
                            onClick={() => handleDeletePosition(pos)}
                            disabled={deletingId === pos.id}
                            className="border border-[#FF3B30]/30 bg-[#FF3B30]/10 p-1.5 text-[#FF3B30] transition-colors hover:bg-[#FF3B30]/20 disabled:opacity-50"
                          >
                            {deletingId === pos.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {positions.length === 0 && !positionsLoading && (
                <div className={`${card} p-8 text-center`}>
                  <p className="text-xs uppercase tracking-wider text-white/40">Должностей пока нет. Создайте первую выше.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ============ TAB: PERMISSIONS (capabilities) ============ */}
      {tab === 'permissions' && (
        <CapabilitiesPanel />
      )}

      {/* ============ TAB: ACCOUNTS ============ */}
      {tab === 'accounts' && (
        <>
          {accountsLoading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-white/40">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-xs uppercase tracking-wider">Загрузка…</span>
            </div>
          ) : (
            <div className="space-y-px">
              {staff.filter(s => s.is_active).map(s => {
                const account = accounts.find(a => a.staffId === s.id)
                const stateInfo = accountStateLabel(account?.accountState ?? 'no_email')
                const genPwd = generatedPasswords.find(p => p.staffId === s.id)

                return (
                  <div key={s.id} className={`${card} p-4`}>
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center border border-white/15 bg-white/5 text-sm font-bold text-white/70">
                          {(s.full_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{s.full_name || 'Без имени'}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            {editingEmailId === s.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="email"
                                  autoFocus
                                  value={editingEmailValue}
                                  onChange={e => setEditingEmailValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEmail(s.id); if (e.key === 'Escape') setEditingEmailId(null) }}
                                  className="w-48 border border-white/15 bg-black px-2 py-1 text-xs text-white focus:border-[#FFB800] focus:outline-none"
                                />
                                <button onClick={() => saveEmail(s.id)} disabled={savingEmailId === s.id} className={btnSignal}>
                                  {savingEmailId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Сохранить'}
                                </button>
                                <button onClick={() => setEditingEmailId(null)} className="text-white/30 hover:text-white/60">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : can('access.change_email') ? (
                              <button
                                onClick={() => { setEditingEmailId(s.id); setEditingEmailValue(s.email || '') }}
                                className="inline-flex items-center gap-1.5 border border-white/15 px-2 py-1 text-xs text-white/60 transition-colors hover:bg-white/5"
                                title="Изменить логин"
                              >
                                <Pencil className="h-3 w-3" />
                                {s.email || 'нет email'}
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 border border-white/10 px-2 py-1 text-xs text-white/50">
                                {s.email || 'нет email'}
                              </span>
                            )}

                            {/* Role / position picker */}
                            {changingRoleId === s.id ? (
                              <div className="flex items-center gap-1">
                                <select
                                  defaultValue={s.role || ''}
                                  onChange={e => saveStaffRole(s.id, e.target.value)}
                                  className="border border-white/15 bg-black px-2 py-1 text-xs text-white focus:border-[#FFB800] focus:outline-none"
                                >
                                  <option value="">— выберите —</option>
                                  {allPositionNames.map(name => (
                                    <option key={name} value={name}>{BUILTIN_LABELS[name] ?? name}</option>
                                  ))}
                                </select>
                                {savingRoleId === s.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
                                <button onClick={() => setChangingRoleId(null)} className="text-white/30 hover:text-white/60">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : can('access.manage_staff_roles') ? (
                              <button
                                onClick={() => setChangingRoleId(s.id)}
                                className="inline-flex items-center gap-1.5 border border-white/15 px-2 py-1 text-xs text-white/60 transition-colors hover:bg-white/5"
                                title="Изменить должность"
                              >
                                <Briefcase className="h-3 w-3" />
                                {s.role ? (BUILTIN_LABELS[s.role] ?? s.role) : 'нет должности'}
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 border border-white/10 px-2 py-1 text-xs text-white/50">
                                <Briefcase className="h-3 w-3" />
                                {s.role ? (BUILTIN_LABELS[s.role] ?? s.role) : 'нет должности'}
                              </span>
                            )}

                            <span className={`text-[11px] font-medium uppercase tracking-wider ${stateInfo.color}`}>{stateInfo.label}</span>
                            {account?.lastSignInAt && (
                              <span className="text-[11px] text-white/30">вход: {fmtDate(account.lastSignInAt)}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {account?.userId && can('access.manage_user_overrides') && (
                          <button
                            onClick={() => setOverridesFor({ userId: account.userId!, name: s.full_name || s.email || 'Сотрудник', role: s.role })}
                            className="inline-flex items-center gap-1.5 border border-white/15 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/5"
                            title="Индивидуальные права (исключения поверх роли)"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            Инд. права
                          </button>
                        )}
                        {s.email && can('access.invite_staff') && (
                          <button onClick={() => sendInvite(s.id)} disabled={sendingInviteId === s.id} className={btnNeutral}>
                            {sendingInviteId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {account?.accountState === 'no_account' || account?.accountState === 'no_email' ? 'Пригласить' : 'Сбросить пароль'}
                          </button>
                        )}
                        {(account?.accountState === 'active' || account?.accountState === 'invited') && can('access.generate_password') && (
                          <button onClick={() => generatePassword(s.id)} disabled={generatingId === s.id} className={btnSignal}>
                            {generatingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                            Новый пароль
                          </button>
                        )}
                      </div>
                    </div>

                    {inviteMessage?.staffId === s.id && (
                      <div className={`mt-3 border p-2.5 text-xs ${inviteMessage.ok ? 'border-[#00E676]/25 bg-[#00E676]/10 text-[#00E676]' : 'border-[#FF3B30]/25 bg-[#FF3B30]/10 text-[#FF3B30]'}`}>
                        {inviteMessage.text}
                      </div>
                    )}

                    {genPwd && (
                      <div className="mt-3 border border-[#FFB800]/25 bg-[#FFB800]/[0.06] p-3">
                        <div className="mb-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#00E676]" />
                            <span className="text-xs font-medium uppercase tracking-wider text-[#00E676]">Новый пароль установлен</span>
                          </div>
                          <button onClick={() => setGeneratedPasswords(prev => prev.filter(p => p.staffId !== s.id))} className="text-white/30 hover:text-white/60">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className={`flex-1 border border-white/15 bg-black px-3 py-1.5 text-sm tracking-widest text-white ${genPwd.visible ? '' : 'select-none blur-sm'}`}>
                            {genPwd.password}
                          </code>
                          {can('access.reveal_password') && (
                            <button
                              onClick={() => setGeneratedPasswords(prev => prev.map(p => p.staffId === s.id ? { ...p, visible: !p.visible } : p))}
                              className="border border-white/15 p-1.5 text-white/50 transition-colors hover:bg-white/5"
                            >
                              {genPwd.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          )}
                          <button
                            onClick={() => navigator.clipboard.writeText(genPwd.password)}
                            className="border border-white/15 p-1.5 text-white/50 transition-colors hover:bg-white/5"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                        <p className="mt-1.5 text-[11px] text-white/40">
                          Аккаунт: <span className="text-white/60">{genPwd.email}</span> · скопируй и передай пользователю.
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}

              {staff.filter(s => s.is_active).length === 0 && (
                <div className={`${card} p-8 text-center`}>
                  <p className="text-xs uppercase tracking-wider text-white/40">Активных сотрудников не найдено</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {overridesFor && (
        <UserOverridesPanel
          userId={overridesFor.userId}
          staffName={overridesFor.name}
          role={overridesFor.role}
          onClose={() => setOverridesFor(null)}
        />
      )}

    </div>
  )
}
