'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Briefcase,
  ExternalLink,
  Lock,
  Loader2,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Position = {
  id: string
  name: string
  label: string | null
  description: string | null
  home_path?: string | null
  summary?: string | null
  is_builtin: boolean
  created_at: string | null
}

type Employee = {
  kind: 'staff' | 'operator'
  id: string
  full_name: string
  role: string | null
  position?: string | null
  is_active: boolean
  dismissed_at: string | null
}

type RoleStats = {
  position: Position
  activeCount: number
  totalCount: number
}

export default function PositionsOverview() {
  const [positions, setPositions] = useState<Position[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [pRes, hrRes] = await Promise.all([
        fetch('/api/admin/positions', { cache: 'no-store' }),
        fetch('/api/admin/hr', { cache: 'no-store' }),
      ])
      const pData = await pRes.json()
      const hrData = await hrRes.json()
      if (!pRes.ok) throw new Error(pData.error || 'Ошибка позиций')
      if (!hrRes.ok) throw new Error(hrData.error || 'Ошибка списка людей')
      setPositions((pData.data || []) as Position[])
      setEmployees((hrData.data || []) as Employee[])
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const stats: RoleStats[] = useMemo(() => {
    return positions.map((p) => {
      let active = 0
      let total = 0
      for (const emp of employees) {
        const empRole = emp.role || emp.position || ''
        if (empRole !== p.name) continue
        total++
        if (!emp.dismissed_at && emp.is_active) active++
      }
      return { position: p, activeCount: active, totalCount: total }
    })
  }, [positions, employees])

  // Сортируем: сначала с активными носителями, потом без
  const sorted = useMemo(
    () => [...stats].sort((a, b) => b.activeCount - a.activeCount),
    [stats],
  )

  const totalActivePeople = useMemo(
    () => employees.filter((e) => !e.dismissed_at && e.is_active).length,
    [employees],
  )

  return (
    <div className="space-y-4">
      {/* Заголовок секции */}
      <Card className="p-5 bg-gradient-to-br from-blue-900/20 via-gray-900 to-indigo-900/20 border-blue-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 ring-1 ring-blue-500/30 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5 text-blue-300" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Должности компании</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {positions.length} ролей · {totalActivePeople} активных сотрудников
              </p>
            </div>
          </div>
          <Link href="/access">
            <Button variant="outline" className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10">
              <Settings className="w-4 h-4 mr-2" />
              Управлять должностями
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </Card>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && positions.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground bg-gray-900/60 border-gray-800">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500 mx-auto mb-2" />
          Загружаем должности…
        </Card>
      ) : positions.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground bg-gray-900/60 border-gray-800">
          <p className="mb-3">Должности ещё не созданы.</p>
          <Link href="/access">
            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600">
              <Plus className="w-4 h-4 mr-2" />
              Создать первую должность
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map(({ position: p, activeCount, totalCount }) => (
            <RoleCard key={p.id} position={p} active={activeCount} total={totalCount} />
          ))}
        </div>
      )}

      {/* Подвал с подсказкой */}
      <Card className="p-3 bg-gray-900/40 border-gray-800/60">
        <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
          <ShieldCheck className="w-3.5 h-3.5 text-gray-600" />
          <span>
            Это обзорная вкладка. Полное управление capabilities и доступными страницами —
          </span>
          <Link href="/access" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
            на странице /access
          </Link>
        </p>
      </Card>
    </div>
  )
}

function RoleCard({ position, active, total }: { position: Position; active: number; total: number }) {
  const dismissed = total - active
  return (
    <Card className="p-4 bg-gray-900/60 border-gray-800 hover:border-indigo-500/30 transition group">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-500/10 ring-1 ring-indigo-500/20 flex items-center justify-center shrink-0">
          <Briefcase className="w-4 h-4 text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-semibold text-white text-sm truncate">{position.label || position.name}</h3>
            <span className="text-[10px] text-gray-500 font-mono">{position.name}</span>
          </div>
          {position.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{position.description}</p>
          )}
        </div>
      </div>

      {/* Статистика: активные / уволенные */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-1.5">
            <Users className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">Активных</span>
          </div>
          <div className="text-base font-bold text-emerald-200 mt-0.5">{active}</div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-gray-800/40 border border-gray-700/50">
          <div className="flex items-center gap-1.5">
            <Users className="w-3 h-3 text-gray-500" />
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Всего</span>
          </div>
          <div className="text-base font-bold text-gray-300 mt-0.5">{total}</div>
        </div>
      </div>

      {/* Действия */}
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-800">
        <Link href="/access" className="flex-1">
          <button className="w-full px-2.5 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 hover:border-gray-600 transition flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3" />
            Настроить права
          </button>
        </Link>
        <Link href={`/hr?role=${encodeURIComponent(position.name)}`}>
          <button
            className="px-2.5 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-400 hover:bg-gray-800 hover:border-gray-600 transition"
            title="Открыть носителей этой роли"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        </Link>
      </div>
    </Card>
  )
}
