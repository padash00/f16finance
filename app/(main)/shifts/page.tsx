'use client'

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { supabase } from '@/lib/supabaseClient'
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Users,
  Briefcase,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Copy,
  Search,
  Sun,
  Moon,
  BarChart2,
} from 'lucide-react'
import {
  startOfWeek,
  endOfWeek,
  addDays,
  format,
  addWeeks,
  subWeeks,
  isSameDay,
} from 'date-fns'
import { ru } from 'date-fns/locale/ru'

import type { Company } from '@/lib/core/types'

type Shift = {
  id: string
  date: string
  operator_name: string
  shift_type: 'day' | 'night'
  company_id: string
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  full_name?: string | null
  operator_profiles?: { full_name?: string | null }[] | null
  is_active: boolean
}

type ShiftCellData = {
  id: string
  name: string
}

type ShiftsMap = {
  [companyId: string]: {
    [date: string]: {
      day?: ShiftCellData
      night?: ShiftCellData
    }
  }
}

type WeekDay = {
  dateISO: string
  dayName: string
  dayShort: string
  dateObj: Date
}

type ConflictEntry = Shift & {
  companyName: string
}

type ConflictItem = {
  key: string
  operatorName: string
  date: string
  entries: ConflictEntry[]
}

type ActionNotice = {
  tone: 'success' | 'error' | 'info'
  text: string
}

type BulkAssignResult = {
  created: number
  updated: number
  skipped: number
  conflicts: string[]
  notification?: {
    sent: boolean
    reason?: string
    operatorLabel?: string
    count?: number
  }
}

type PublicationDeliveryDetail = {
  operator_id: string
  operator_name: string
  status: 'sent' | 'missing_telegram' | 'failed'
  reason?: string | null
}

type PublicationStatus = {
  id: string
  company_id: string
  company_name: string
  week_start: string
  week_end: string
  version: number
  status: string
  published_at: string
  pending_count: number
  confirmed_count: number
  issue_count: number
  total_count: number
}

type PublicationResponse = {
  id: string
  publication_id: string
  company_id: string
  operator_id: string
  operator_name: string
  status: string
  response_source: string | null
  note: string | null
  responded_at: string | null
  created_at: string
}

type ChangeRequest = {
  id: string
  publication_id: string
  company_id: string
  operator_id: string
  operator_name: string
  shift_date: string
  shift_type: 'day' | 'night'
  status: string
  source: string | null
  reason: string | null
  lead_status: string | null
  lead_action: string | null
  lead_note: string | null
  lead_operator_id: string | null
  lead_operator_name: string | null
  lead_replacement_operator_id: string | null
  lead_replacement_operator_name: string | null
  lead_updated_at: string | null
  resolution_note: string | null
  responded_at: string | null
  resolved_at: string | null
  created_at: string
}

type ScheduleGridProps = {
  companies: Company[]
  operators: Operator[]
  weekDays: WeekDay[]
  shiftsMap: ShiftsMap
  refetchData: () => Promise<void>
  loading: boolean
  selectedOperator: string
  conflictCellKeys: Set<string>
  companySearch: string
  workflowStateByCell: Map<string, { kind: 'confirmed' | 'issue' | 'resolved' | 'dismissed'; label: string }>
}

type EditableCellProps = {
  companyId: string
  date: string
  shiftType: 'day' | 'night'
  operators: Operator[]
  shiftData?: ShiftCellData
  refetchData: () => Promise<void>
  isSelectedOperator: boolean
  isConflict: boolean
  workflowState?: {
    kind: 'confirmed' | 'issue' | 'resolved' | 'dismissed'
    label: string
  } | null
}

const getWeekDetails = (date: Date): { range: string; days: WeekDay[] } => {
  const start = startOfWeek(date, { weekStartsOn: 1 })
  const end = endOfWeek(date, { weekStartsOn: 1 })

  const days: WeekDay[] = []
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i)
    days.push({
      dateISO: format(day, 'yyyy-MM-dd'),
      dayName: format(day, 'eeee', { locale: ru }),
      dayShort: format(day, 'dd.MM'),
      dateObj: day,
    })
  }

  const range = `${format(start, 'd MMM', { locale: ru })} — ${format(end, 'd MMM', { locale: ru })}`
  return { range, days }
}

const normalizeOperatorName = (value: string | null | undefined) => (value || '').trim().toLowerCase()
const getCellKey = (companyId: string, date: string, shiftType: 'day' | 'night') => `${companyId}|${date}|${shiftType}`
const hasNightShift = (company: Company) => (company.code || '').toLowerCase() !== 'extra'
const formatShiftDate = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  })

