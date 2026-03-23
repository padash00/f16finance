'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PackageSearch, RefreshCw, AlertTriangle, TrendingDown, Clock, CheckCircle2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCompanies } from '@/hooks/use-companies'
import { InventoryLegacyRedirect } from '../legacy-redirect'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ForecastItem = {
  item_id: string
  name: string
  category: string | null
  balance: number
  daily_velocity: number
  days_left: number | null
  threshold: number | null
  status: 'critical' | 'warning' | 'low' | 'ok' | 'no_sales'
}

type Location = {
  id: string
  name: string
  location_type: string
  company_id: string | null
}

type FilterStatus = 'all' | 'critical' | 'warning' | 'low' | 'ok' | 'no_sales'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function statusLabel(status: ForecastItem['status']) {
  switch (status) {
    case 'critical': return 'Критично'
    case 'warning': return 'Мало'
    case 'low': return 'Предупреждение'
    case 'ok': return 'В порядке'
    case 'no_sales': return 'Нет продаж'
  }
}

function statusBadgeClass(status: ForecastItem['status']) {
  switch (status) {
    case 'critical': return 'bg-red-500/20 text-red-300 border-red-500/30'
    case 'warning': return 'bg-orange-500/20 text-orange-300 border-orange-500/30'
    case 'low': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
    case 'ok': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    case 'no_sales': return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }
}

function rowBgClass(status: ForecastItem['status']) {
  switch (status) {
    case 'critical': return 'bg-red-500/5'
    case 'warning': return 'bg-orange-500/5'
    case 'low': return 'bg-yellow-500/5'
    case 'no_sales': return 'bg-gray-500/5'
    default: return ''
  }
}

function daysLeftColor(daysLeft: number | null) {
  if (daysLeft === null) return 'text-gray-400'
  if (daysLeft <= 3) return 'text-red-400 font-bold'
  if (daysLeft <= 7) return 'text-orange-400 font-semibold'
  if (daysLeft <= 14) return 'text-yellow-400'
  return 'text-emerald-400'
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function InventoryForecastPageContent() {
  const { companies } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [forecast, setForecast] = useState<ForecastItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')

  // Load locations when company changes
  useEffect(() => {
    setLocationId('')
    if (!companyId) {
      setLocations([])
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/api/admin/inventory?action=locations&company_id=${companyId}`)
        const j = await res.json()
        setLocations(j.data?.locations || [])
      } catch {
        setLocations([])
      }
    })()
  }, [companyId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (companyId) params.set('company_id', companyId)
      if (locationId) params.set('location_id', locationId)
      const res = await fetch(`/api/admin/inventory/forecast?${params.toString()}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Ошибка загрузки')
      setForecast(j.data || [])
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить прогноз')
    } finally {
      setLoading(false)
    }
  }, [companyId, locationId])

  useEffect(() => {
    void load()
  }, [load])

  // Summary counts
  const counts = {
    critical: forecast.filter(f => f.status === 'critical').length,
    warning: forecast.filter(f => f.status === 'warning').length,
    low: forecast.filter(f => f.status === 'low').length,
    ok: forecast.filter(f => f.status === 'ok').length,
    no_sales: forecast.filter(f => f.status === 'no_sales').length,
  }

  const filtered = filterStatus === 'all' ? forecast : forecast.filter(f => f.status === filterStatus)

  const filterButtons: { key: FilterStatus; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'critical', label: 'Критично' },
    { key: 'warning', label: 'Мало' },
    { key: 'ok', label: 'В порядке' },
    { key: 'no_sales', label: 'Нет продаж' },
  ]

  return (
    <div className="app-page">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageSearch className="h-6 w-6 text-emerald-400" />
            Прогноз остатков
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Основано на продажах за последние 30 дней</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {companies.length > 0 && (
            <Select value={companyId || '__all'} onValueChange={v => setCompanyId(v === '__all' ? '' : v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Все компании" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Все компании</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {locations.length > 0 && (
            <Select value={locationId || '__all'} onValueChange={v => setLocationId(v === '__all' ? '' : v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Все локации" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Все локации</SelectItem>
                {locations.map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          className="cursor-pointer hover:ring-1 hover:ring-red-500/40 transition-all"
          onClick={() => setFilterStatus(filterStatus === 'critical' ? 'all' : 'critical')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Критично (≤3 дней)</p>
              <p className="mt-0.5 text-2xl font-bold text-red-400">{counts.critical}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:ring-1 hover:ring-yellow-500/40 transition-all"
          onClick={() => setFilterStatus(filterStatus === 'warning' ? 'all' : 'warning')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
              <TrendingDown className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Мало (≤7 дней)</p>
              <p className="mt-0.5 text-2xl font-bold text-yellow-400">{counts.warning}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:ring-1 hover:ring-orange-500/40 transition-all"
          onClick={() => setFilterStatus(filterStatus === 'low' ? 'all' : 'low')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-500/10">
              <Clock className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Предупреждение (≤14 дней)</p>
              <p className="mt-0.5 text-2xl font-bold text-orange-400">{counts.low}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:ring-1 hover:ring-emerald-500/40 transition-all"
          onClick={() => setFilterStatus(filterStatus === 'ok' ? 'all' : 'ok')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">В порядке (&gt;14 дней)</p>
              <p className="mt-0.5 text-2xl font-bold text-emerald-400">{counts.ok}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter buttons */}
      <div className="mb-4 flex flex-wrap gap-2">
        {filterButtons.map(btn => (
          <button
            key={btn.key}
            onClick={() => setFilterStatus(btn.key)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              filterStatus === btn.key
                ? 'bg-white/20 text-white'
                : 'bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white'
            }`}
          >
            {btn.label}
            {btn.key !== 'all' && (
              <span className="ml-1.5 text-xs opacity-70">
                {btn.key === 'critical' ? counts.critical
                  : btn.key === 'warning' ? counts.warning
                  : btn.key === 'low' ? counts.low
                  : btn.key === 'ok' ? counts.ok
                  : counts.no_sales}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Загрузка...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Нет данных
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Наименование</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Категория</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Остаток</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Продаж/день</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Осталось дней</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Статус</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr
                      key={item.item_id}
                      className={`border-b border-white/5 ${rowBgClass(item.status)}`}
                    >
                      <td className="px-4 py-3 font-medium">{item.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.category || '—'}</td>
                      <td className="px-4 py-3 text-right">{item.balance.toLocaleString('ru-RU')}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {item.daily_velocity > 0 ? item.daily_velocity.toFixed(2) : (
                          <span className="text-gray-500">0</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right ${daysLeftColor(item.days_left)}`}>
                        {item.days_left === null ? (
                          <span className="text-gray-500 text-xs font-normal">Нет данных</span>
                        ) : (
                          item.days_left
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/store/requests?item_id=${item.item_id}`}>
                          <Button variant="outline" size="sm" className="text-xs h-7">
                            Заявка
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function InventoryForecastPage() {
  return <InventoryLegacyRedirect href="/store/forecast" />
}
