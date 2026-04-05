'use client'

import { useEffect, useState, FormEvent, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { 
  Users2, 
  Plus, 
  ToggleLeft, 
  ToggleRight,
  Search,
  X,
  Edit,
  User,
  Mail,
  Phone,
  Calendar,
  Briefcase,
  MoreVertical,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Award,
  AlertTriangle,
  Star,
  FileText,
  Settings,
  Eye,
  BarChart3,
  PieChart,
  TrendingUp,
  UserPlus,
  Trash2,
  MoreHorizontal,
} from 'lucide-react'

import type { SessionRoleInfo } from '@/lib/core/types'

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
  created_at?: string
  role?: string | null
  telegram_chat_id?: string | null
}

type OperatorProfile = {
  id: string
  operator_id: string
  full_name: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  position: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  photo_url: string | null
}

type OperatorStats = {
  totalShifts: number
  totalTurnover: number
  avgPerShift: number
  totalDebts: number
  totalBonuses: number
}

export default function OperatorsPage() {
  const [operators, setOperators] = useState<Operator[]>([])
  const [profiles, setProfiles] = useState<Map<string, OperatorProfile>>(new Map())
  const [stats, setStats] = useState<Map<string, OperatorStats>>(new Map())
  const [sessionRole, setSessionRole] = useState<SessionRoleInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Форма добавления
  const [name, setName] = useState('')
  const [fullName, setFullName] = useState('')
  const [shortName, setShortName] = useState('')
  const [position, setPosition] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  // Поиск и фильтры
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [selectedOperators, setSelectedOperators] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  // Модальное окно для редактирования
  const [editingOperator, setEditingOperator] = useState<Operator | null>(null)
  const [editName, setEditName] = useState('')
  const [editFullName, setEditFullName] = useState('')
  const [editShortName, setEditShortName] = useState('')
  const [editPosition, setEditPosition] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const canManageOperators = !!sessionRole?.isSuperAdmin || sessionRole?.staffRole === 'owner'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/admin/operators', { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      const rows = Array.isArray(json?.data) ? json.data : []
      const operatorsList: Operator[] = rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        short_name: row.short_name ?? null,
        is_active: Boolean(row.is_active),
        created_at: row.created_at,
        role: row.auth?.role || row.role || null,
        telegram_chat_id: row.telegram_chat_id ?? null,
      }))
      setOperators(operatorsList)

      const profilesMap = new Map<string, OperatorProfile>()
      const statsMap = new Map<string, OperatorStats>()

      rows.forEach((row: any) => {
        const profile = Array.isArray(row.operator_profiles) ? row.operator_profiles[0] || null : row.operator_profiles || null
        if (profile) {
          profilesMap.set(String(row.id), {
            id: profile.id || `${row.id}-profile`,
            operator_id: String(row.id),
            full_name: profile.full_name ?? null,
            phone: profile.phone ?? null,
            email: profile.email ?? null,
            hire_date: profile.hire_date ?? null,
            position: profile.position ?? null,
            emergency_contact_name: profile.emergency_contact_name ?? null,
            emergency_contact_phone: profile.emergency_contact_phone ?? null,
            photo_url: profile.photo_url ?? null,
          })
        }

        const rawStats = row.stats || {}
        statsMap.set(String(row.id), {
          totalShifts: Number(rawStats.totalShifts || 0),
          totalTurnover: Number(rawStats.totalTurnover || 0),
          avgPerShift: Number(rawStats.avgPerShift || 0),
          totalDebts: Number(rawStats.totalDebts || 0),
          totalBonuses: Number(rawStats.totalBonuses || 0),
        })
      })

      setProfiles(profilesMap)
      setStats(statsMap)

    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Ошибка при загрузке данных')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const loadSessionRole = async () => {
      const response = await fetch('/api/auth/session-role', { cache: 'no-store' }).catch(() => null)
      const json = await response?.json().catch(() => null)
      if (!response?.ok) return

      setSessionRole({
        isSuperAdmin: json?.isSuperAdmin,
        staffRole: json?.staffRole,
      })
    }

    loadSessionRole()
  }, [])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    try {
      setSaving(true)
      setError(null)

      const response = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createOperator',
          payload: {
            name: name.trim(),
            full_name: fullName.trim() || null,
            short_name: shortName.trim() || null,
            position: position.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      setSuccess('Оператор успешно добавлен')
      setTimeout(() => setSuccess(null), 3000)

      // Очищаем форму
      setName('')
      setFullName('')
      setShortName('')
      setPosition('')
      setPhone('')
      setEmail('')
      
      // Перезагружаем список
      await load()

    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Ошибка при добавлении оператора')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (op: Operator) => {
    setEditingOperator(op)
    setEditName(op.name)
    setEditFullName(profiles.get(op.id)?.full_name || '')
    setEditShortName(op.short_name || '')
    
    const profile = profiles.get(op.id)
    setEditPosition(profile?.position || '')
    setEditPhone(profile?.phone || '')
    setEditEmail(profile?.email || '')
    
    setShowEditModal(true)
  }

  const saveEdit = async () => {
    if (!editingOperator) return

    try {
      setSaving(true)
      setError(null)

      const response = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateOperator',
          operatorId: editingOperator.id,
          payload: {
            name: editName.trim(),
            full_name: editFullName.trim() || null,
            short_name: editShortName.trim() || null,
            position: editPosition.trim() || null,
            phone: editPhone.trim() || null,
            email: editEmail.trim() || null,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      setSuccess('Оператор успешно обновлен')
      setTimeout(() => setSuccess(null), 3000)
      
      setShowEditModal(false)
      await load()

    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Ошибка при обновлении оператора')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (op: Operator) => {
    try {
      const response = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggleOperatorActive',
          operatorId: op.id,
          is_active: !op.is_active,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      
      await load()
      setSuccess(`Оператор ${op.is_active ? 'деактивирован' : 'активирован'}`)
      setTimeout(() => setSuccess(null), 3000)

    } catch (err) {
      console.error(err)
      setError('Не удалось изменить статус оператора')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Вы уверены, что хотите удалить оператора? Это действие нельзя отменить.')) {
      return
    }

    try {
      const response = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteOperator',
          operatorId: id,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      setSuccess('Оператор удален')
      setTimeout(() => setSuccess(null), 3000)
      await load()

    } catch (err) {
      console.error(err)
      setError('Не удалось удалить оператора')
    }
  }

  const handleBulkDelete = async () => {
    if (selectedOperators.size === 0) return
    
    if (!confirm(`Вы уверены, что хотите удалить ${selectedOperators.size} операторов?`)) {
      return
    }

    try {
      const response = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulkDeleteOperators',
          operatorIds: Array.from(selectedOperators),
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      setSuccess(`Удалено ${selectedOperators.size} операторов`)
      setTimeout(() => setSuccess(null), 3000)
      
      setSelectedOperators(new Set())
      setSelectAll(false)
      await load()

    } catch (err) {
      console.error(err)
      setError('Не удалось удалить операторов')
    }
  }

  // Мемоизированная фильтрация операторов
  const filteredOperators = useMemo(() => {
    return operators.filter(op => {
      const matchesSearch = search === '' || 
        op.name.toLowerCase().includes(search.toLowerCase()) ||
        (profiles.get(op.id)?.full_name?.toLowerCase() || '').includes(search.toLowerCase()) ||
        (op.short_name?.toLowerCase() || '').includes(search.toLowerCase()) ||
        (profiles.get(op.id)?.position?.toLowerCase() || '').includes(search.toLowerCase()) ||
        (profiles.get(op.id)?.email?.toLowerCase() || '').includes(search.toLowerCase())

      const matchesActive = showInactive || op.is_active

      return matchesSearch && matchesActive
    })
  }, [operators, profiles, search, showInactive])

  // Обработка выбора всех - исправлено
  useEffect(() => {
    if (selectAll) {
      // Используем функциональное обновление, чтобы избежать зависимости от filteredOperators
      setSelectedOperators(prev => {
        const newSet = new Set(filteredOperators.map(op => op.id))
        return newSet
      })
    } else {
      setSelectedOperators(prev => new Set())
    }
    // Убираем filteredOperators из зависимостей, так как он вызывает цикл
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectAll])

  // Сброс выбора при изменении фильтров
  useEffect(() => {
    setSelectedOperators(new Set())
    setSelectAll(false)
  }, [search, showInactive])

  // Форматирование чисел
  const formatMoney = useCallback((amount: number) => {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount) + ' ₸'
  }, [])

  return (
    <>
        <div className="app-page max-w-7xl space-y-6">
          <AdminPageHeader
            title="Операторы"
            description="Управление операторами и их профилями"
            accent="violet"
            icon={<Users2 className="h-5 w-5" aria-hidden />}
            actions={
              <Button
                onClick={() => void load()}
                variant="outline"
                size="icon"
                className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10"
                aria-label="Обновить"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            }
          />

          {/* Уведомления */}
          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <p className="text-sm text-rose-200">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-rose-400/50 hover:text-rose-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {success && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-200">{success}</p>
              <button onClick={() => setSuccess(null)} className="ml-auto text-emerald-400/50 hover:text-emerald-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {canManageOperators ? (
            <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" />
                Добавить нового оператора
              </h2>

              <form onSubmit={handleAdd} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Имя оператора <span className="text-rose-400">*</span>
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      placeholder="Например: Маржан"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Полное ФИО
                    </label>
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      placeholder="Например: Жумабекова Маржан Нурлановна"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Краткое имя
                    </label>
                    <input
                      value={shortName}
                      onChange={(e) => setShortName(e.target.value)}
                      className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      placeholder="Напр.: Маржан (день)"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Должность
                    </label>
                    <input
                      value={position}
                      onChange={(e) => setPosition(e.target.value)}
                      className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      placeholder="Напр.: Старший оператор"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Телефон
                    </label>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      placeholder="+7 (777) 777-77-77"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Email
                    </label>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      placeholder="operator@example.com"
                    />
                  </div>

                  <div className="flex items-end">
                    <Button
                      type="submit"
                      disabled={saving || !name.trim()}
                      className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white border-0"
                    >
                      {saving ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Добавление...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Добавить оператора
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          ) : (
            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <p className="text-sm text-gray-400">
                Руководитель может просматривать операторов, открывать профиль и назначать компании/роли по точкам. Создание и удаление операторов доступно только владельцу и супер-админу.
              </p>
            </Card>
          )}

          {/* Поиск и фильтры */}
          <div className="rounded-xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по имени, должности, email..."
                  className="w-full pl-9 pr-9 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/50"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setShowInactive((prev) => !prev)}
                className={`rounded-lg border-white/10 ${
                  showInactive
                    ? 'bg-violet-500/15 text-violet-200 hover:bg-violet-500/20'
                    : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50'
                }`}
              >
                {showInactive ? (
                  <ToggleRight className="w-4 h-4 mr-2 text-violet-300" />
                ) : (
                  <ToggleLeft className="w-4 h-4 mr-2 text-gray-400" />
                )}
                {showInactive ? 'Скрыть неактивных' : 'Показать неактивных'}
              </Button>

              {canManageOperators && selectedOperators.size > 0 && (
                <Button
                  onClick={handleBulkDelete}
                  variant="outline"
                  className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить выбранные ({selectedOperators.size})
                </Button>
              )}
            </div>
          </div>

          {/* Таблица операторов */}
          <Card className="overflow-hidden bg-gray-900/40 backdrop-blur-xl border-white/5 p-0">
            <AdminTableViewport
              maxHeight="min(70vh, 40rem)"
              className="rounded-none border-0 border-b border-white/10 bg-transparent"
            >
              <table className="w-full text-sm">
                <thead className={adminTableStickyTheadClass}>
                  <tr className="border-b border-white/5">
                    <th className="py-3 px-4 w-8">
                      {canManageOperators ? (
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={(e) => setSelectAll(e.target.checked)}
                          className="rounded border-white/10 bg-gray-800/50 text-violet-500 focus:ring-violet-500/20"
                        />
                      ) : null}
                    </th>
                    <th className="py-3 px-4 text-left">Оператор</th>
                    <th className="py-3 px-4 text-left">Контактная информация</th>
                    <th className="py-3 px-4 text-center">Статус</th>
                    <th className="py-3 px-4 text-right">Статистика (30 дней)</th>
                    <th className="py-3 px-4 text-center">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-500">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                        Загрузка операторов...
                      </td>
                    </tr>
                  )}

                  {!loading && filteredOperators.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-500">
                        <Users2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="text-lg font-medium mb-1">Операторы не найдены</p>
                        <p className="text-sm text-gray-600">Добавьте первого оператора с помощью формы выше</p>
                      </td>
                    </tr>
                  )}

                  {!loading && filteredOperators.map((op) => {
                    const profile = profiles.get(op.id)
                    const operatorStats = stats.get(op.id) || {
                      totalShifts: 0,
                      totalTurnover: 0,
                      avgPerShift: 0,
                      totalDebts: 0,
                      totalBonuses: 0,
                    }

                    return (
                      <tr
                        key={op.id}
                        className="border-t border-white/5 hover:bg-white/5 transition-colors"
                      >
                        <td className="py-3 px-4">
                          {canManageOperators ? (
                            <input
                              type="checkbox"
                              checked={selectedOperators.has(op.id)}
                              onChange={(e) => {
                                const newSelected = new Set(selectedOperators)
                                if (e.target.checked) {
                                  newSelected.add(op.id)
                                } else {
                                  newSelected.delete(op.id)
                                }
                                setSelectedOperators(newSelected)
                                setSelectAll(false)
                              }}
                              className="rounded border-white/10 bg-gray-800/50 text-violet-500 focus:ring-violet-500/20"
                            />
                          ) : null}
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/operators/${op.id}/profile`}
                            className="flex items-center gap-3 group"
                          >
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                              {profile?.photo_url ? (
                                <img
                                  src={profile.photo_url}
                                  alt={op.name}
                                  className="w-full h-full rounded-xl object-cover"
                                />
                              ) : (
                                <User className="w-5 h-5 text-white" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate group-hover:text-violet-400 transition-colors">
                                {getOperatorDisplayName({ ...op, full_name: profile?.full_name })}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {op.short_name || op.name || 'Нет краткого имени'}
                                {profile?.position && ` • ${profile.position}`}
                              </p>
                            </div>
                          </Link>
                        </td>
                        <td className="py-3 px-4">
                          <div className="space-y-1">
                            {profile?.phone && (
                              <p className="text-xs flex items-center gap-1 text-gray-400">
                                <Phone className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{profile.phone}</span>
                              </p>
                            )}
                            {profile?.email && (
                              <p className="text-xs flex items-center gap-1 text-gray-400">
                                <Mail className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{profile.email}</span>
                              </p>
                            )}
                            {!profile?.phone && !profile?.email && (
                              <p className="text-xs text-gray-600">Нет данных</p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs whitespace-nowrap ${
                            op.is_active
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                          }`}>
                            {op.is_active ? (
                              <>
                                <CheckCircle className="w-3 h-3" />
                                Активен
                              </>
                            ) : (
                              <>
                                <Clock className="w-3 h-3" />
                                Неактивен
                              </>
                            )}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-emerald-400 whitespace-nowrap">
                              {formatMoney(operatorStats.totalTurnover)}
                            </p>
                            <div className="flex items-center justify-end gap-3 text-xs whitespace-nowrap">
                              <span className="text-gray-500" title="Смен">
                                <Briefcase className="w-3 h-3 inline mr-1" />
                                {operatorStats.totalShifts}
                              </span>
                              <span className="text-gray-500" title="Средняя смена">
                                <TrendingUp className="w-3 h-3 inline mr-1" />
                                {formatMoney(operatorStats.avgPerShift)}
                              </span>
                            </div>
                            {(operatorStats.totalDebts > 0 || operatorStats.totalBonuses > 0) && (
                              <div className="flex items-center justify-end gap-3 text-xs whitespace-nowrap">
                                {operatorStats.totalBonuses > 0 && (
                                  <span className="text-emerald-500" title="Премии">
                                    <Award className="w-3 h-3 inline mr-1" />
                                    +{formatMoney(operatorStats.totalBonuses)}
                                  </span>
                                )}
                                {operatorStats.totalDebts > 0 && (
                                  <span className="text-rose-500" title="Долги">
                                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                                    {formatMoney(operatorStats.totalDebts)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <Link
                              href={`/operators/${op.id}/profile`}
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                              title="Просмотр профиля"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>
                            {canManageOperators ? (
                              <>
                                <button
                                  onClick={() => handleEdit(op)}
                                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                                  title="Редактировать"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => toggleActive(op)}
                                  className={`p-2 hover:bg-white/10 rounded-lg transition-colors ${
                                    op.is_active ? 'text-emerald-400' : 'text-gray-500'
                                  }`}
                                  title={op.is_active ? 'Деактивировать' : 'Активировать'}
                                >
                                  {op.is_active ? (
                                    <ToggleRight className="w-4 h-4" />
                                  ) : (
                                    <ToggleLeft className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleDelete(op.id)}
                                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-rose-400"
                                  title="Удалить"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </AdminTableViewport>

            {/* Footer с итогами */}
            <div className="border-t border-white/5 bg-white/5 px-4 py-3">
              <div className="flex flex-wrap justify-between items-center gap-2 text-sm">
                <span className="text-gray-400">
                  Всего: {filteredOperators.length} операторов
                  {filteredOperators.length !== operators.length && (
                    <span className="text-gray-600 ml-2">
                      (отфильтровано из {operators.length})
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-4">
                  <span className="text-gray-400">
                    Активных: {operators.filter(o => o.is_active).length}
                  </span>
                  <span className="text-gray-400">
                    Неактивных: {operators.filter(o => !o.is_active).length}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Быстрая статистика */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <Users2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Всего операторов</p>
                  <p className="text-xl font-bold">{operators.length}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <Briefcase className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Активных</p>
                  <p className="text-xl font-bold">{operators.filter(o => o.is_active).length}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/20">
                  <User className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">С профилями</p>
                  <p className="text-xl font-bold">{profiles.size}</p>
                </div>
              </div>
            </Card>
          </div>
        </div>

      {/* Модальное окно редактирования */}
      {showEditModal && editingOperator && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-lg font-semibold">Редактировать оператора</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Имя оператора <span className="text-rose-400">*</span>
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Полное ФИО
                </label>
                <input
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Краткое имя
                </label>
                <input
                  value={editShortName}
                  onChange={(e) => setEditShortName(e.target.value)}
                  className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Должность
                </label>
                <input
                  value={editPosition}
                  onChange={(e) => setEditPosition(e.target.value)}
                  className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Телефон
                </label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Email
                </label>
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  type="email"
                  className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                />
              </div>
            </div>

            <div className="p-6 border-t border-white/5 flex justify-end gap-2">
              <Button
                onClick={() => setShowEditModal(false)}
                variant="outline"
                className="border-white/10"
              >
                Отмена
              </Button>
              <Button
                onClick={saveEdit}
                disabled={saving || !editName.trim()}
                className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white border-0"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  'Сохранить'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