function buildShiftConflicts(shifts: Shift[], companyNames: Record<string, string>): ConflictItem[] {
  const grouped = new Map<string, ConflictEntry[]>()

  for (const shift of shifts) {
    const normalizedName = normalizeOperatorName(shift.operator_name)
    if (!normalizedName) continue

    const key = `${normalizedName}|${shift.date}`
    const nextEntry: ConflictEntry = {
      ...shift,
      companyName: companyNames[shift.company_id] || 'Неизвестная точка',
    }

    const existing = grouped.get(key) || []
    existing.push(nextEntry)
    grouped.set(key, existing)
  }

  return Array.from(grouped.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({
      key,
      operatorName: entries[0].operator_name,
      date: entries[0].date,
      entries,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.operatorName.localeCompare(b.operatorName))
}

export default function ShiftsPage() {
  const realtimeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [companies, setCompanies] = useState<Company[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companySearch, setCompanySearch] = useState('')
  const [selectedOperator, setSelectedOperator] = useState('all')
  const [copyingWeek, setCopyingWeek] = useState(false)
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [publishingCompanyId, setPublishingCompanyId] = useState<string | null>(null)
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null)
  const [workflowLoading, setWorkflowLoading] = useState(false)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [lastPublicationDetails, setLastPublicationDetails] = useState<PublicationDeliveryDetail[]>([])
  const [publications, setPublications] = useState<PublicationStatus[]>([])
  const [publicationResponses, setPublicationResponses] = useState<PublicationResponse[]>([])
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([])
  const [panelCompanyId, setPanelCompanyId] = useState('')
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({})
  const [replacementOperators, setReplacementOperators] = useState<Record<string, string>>({})
  const [bulkCompanyId, setBulkCompanyId] = useState('')
  const [bulkOperatorName, setBulkOperatorName] = useState('')
  const [bulkShiftType, setBulkShiftType] = useState<'day' | 'night'>('day')
  const [bulkDates, setBulkDates] = useState<string[]>([])

  const { range: weekRange, days: weekDays } = useMemo(
    () => getWeekDetails(currentDate),
    [currentDate],
  )

  const fetchScheduleData = useCallback(async () => {

    const weekStart = weekDays[0].dateISO

    try {
      const res = await fetch(`/api/admin/shifts?weekStart=${weekStart}&includeSchedule=1`)
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || `Ошибка запроса (${res.status})`)

      setCompanies(payload?.schedule?.companies || [])
      setShifts(payload?.schedule?.shifts || [])
      setOperators(payload?.schedule?.operators || [])
      setError(null)
    } catch (err: any) {
      console.error('❌ Ошибка загрузки:', err)
      setError('Ошибка загрузки: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [weekDays])

  const fetchWorkflowData = useCallback(async (silent = false) => {
    const weekStart = weekDays[0].dateISO
    if (!silent) {
      setWorkflowLoading(true)
    }
    try {
      const response = await fetch(`/api/admin/shifts?weekStart=${weekStart}`)
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      setPublications(json?.publications || [])
      setPublicationResponses(json?.responses || [])
      setChangeRequests(json?.requests || [])
      setWorkflowError(null)
    } catch (err: any) {
      console.error('❌ Ошибка workflow shifts:', err)
      setWorkflowError(err?.message || 'Не удалось загрузить согласования')
    } finally {
      if (!silent) {
        setWorkflowLoading(false)
      }
    }
  }, [weekDays])

  const refreshLiveData = useCallback(async () => {
    await Promise.all([fetchScheduleData(), fetchWorkflowData(true)])
  }, [fetchScheduleData, fetchWorkflowData])

  useEffect(() => {
    setLoading(true)
    fetchScheduleData()
  }, [fetchScheduleData])

  useEffect(() => {
    fetchWorkflowData()
  }, [fetchWorkflowData])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (realtimeRefreshRef.current) {
        clearTimeout(realtimeRefreshRef.current)
      }

      realtimeRefreshRef.current = setTimeout(() => {
        refreshLiveData()
      }, 250)
    }

    const channel = supabase
      .channel(`shifts-live-${weekDays[0].dateISO}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_week_publications' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_operator_week_responses' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_change_requests' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (realtimeRefreshRef.current) {
        clearTimeout(realtimeRefreshRef.current)
      }
      supabase.removeChannel(channel)
    }
  }, [refreshLiveData, weekDays])

  useEffect(() => {
    let isRefreshing = false

    const refreshIfVisible = async () => {
      if (document.visibilityState !== 'visible' || isRefreshing) return
      isRefreshing = true
      try {
        await refreshLiveData()
      } finally {
        isRefreshing = false
      }
    }

    const intervalId = window.setInterval(() => {
      refreshIfVisible()
    }, 4000)

    const onFocus = () => {
      refreshIfVisible()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfVisible()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshLiveData])

  const shiftsMap: ShiftsMap = useMemo(() => {
    return shifts.reduce<ShiftsMap>((acc, shift) => {
      const { company_id, date, shift_type, operator_name, id } = shift
      if (!acc[company_id]) acc[company_id] = {}
      if (!acc[company_id][date]) acc[company_id][date] = {}

      acc[company_id][date][shift_type] = { id, name: operator_name }
      return acc
    }, {})
  }, [shifts])

  const companyNames = useMemo(
    () =>
      companies.reduce<Record<string, string>>((acc, company) => {
        acc[company.id] = company.name
        return acc
      }, {}),
    [companies],
  )

  const conflicts = useMemo(() => buildShiftConflicts(shifts, companyNames), [shifts, companyNames])

  const conflictCellKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const conflict of conflicts) {
      for (const entry of conflict.entries) {
        keys.add(getCellKey(entry.company_id, entry.date, entry.shift_type))
      }
    }
    return keys
  }, [conflicts])

  const visibleCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase()
    const selectedNormalized = selectedOperator === 'all' ? '' : normalizeOperatorName(selectedOperator)

    return companies.filter((company) => {
      const code = (company.code || '').toLowerCase()
      const name = (company.name || '').toLowerCase()
      if (code === 'general' || name === 'general') return false

      if (query && !name.includes(query) && !code.includes(query)) {
        return false
      }

      if (!selectedNormalized) return true

      return weekDays.some((day) => {
        const dayData = shiftsMap[company.id]?.[day.dateISO]
        return [dayData?.day?.name, dayData?.night?.name].some(
          (value) => normalizeOperatorName(value) === selectedNormalized,
        )
      })
    })
  }, [companies, companySearch, selectedOperator, shiftsMap, weekDays])

  const assignableCompanies = useMemo(
    () =>
      companies.filter((company) => {
        const code = (company.code || '').toLowerCase()
        const name = (company.name || '').toLowerCase()
        return code !== 'general' && name !== 'general'
      }),
    [companies],
  )

  const bulkCompany = useMemo(
    () => assignableCompanies.find((company) => company.id === bulkCompanyId) || null,
    [assignableCompanies, bulkCompanyId],
  )

  const bulkCompanySupportsNight = bulkCompany ? hasNightShift(bulkCompany) : true

  const latestPublicationByCompany = useMemo(() => {
    const map = new Map<string, PublicationStatus>()
    for (const publication of publications) {
      if (!map.has(publication.company_id)) {
        map.set(publication.company_id, publication)
      }
    }
    return map
  }, [publications])

  const operatorIdByName = useMemo(() => {
    const map = new Map<string, string>()

    for (const operator of operators) {
      const labels = [getOperatorDisplayName(operator), operator.name, operator.short_name || '']
      for (const label of labels) {
        const normalized = normalizeOperatorName(label)
        if (normalized) {
          map.set(normalized, operator.id)
        }
      }
    }

    return map
  }, [operators])

  const workflowStateByCell = useMemo(() => {
    const map = new Map<string, { kind: 'confirmed' | 'issue' | 'resolved' | 'dismissed'; label: string }>()

    for (const request of changeRequests) {
      const publication = latestPublicationByCompany.get(request.company_id)
      if (!publication || publication.id !== request.publication_id) continue

      const cellKey = getCellKey(request.company_id, request.shift_date, request.shift_type)
      const kind =
        request.status === 'open' || request.status === 'awaiting_reason'
          ? 'issue'
          : request.status === 'resolved'
            ? 'resolved'
            : 'dismissed'

      const label =
        request.status === 'open'
          ? request.lead_status === 'proposed'
            ? 'Есть предложение'
            : 'Есть проблема'
          : request.status === 'awaiting_reason'
            ? 'Ждём причину'
            : request.status === 'resolved'
              ? 'Обработано'
              : 'Закрыто'

      map.set(cellKey, { kind, label })
    }

    for (const shift of shifts) {
      const publication = latestPublicationByCompany.get(shift.company_id)
      if (!publication) continue

      const operatorId = operatorIdByName.get(normalizeOperatorName(shift.operator_name))
      if (!operatorId) continue

      const response = publicationResponses.find(
        (item) => item.publication_id === publication.id && item.operator_id === operatorId,
      )
      if (!response) continue

      const cellKey = getCellKey(shift.company_id, shift.date, shift.shift_type)
      if (map.has(cellKey)) continue

      if (response.status === 'confirmed') {
        map.set(cellKey, { kind: 'confirmed', label: 'Подтверждено' })
      } else if (response.status === 'issue_reported') {
        map.set(cellKey, { kind: 'issue', label: 'Есть проблема' })
      }
    }

    return map
  }, [changeRequests, latestPublicationByCompany, operatorIdByName, publicationResponses, shifts])

  const panelCompany = useMemo(
    () => assignableCompanies.find((company) => company.id === panelCompanyId) || null,
    [assignableCompanies, panelCompanyId],
  )

  const panelPublication = useMemo(
    () => (panelCompanyId ? latestPublicationByCompany.get(panelCompanyId) || null : null),
    [latestPublicationByCompany, panelCompanyId],
  )

  const panelResponses = useMemo(
    () =>
      panelPublication
        ? publicationResponses
            .filter((response) => response.publication_id === panelPublication.id)
            .sort((a, b) => a.operator_name.localeCompare(b.operator_name))
        : [],
    [panelPublication, publicationResponses],
  )

  const panelRequests = useMemo(
    () =>
      panelPublication
        ? changeRequests.filter((request) => request.publication_id === panelPublication.id)
        : [],
    [panelPublication, changeRequests],
  )

  const totalSlots = useMemo(
    () => visibleCompanies.reduce((sum, company) => sum + weekDays.length * (hasNightShift(company) ? 2 : 1), 0),
    [visibleCompanies, weekDays],
  )

  const filledSlots = useMemo(() => {
    let count = 0

    for (const company of visibleCompanies) {
      for (const day of weekDays) {
        const dayData = shiftsMap[company.id]?.[day.dateISO]
        if (dayData?.day?.name) count += 1
        if (hasNightShift(company) && dayData?.night?.name) count += 1
      }
    }

    return count
  }, [visibleCompanies, weekDays, shiftsMap])

  const selectedOperatorAssignments = useMemo(() => {
    if (selectedOperator === 'all') return 0
    const selectedNormalized = normalizeOperatorName(selectedOperator)
    return shifts.filter((shift) => normalizeOperatorName(shift.operator_name) === selectedNormalized).length
  }, [selectedOperator, shifts])

  useEffect(() => {
    if (!bulkCompanyId && assignableCompanies.length > 0) {
      setBulkCompanyId(assignableCompanies[0].id)
    }
  }, [assignableCompanies, bulkCompanyId])

  useEffect(() => {
    if (!bulkOperatorName && operators.length > 0) {
      setBulkOperatorName(getOperatorDisplayName(operators[0]))
    }
  }, [operators, bulkOperatorName])

  useEffect(() => {
    if (bulkDates.length === 0 && weekDays.length > 0) {
      setBulkDates(weekDays.map((day) => day.dateISO))
    }
  }, [weekDays, bulkDates.length])

  useEffect(() => {
    const currentWeekDates = new Set(weekDays.map((day) => day.dateISO))
    const containsForeignDate = bulkDates.some((date) => !currentWeekDates.has(date))
    if (containsForeignDate) {
      setBulkDates(weekDays.map((day) => day.dateISO))
    }
  }, [weekDays, bulkDates])

  useEffect(() => {
    if (bulkShiftType === 'night' && bulkCompany && !hasNightShift(bulkCompany)) {
      setBulkShiftType('day')
    }
  }, [bulkShiftType, bulkCompany])

  useEffect(() => {
    if (!panelCompanyId && assignableCompanies.length > 0) {
      setPanelCompanyId(assignableCompanies[0].id)
      return
    }

    if (panelCompanyId && !assignableCompanies.some((company) => company.id === panelCompanyId)) {
      setPanelCompanyId(assignableCompanies[0]?.id || '')
    }
  }, [assignableCompanies, panelCompanyId])

  const goToPrevWeek = () => setCurrentDate(subWeeks(currentDate, 1))
  const goToNextWeek = () => setCurrentDate(addWeeks(currentDate, 1))
  const goToToday = () => setCurrentDate(new Date())

  const handleCopyPreviousWeek = async () => {
    setCopyingWeek(true)
    setActionNotice(null)

    try {
      const response = await fetch('/api/admin/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copyWeekTemplate',
          payload: {
            targetWeekStart: weekDays[0].dateISO,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      const created = Number(json?.created || 0)
      const updated = Number(json?.updated || 0)
      const skipped = Number(json?.skipped || 0)

      setActionNotice({
        tone: 'success',
        text: `Шаблон прошлой недели перенесён: создано ${created}, обновлено ${updated}, пропущено ${skipped}.`,
      })

      await fetchScheduleData()
    } catch (err: any) {
      setActionNotice({
        tone: 'error',
        text: err?.message || 'Не удалось перенести шаблон прошлой недели.',
      })
    } finally {
      setCopyingWeek(false)
    }
  }

  const toggleBulkDate = (dateISO: string) => {
    setBulkDates((prev) =>
      prev.includes(dateISO) ? prev.filter((item) => item !== dateISO) : [...prev, dateISO].sort(),
    )
  }

  const setBulkWeekPreset = (preset: 'all' | 'weekdays' | 'weekend') => {
    if (preset === 'all') {
      setBulkDates(weekDays.map((day) => day.dateISO))
      return
    }

    if (preset === 'weekdays') {
      setBulkDates(weekDays.slice(0, 5).map((day) => day.dateISO))
      return
    }

    setBulkDates(weekDays.slice(5).map((day) => day.dateISO))
  }

  const handleBulkAssign = async () => {
    if (!bulkCompanyId || !bulkOperatorName.trim() || bulkDates.length === 0) {
      setActionNotice({
        tone: 'error',
        text: 'Для массового назначения выбери компанию, оператора и хотя бы один день.',
      })
      return
    }

    if (bulkShiftType === 'night' && !bulkCompanySupportsNight) {
      setActionNotice({
        tone: 'error',
        text: 'Для выбранной точки ночная смена недоступна.',
      })
      return
    }

    setBulkAssigning(true)
    setActionNotice(null)

    try {
      const response = await fetch('/api/admin/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulkAssignWeek',
          payload: {
            companyId: bulkCompanyId,
            operatorName: bulkOperatorName,
            shiftType: bulkShiftType,
            dates: bulkDates,
          },
        }),
      })

      const json = (await response.json().catch(() => null)) as BulkAssignResult | { error?: string } | null
      if (!response.ok) {
        throw new Error(json && 'error' in json ? json.error || `Ошибка запроса (${response.status})` : `Ошибка запроса (${response.status})`)
      }

      const result = json as BulkAssignResult
      const conflictPart = result.conflicts.length > 0 ? ` Конфликтов пропущено: ${result.conflicts.length}.` : ''

      setActionNotice({
        tone: result.conflicts.length > 0 ? 'info' : 'success',
        text: `Массовое назначение завершено: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}.${conflictPart} Операторов уведомим после публикации недели.`,
      })

      await fetchScheduleData()
    } catch (err: any) {
      setActionNotice({
        tone: 'error',
        text: err?.message || 'Не удалось выполнить массовое назначение.',
      })
    } finally {
      setBulkAssigning(false)
    }
  }

  const handlePublishWeek = async () => {
    if (!panelCompanyId) {
      setActionNotice({
        tone: 'error',
        text: 'Сначала выбери компанию в правой панели.',
      })
      return
    }

    setPublishingCompanyId(panelCompanyId)
    setActionNotice(null)

    try {
      const response = await fetch('/api/admin/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publishWeek',
          payload: {
            companyId: panelCompanyId,
            weekStart: weekDays[0].dateISO,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      setActionNotice({
        tone: 'success',
        text: `Неделя по ${json?.companyName || 'точке'} опубликована. Доставлено ${json?.delivered || 0} из ${json?.totalOperators || 0} операторов, без Telegram: ${json?.missingTelegram || 0}, ошибок отправки: ${json?.failed || 0}.`,
      })
      setLastPublicationDetails(json?.deliveryDetails || [])

      await Promise.all([fetchScheduleData(), fetchWorkflowData()])
    } catch (err: any) {
      setActionNotice({
        tone: 'error',
        text: err?.message || 'Не удалось опубликовать неделю.',
      })
      setLastPublicationDetails([])
    } finally {
      setPublishingCompanyId(null)
    }
  }

  const handleResolveIssue = async (
    requestId: string,
    status: 'resolved' | 'dismissed',
    resolutionAction: 'keep' | 'remove' | 'replace' = 'keep',
  ) => {
    setResolvingRequestId(requestId)

    try {
      const replacementOperatorName = replacementOperators[requestId]?.trim() || null
      const resolutionNote = resolutionNotes[requestId]?.trim() || null
      const response = await fetch('/api/admin/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolveIssue',
          payload: {
            requestId,
            status,
            resolutionAction,
            replacementOperatorName,
            resolutionNote,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      setActionNotice({
        tone: 'success',
        text:
          status === 'resolved'
            ? resolutionAction === 'replace'
              ? 'Запрос обработан: на смену назначен другой оператор.'
              : resolutionAction === 'remove'
                ? 'Запрос обработан: оператор снят со смены.'
                : 'Запрос обработан: график оставлен без изменений.'
            : 'Запрос закрыт без изменения графика.',
      })

      setResolutionNotes((prev) => {
        const next = { ...prev }
        delete next[requestId]
        return next
      })
      setReplacementOperators((prev) => {
        const next = { ...prev }
        delete next[requestId]
        return next
      })

      await Promise.all([fetchScheduleData(), fetchWorkflowData()])
    } catch (err: any) {
      setActionNotice({
        tone: 'error',
        text: err?.message || 'Не удалось обновить статус запроса.',
      })
    } finally {
      setResolvingRequestId(null)
    }
  }

  return (
    <>
        <div className="app-page max-w-7xl">
          <div className="mb-6">
            <AdminPageHeader
              title="График смен"
              description="Расписание операторов, конфликты, быстрые действия"
              accent="violet"
              icon={<Users className="h-5 w-5" aria-hidden />}
              actions={
                <>
                  <Card className="!flex-row !items-center !gap-0 shrink-0 self-start border-border bg-card !px-1 !py-1 neon-glow">
                    <Button variant="ghost" size="icon" onClick={goToPrevWeek} aria-label="Предыдущая неделя">
                      <ChevronLeft className="h-5 w-5" />
                    </Button>

                    <div className="min-w-[160px] px-4 text-center">
                      <div className="flex items-center justify-center gap-2 text-sm font-bold">
                        <CalendarDays className="h-4 w-4 text-accent" aria-hidden />
                        {weekRange}
                      </div>
                    </div>

                    <Button variant="ghost" size="icon" onClick={goToNextWeek} aria-label="Следующая неделя">
                      <ChevronRight className="h-5 w-5" />
                    </Button>

                    <div className="mx-1 h-6 w-px bg-border" />

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setLoading(true)
                        void fetchScheduleData()
                      }}
                      title="Обновить данные"
                      aria-label="Обновить данные"
                    >
                      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>

                    <Button variant="secondary" size="sm" className="ml-1 text-xs" onClick={goToToday}>
                      Сегодня
                    </Button>
                  </Card>

                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleCopyPreviousWeek}
                    disabled={copyingWeek || loading}
                  >
                    {copyingWeek ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                    Заполнить по прошлой неделе
                  </Button>

                  <Link href="/shifts/report">
                    <Button variant="outline" size="sm" className="gap-2">
                      <BarChart2 className="h-4 w-4" /> Отчёт по смене
                    </Button>
                  </Link>
                </>
              }
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-border bg-card p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Заполнено</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{filledSlots}</div>
              <div className="mt-1 text-xs text-muted-foreground">из {totalSlots} смен за неделю</div>
            </Card>

            <Card className="border-border bg-card p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Пустые слоты</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{Math.max(totalSlots - filledSlots, 0)}</div>
              <div className="mt-1 text-xs text-muted-foreground">можно быстро дозаполнить</div>
            </Card>

            <Card className="border-border bg-card p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Конфликты</div>
              <div className="mt-2 text-2xl font-semibold text-amber-400">{conflicts.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">оператор в нескольких сменах за день</div>
            </Card>

            <Card className="border-border bg-card p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">По фильтру</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {selectedOperator === 'all' ? visibleCompanies.length : selectedOperatorAssignments}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedOperator === 'all' ? 'активных точек видно' : 'смен у выбранного оператора'}
              </div>
            </Card>
          </div>

          <Card className="mb-6 border-border bg-card p-4 neon-glow">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  placeholder="Поиск по компании или коду"
                  className="h-10 w-full rounded-2xl border border-border bg-background pl-10 pr-4 text-sm text-foreground outline-none ring-0 transition-colors placeholder:text-muted-foreground focus:border-accent"
                />
              </label>

              <select
                value={selectedOperator}
                onChange={(e) => setSelectedOperator(e.target.value)}
                className="h-10 rounded-2xl border border-border bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-accent"
              >
                <option value="all">Все операторы</option>
                {operators.map((operator) => {
                  const label = getOperatorDisplayName(operator)
                  return (
                    <option key={operator.id} value={label}>
                      {label}
                    </option>
                  )
                })}
              </select>
            </div>
          </Card>

          <Card className="mb-6 border-border bg-card p-4">
            <div className="mb-4 flex flex-col gap-1">
              <div className="text-sm font-semibold text-foreground">Массовое назначение на неделю</div>
              <div className="text-xs text-muted-foreground">
                Выбери точку, оператора и дни недели. Конфликтные смены не перезапишутся и попадут в отчёт.
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_180px_auto]">
              <select
                value={bulkCompanyId}
                onChange={(e) => setBulkCompanyId(e.target.value)}
                className="h-10 rounded-2xl border border-border bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-accent"
              >
                {assignableCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>

              <select
                value={bulkOperatorName}
                onChange={(e) => setBulkOperatorName(e.target.value)}
                className="h-10 rounded-2xl border border-border bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-accent"
              >
                {operators.map((operator) => {
                  const label = getOperatorDisplayName(operator)
                  return (
                    <option key={operator.id} value={label}>
                      {label}
                    </option>
                  )
                })}
              </select>

              <select
                value={bulkShiftType}
                onChange={(e) => setBulkShiftType(e.target.value as 'day' | 'night')}
                className="h-10 rounded-2xl border border-border bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-accent"
              >
                <option value="day">Дневные смены</option>
                <option value="night" disabled={!bulkCompanySupportsNight}>
                  Ночные смены
                </option>
              </select>

              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleBulkAssign}
                disabled={bulkAssigning || loading || assignableCompanies.length === 0 || operators.length === 0}
              >
                {bulkAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Назначить
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setBulkWeekPreset('all')}>
                Вся неделя
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBulkWeekPreset('weekdays')}>
                Пн-Пт
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBulkWeekPreset('weekend')}>
                Выходные
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              {weekDays.map((day) => {
                const checked = bulkDates.includes(day.dateISO)
                return (
                  <button
                    key={day.dateISO}
                    type="button"
                    onClick={() => toggleBulkDate(day.dateISO)}
                    className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                      checked
                        ? 'border-accent bg-accent/15 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="text-xs uppercase">{day.dayName}</div>
                    <div className="mt-1 text-sm font-semibold">{day.dayShort}</div>
                  </button>
                )
              })}
            </div>

            {!bulkCompanySupportsNight && (
              <div className="mt-3 text-xs text-amber-300">
                Для точки {bulkCompany?.name} ночные смены отключены.
              </div>
            )}
          </Card>

          <div className="space-y-6">
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
                {error}
              </div>
            )}

            {actionNotice && (
              <div
                className={
                  actionNotice.tone === 'success'
                    ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300'
                    : actionNotice.tone === 'error'
                      ? 'rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300'
                      : 'rounded-lg border border-white/10 bg-white/[0.04] p-4 text-foreground'
                }
              >
                {actionNotice.text}
              </div>
            )}

            {conflicts.length > 0 && (
              <Card className="border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-400" />
                  <div className="min-w-0">
                    <div className="font-semibold text-amber-300">Найдены потенциальные конфликты по операторам</div>
                    <div className="mt-1 text-sm text-amber-100/80">
                      Один и тот же оператор стоит в нескольких сменах за один день. Проверь эти назначения:
                    </div>
                    <div className="mt-3 grid gap-2">
                      {conflicts.slice(0, 6).map((conflict) => (
                        <div key={conflict.key} className="rounded-2xl border border-amber-500/15 bg-black/10 px-3 py-2 text-sm">
                          <span className="font-medium text-foreground">{conflict.operatorName}</span>{' '}
                          <span className="text-muted-foreground">• {conflict.date} • </span>
                          <span className="text-muted-foreground">
                            {conflict.entries
                              .map((entry) => `${entry.companyName} (${entry.shift_type === 'day' ? 'день' : 'ночь'})`)
                              .join(', ')}
                          </span>
                        </div>
                      ))}
                      {conflicts.length > 6 && (
                        <div className="text-xs text-muted-foreground">И ещё {conflicts.length - 6} конфликтов в таблице ниже.</div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <ScheduleGrid
                companies={visibleCompanies}
                operators={operators}
                weekDays={weekDays}
                shiftsMap={shiftsMap}
                refetchData={fetchScheduleData}
                loading={loading}
                selectedOperator={selectedOperator}
                conflictCellKeys={conflictCellKeys}
                companySearch={companySearch}
                workflowStateByCell={workflowStateByCell}
              />

              <Card className="h-fit border-border bg-card p-4 xl:sticky xl:top-6">
                <div className="mb-4">
                  <div className="text-sm font-semibold text-foreground">Согласование недели</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Публикуй график только после заполнения недели. Операторы подтвердят его или отправят проблемные даты сюда.
                  </div>
                </div>

                <div className="space-y-4">
                  <select
                    value={panelCompanyId}
                    onChange={(e) => setPanelCompanyId(e.target.value)}
                    className="h-10 w-full rounded-2xl border border-border bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-accent"
                  >
                    {assignableCompanies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>

                  <div className="rounded-2xl border border-border bg-background p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{panelCompany?.name || 'Компания не выбрана'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Неделя: {weekRange}</div>
                      </div>
                      <Button
                        size="sm"
                        onClick={handlePublishWeek}
                        disabled={!panelCompanyId || publishingCompanyId === panelCompanyId}
                      >
                        {publishingCompanyId === panelCompanyId ? 'Публикуем...' : 'Опубликовать'}
                      </Button>
                    </div>

                    {panelPublication ? (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-border bg-card px-3 py-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Версия</div>
                          <div className="mt-1 text-sm font-semibold text-foreground">v{panelPublication.version}</div>
                        </div>
                        <div className="rounded-xl border border-border bg-card px-3 py-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Опубликован</div>
                          <div className="mt-1 text-sm font-semibold text-foreground">
                            {new Date(panelPublication.published_at).toLocaleDateString('ru-RU', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                        <div className="rounded-xl border border-border bg-card px-3 py-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Подтвердили</div>
                          <div className="mt-1 text-sm font-semibold text-emerald-300">
                            {panelPublication.confirmed_count}/{panelPublication.total_count}
                          </div>
                        </div>
                        <div className="rounded-xl border border-border bg-card px-3 py-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Проблемы</div>
                          <div className="mt-1 text-sm font-semibold text-amber-300">{panelPublication.issue_count}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                        Эту неделю по выбранной компании ещё не публиковали.
                      </div>
                    )}
                  </div>

                  {workflowError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-300">
                      {workflowError}
                    </div>
                  )}

                  {lastPublicationDetails.length > 0 && (
                    <div className="rounded-2xl border border-border bg-background p-4">
                      <div className="mb-3 text-sm font-semibold text-foreground">Результат последней отправки</div>
                      <div className="space-y-2">
                        {lastPublicationDetails.map((item) => (
                          <div key={`${item.operator_id}-${item.status}`} className="rounded-xl border border-border bg-card px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-foreground">{item.operator_name}</div>
                              <div
                                className={`rounded-full px-2 py-1 text-[11px] ${
                                  item.status === 'sent'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : item.status === 'missing_telegram'
                                      ? 'bg-sky-500/15 text-sky-300'
                                      : 'bg-rose-500/15 text-rose-300'
                                }`}
                              >
                                {item.status === 'sent'
                                  ? 'Отправлено'
                                  : item.status === 'missing_telegram'
                                    ? 'Нет Telegram'
                                    : 'Ошибка'}
                              </div>
                            </div>
                            {item.reason && (
                              <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.reason}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-border bg-background p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-foreground">Ответы операторов</div>
                      {workflowLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>

                    <div className="space-y-2">
                      {panelResponses.length > 0 ? (
                        panelResponses.map((response) => (
                          <div key={response.id} className="rounded-xl border border-border bg-card px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-foreground">{response.operator_name}</div>
                              <div
                                className={`rounded-full px-2 py-1 text-[11px] ${
                                  response.status === 'confirmed'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : response.status === 'issue_reported'
                                      ? 'bg-amber-500/15 text-amber-300'
                                      : 'bg-white/5 text-muted-foreground'
                                }`}
                              >
                                {response.status === 'confirmed'
                                  ? 'Согласен'
                                  : response.status === 'issue_reported'
                                    ? 'Есть проблема'
                                    : 'Ждём ответ'}
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {response.responded_at
                                ? `Ответил ${new Date(response.responded_at).toLocaleString('ru-RU')}`
                                : 'Пока не ответил'}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                          После публикации недели здесь появятся ответы операторов.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-background p-4">
                    <div className="mb-3 text-sm font-semibold text-foreground">Лента проблемных смен</div>

                    <div className="space-y-3">
                      {panelRequests.length > 0 ? (
                        panelRequests.map((request) => (
                          <div key={request.id} className="rounded-xl border border-border bg-card px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-foreground">{request.operator_name}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {formatShiftDate(request.shift_date)} · {request.shift_type === 'day' ? 'день' : 'ночь'}
                                </div>
                              </div>
                              <div
                                className={`rounded-full px-2 py-1 text-[11px] ${
                                  request.status === 'open'
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : request.status === 'resolved'
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : request.status === 'dismissed'
                                        ? 'bg-white/10 text-muted-foreground'
                                        : 'bg-sky-500/15 text-sky-300'
                                }`}
                              >
                                {request.status === 'open'
                                  ? 'Нужна замена'
                                  : request.status === 'resolved'
                                    ? 'Обработано'
                                    : request.status === 'dismissed'
                                      ? 'Закрыто'
                                      : 'Ждём причину'}
                              </div>
                            </div>

                            <div className="mt-3 rounded-lg bg-black/10 px-3 py-2 text-sm text-foreground">
                              {request.reason || 'Оператор ещё не прислал причину, бот ждёт ответ.'}
                            </div>

                            {request.lead_status === 'proposed' && (
                              <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-sm text-sky-100">
                                <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300/80">Предложение старшего</div>
                                <div className="mt-1">
                                  {request.lead_operator_name || 'Старший'} предлагает:{' '}
                                  {request.lead_action === 'replace'
                                    ? `поставить ${request.lead_replacement_operator_name || 'другого оператора'}`
                                    : request.lead_action === 'remove'
                                      ? 'снять со смены'
                                      : 'оставить как есть'}
                                </div>
                                {request.lead_note ? <div className="mt-1 text-sky-100/90">{request.lead_note}</div> : null}
                              </div>
                            )}

                            {request.resolution_note && request.status !== 'open' && (
                              <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                                <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-300/80">Как обработано</div>
                                <div className="mt-1">{request.resolution_note}</div>
                              </div>
                            )}

                            {request.status === 'open' && (
                              <div className="mt-3 space-y-3">
                                <textarea
                                  value={resolutionNotes[request.id] || ''}
                                  onChange={(e) =>
                                    setResolutionNotes((prev) => ({
                                      ...prev,
                                      [request.id]: e.target.value,
                                    }))
                                  }
                                  rows={2}
                                  placeholder="Комментарий руководителя: что именно сделали со сменой"
                                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
                                />

                                <select
                                  value={replacementOperators[request.id] || ''}
                                  onChange={(e) =>
                                    setReplacementOperators((prev) => ({
                                      ...prev,
                                      [request.id]: e.target.value,
                                    }))
                                  }
                                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-accent"
                                >
                                  <option value="">Выбери оператора для замены</option>
                                  {operators
                                    .filter(
                                      (operator) =>
                                        normalizeOperatorName(getOperatorDisplayName(operator)) !==
                                        normalizeOperatorName(request.operator_name),
                                    )
                                    .map((operator) => {
                                      const label = getOperatorDisplayName(operator)
                                      return (
                                        <option key={`${request.id}-${operator.id}`} value={label}>
                                          {label}
                                        </option>
                                      )
                                    })}
                                </select>

                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleResolveIssue(request.id, 'resolved', 'remove')}
                                    disabled={resolvingRequestId === request.id}
                                  >
                                    Снять со смены
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleResolveIssue(request.id, 'resolved', 'replace')}
                                    disabled={resolvingRequestId === request.id}
                                  >
                                    Поставить замену
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleResolveIssue(request.id, 'resolved', 'keep')}
                                    disabled={resolvingRequestId === request.id}
                                  >
                                    Оставить как есть
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleResolveIssue(request.id, 'dismissed', 'keep')}
                                    disabled={resolvingRequestId === request.id}
                                  >
                                    Закрыть без изменений
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                          Когда оператор укажет проблемную дату, она появится здесь как отдельный запрос.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
    </>
  )
}

function ScheduleGrid({
  companies,
  operators,
  weekDays,
  shiftsMap,
  refetchData,
  loading,
  selectedOperator,
  conflictCellKeys,
  companySearch,
  workflowStateByCell,
}: ScheduleGridProps) {
  if (loading && companies.length === 0) {
    return <div className="p-12 text-center text-muted-foreground animate-pulse">Загрузка структуры...</div>
  }

  if (companies.length === 0) {
    return (
      <p className="text-center text-muted-foreground">
        {companySearch || selectedOperator !== 'all'
          ? 'По выбранным фильтрам ничего не найдено.'
          : 'Нет активных точек для отображения.'}
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-8">
      {companies.map((company) => (
        <Card key={company.id} className="overflow-hidden border-border bg-card p-0 neon-glow">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 p-3">
            <Briefcase className="h-4 w-4 text-accent" />
            <span className="font-bold text-foreground">{company.name}</span>
          </div>

          <AdminTableViewport
            maxHeight="min(56vh, 32rem)"
            className="rounded-none border-0 border-t border-border bg-transparent"
          >
            <table className="w-full border-collapse text-sm">
              <thead className={`${adminTableStickyTheadClass} !normal-case [&_th]:align-middle`}>
                <tr>
                  <th className="w-24 border-b border-border bg-muted/10 p-3 text-left text-sm font-medium normal-case text-muted-foreground">
                    Смена
                  </th>
                  {weekDays.map((day) => {
                    const isToday = isSameDay(day.dateObj, new Date())
                    return (
                      <th
                        key={day.dateISO}
                        className={`min-w-[100px] border-b border-l border-border p-2 text-center ${isToday ? 'bg-accent/10' : ''}`}
                      >
                        <div className={`text-xs font-bold uppercase ${isToday ? 'text-accent' : 'text-muted-foreground'}`}>
                          {day.dayName}
                        </div>
                        <div className={`text-xs ${isToday ? 'font-bold text-foreground' : 'text-muted-foreground/70'}`}>
                          {day.dayShort}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border-r border-border bg-yellow-500/5 p-3 font-semibold text-yellow-500"><Sun className="inline w-4 h-4 mr-1" />День</td>
                  {weekDays.map((day) => {
                    const shiftData = shiftsMap[company.id]?.[day.dateISO]?.day
                    return (
                      <EditableShiftCell
                        key={`day-${day.dateISO}`}
                        companyId={company.id}
                        date={day.dateISO}
                        shiftType="day"
                        operators={operators}
                        shiftData={shiftData}
                        refetchData={refetchData}
                        isSelectedOperator={
                          selectedOperator !== 'all' &&
                          normalizeOperatorName(shiftData?.name) === normalizeOperatorName(selectedOperator)
                        }
                        isConflict={conflictCellKeys.has(getCellKey(company.id, day.dateISO, 'day'))}
                        workflowState={workflowStateByCell.get(getCellKey(company.id, day.dateISO, 'day')) || null}
                      />
                    )
                  })}
                </tr>

                {hasNightShift(company) && (
                  <tr>
                    <td className="border-r border-border bg-blue-500/5 p-3 font-semibold text-blue-400"><Moon className="inline w-4 h-4 mr-1" />Ночь</td>
                    {weekDays.map((day) => {
                      const shiftData = shiftsMap[company.id]?.[day.dateISO]?.night
                      return (
                        <EditableShiftCell
                          key={`night-${day.dateISO}`}
                          companyId={company.id}
                          date={day.dateISO}
                          shiftType="night"
                          operators={operators}
                          shiftData={shiftData}
                          refetchData={refetchData}
                          isSelectedOperator={
                            selectedOperator !== 'all' &&
                            normalizeOperatorName(shiftData?.name) === normalizeOperatorName(selectedOperator)
                          }
                          isConflict={conflictCellKeys.has(getCellKey(company.id, day.dateISO, 'night'))}
                          workflowState={workflowStateByCell.get(getCellKey(company.id, day.dateISO, 'night')) || null}
                        />
                      )
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </AdminTableViewport>
        </Card>
      ))}
    </div>
  )
}

function EditableShiftCell({
  companyId,
  date,
  shiftType,
  operators,
  shiftData,
  refetchData,
  isSelectedOperator,
  isConflict,
  workflowState,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [val, setVal] = useState(shiftData?.name || '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const selectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (!isEditing) {
      setVal(shiftData?.name || '')
    }
  }, [shiftData, isEditing])

  useEffect(() => {
    if (isEditing) {
      selectRef.current?.focus()
    }
  }, [isEditing])

  const handleSave = async (nextNameArg?: string) => {
    const newName = (nextNameArg ?? val).trim()
    const oldName = shiftData?.name || ''

    if (newName === oldName) {
      setIsEditing(false)
      return
    }

    setStatus('saving')

    try {
      const response = await fetch('/api/admin/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveShift',
          payload: {
            shiftId: shiftData?.id || null,
            companyId,
            date,
            shiftType,
            operatorName: newName,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      setStatus('success')
      await refetchData()
      setTimeout(() => setStatus('idle'), 1000)
    } catch (e: any) {
      console.error('❌ Ошибка при сохранении:', e?.message || e)
      setStatus('error')
      alert(`Ошибка: ${e?.message || 'Не удалось сохранить смену'}`)
      setVal(oldName)
    } finally {
      setIsEditing(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      setVal(shiftData?.name || '')
      setIsEditing(false)
    }
  }

  const getCellClass = () => {
    if (status === 'saving') return 'bg-blue-500/20 shadow-[inset_0_0_10px_rgba(59,130,246,0.5)]'
    if (status === 'success') return 'bg-green-500/20 shadow-[inset_0_0_10px_rgba(34,197,94,0.5)]'
    if (status === 'error') return 'bg-red-500/20'
    if (isConflict) return 'bg-amber-500/15 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)]'
    if (workflowState?.kind === 'issue') return 'bg-amber-500/10 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)]'
    if (workflowState?.kind === 'resolved') return 'bg-sky-500/10 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.22)]'
    if (workflowState?.kind === 'dismissed') return 'bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
    if (workflowState?.kind === 'confirmed') return 'bg-emerald-500/10 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.24)]'
    if (isSelectedOperator) return 'bg-emerald-500/12 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.28)]'
    return 'hover:bg-white/5'
  }

  return (
    <td className={`group relative h-12 border-l border-border p-0 transition-all ${getCellClass()}`}>
      {isEditing ? (
        <select
          ref={selectRef}
          value={val}
          onChange={async (e) => {
            const nextValue = e.target.value
            setVal(nextValue)
            await handleSave(nextValue)
          }}
          onBlur={() => {
            if (status !== 'saving') setIsEditing(false)
          }}
          onKeyDown={handleKeyDown}
          disabled={status === 'saving'}
          className="h-full w-full bg-background px-2 text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent"
        >
          <option value="">Без оператора</option>
          {operators.map((operator) => {
                  const label = getOperatorDisplayName(operator)
            return (
              <option key={operator.id} value={label}>
                {label}
              </option>
            )
          })}
        </select>
      ) : (
        <button
          type="button"
          className="flex h-full w-full items-center justify-center px-2 text-sm"
          onClick={() => {
            if (status !== 'saving') setIsEditing(true)
          }}
          title={
            isConflict
              ? `Проверь назначение: ${val || 'оператор не выбран'}`
              : workflowState
                ? `${workflowState.label}: ${val || 'оператор не выбран'}`
              : val
                ? `Оператор: ${val}`
                : 'Нажмите, чтобы выбрать оператора'
          }
        >
          {status === 'saving' ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          ) : (
            <span
              className={
                val
                  ? `font-medium ${isConflict ? 'text-amber-100' : 'text-foreground'}`
                  : 'text-xs text-muted-foreground/20 group-hover:text-muted-foreground/50'
              }
            >
              {val || '—'}
            </span>
          )}
        </button>
      )}

      {workflowState && !isEditing && (
        <div
          className={`pointer-events-none absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            workflowState.kind === 'confirmed'
              ? 'bg-emerald-500/15 text-emerald-300'
              : workflowState.kind === 'issue'
                ? 'bg-amber-500/15 text-amber-300'
                : workflowState.kind === 'resolved'
                  ? 'bg-sky-500/15 text-sky-300'
                  : 'bg-white/10 text-muted-foreground'
          }`}
        >
          {workflowState.kind === 'confirmed'
            ? 'OK'
            : workflowState.kind === 'issue'
              ? '!'
              : workflowState.kind === 'resolved'
                ? 'Fix'
                : 'X'}
        </div>
      )}

      {isConflict && !isEditing && (
        <AlertTriangle className="pointer-events-none absolute right-1 top-1 h-3.5 w-3.5 text-amber-400" />
      )}
    </td>
  )
}
