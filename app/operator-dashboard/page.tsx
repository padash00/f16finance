'use client'

import { startTransition, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DEFAULT_SHIFT_BASE_PAY, SYSTEM_START_DATE } from '@/lib/core/constants'
import { formatDateForInput, getMonthRange, getWeekRange } from '@/lib/core/date'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { calculateOperatorSalarySummary } from '@/lib/domain/salary'
import { OperatorSchedulePanel } from '@/components/operator/operator-schedule-panel'
import {
  User,
  Wallet,
  Award,
  AlertTriangle,
  TrendingUp,
  Clock,
  Calendar,
  LogOut,
  Settings,
  DollarSign,
  CreditCard,
  Landmark,
  Sparkles,
  Phone,
  Mail,
  Briefcase,
  Building2,
  History,
  FileText,
  Zap,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Trophy,
  Star,
  Medal,
  Target,
  CalendarRange,
  History as HistoryIcon,
} from 'lucide-react'

// Типы для ачивок
type Achievement = {
  achievement_key: string
  achievement_name: string
  achievement_description: string
  achieved_at: string
  xp_reward: number
}

type LevelInfo = {
  current_level: number
  current_xp: number
  total_xp: number
  calculated_level: number
  xp_to_next_level: number
  next_level_xp: number
}

type Operator = {
  id: string
  name: string
  full_name?: string | null
  short_name: string | null
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
}

type SalaryStats = {
  totalShifts: number
  baseSalary: number
  autoBonuses: number
  manualBonuses: number
  totalAccrued: number
  autoDebts: number
  totalFines: number
  totalAdvances: number
  totalDeductions: number
  paidAmount: number
  remainingAmount: number
}

type PaymentHistory = {
  id: number
  date: string
  amount: number
  kind: 'bonus' | 'fine' | 'advance' | 'debt' | 'salary' | 'auto_bonus'
  comment: string | null
}

type OperatorTaskItem = {
  id: string
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'
  due_date: string | null
}

type OperatorShiftGroup = {
  publication?: { id: string } | null
  response?: { id: string; status?: string | null } | null
  requests?: Array<{ id: string; status?: string | null }>
  shifts?: Array<{ date: string; shift_type: 'day' | 'night' }>
}

type OperatorWorkspaceSummary = {
  activeTasks: number
  reviewTasks: number
  pendingWeekConfirmations: number
  openShiftIssues: number
  nextShiftLabel: string | null
}

function getCurrentWeekStart(date = new Date()) {
  const copy = new Date(date)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  copy.setHours(0, 0, 0, 0)
  return copy.toISOString().slice(0, 10)
}

function formatShiftDateLabel(date: string, shiftType: 'day' | 'night') {
  const shiftLabel = shiftType === 'day' ? 'день' : 'ночь'
  return `${new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })}, ${shiftLabel}`
}

function buildWorkspaceSummary(
  tasks: OperatorTaskItem[],
  schedule: OperatorShiftGroup[],
): OperatorWorkspaceSummary {
  const activeTasks = tasks.filter((task) => ['todo', 'in_progress', 'backlog'].includes(task.status)).length
  const reviewTasks = tasks.filter((task) => task.status === 'review').length
  const pendingWeekConfirmations = schedule.filter(
    (company) => company.publication?.id && company.response?.status !== 'confirmed',
  ).length
  const openShiftIssues = schedule.reduce(
    (sum, company) =>
      sum +
      (company.requests || []).filter((request) => !['resolved', 'dismissed'].includes(request.status || '')).length,
    0,
  )
  const nextShift = schedule
    .flatMap((company) => company.shifts || [])
    .filter((shift) => new Date(`${shift.date}T00:00:00`).getTime() >= new Date().setHours(0, 0, 0, 0))
    .sort((a, b) => a.date.localeCompare(b.date))[0]

  return {
    activeTasks,
    reviewTasks,
    pendingWeekConfirmations,
    openShiftIssues,
    nextShiftLabel: nextShift ? formatShiftDateLabel(nextShift.date, nextShift.shift_type) : null,
  }
}

export default function OperatorDashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [operator, setOperator] = useState<Operator | null>(null)
  const [salaryStats, setSalaryStats] = useState<SalaryStats | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [levelInfo, setLevelInfo] = useState<LevelInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [customRange, setCustomRange] = useState(false)
  const [periodType, setPeriodType] = useState<'week' | 'month' | 'all'>('week')
  const [workspaceSummary, setWorkspaceSummary] = useState<OperatorWorkspaceSummary>({
    activeTasks: 0,
    reviewTasks: 0,
    pendingWeekConfirmations: 0,
    openShiftIssues: 0,
    nextShiftLabel: null,
  })
  const [workspaceSummaryLoading, setWorkspaceSummaryLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'salary' | 'schedule' | 'history' | 'profile'>('salary')

  useEffect(() => {
    ;[
      '/operator-lead',
      '/operator-tasks',
      '/operator-chat',
      '/operator-achievements',
      '/operator-settings',
    ].forEach((route) => router.prefetch(route))
  }, [router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab === 'schedule' || tab === 'history' || tab === 'profile' || tab === 'salary') {
      setActiveTab(tab)
    }
  }, [])

  // Функция для установки периода
  const setPeriod = (type: 'week' | 'month' | 'all') => {
    setPeriodType(type)
    
    if (type === 'week') {
      setDateRange(getWeekRange())
      setCustomRange(false)
    } else if (type === 'month') {
      setDateRange(getMonthRange())
      setCustomRange(true)
    } else if (type === 'all') {
      setDateRange({
        from: SYSTEM_START_DATE,
        to: formatDateForInput(new Date())
      })
      setCustomRange(true)
    }
  }

  const [dateRange, setDateRange] = useState(() => getWeekRange())

  // Переключение недель (для совместимости)
  const goToPrevWeek = () => {
    const fromDate = new Date(dateRange.from)
    const toDate = new Date(dateRange.to)
    
    fromDate.setDate(fromDate.getDate() - 7)
    toDate.setDate(toDate.getDate() - 7)
    
    setDateRange({
      from: formatDateForInput(fromDate),
      to: formatDateForInput(toDate)
    })
    setPeriodType('week')
    setCustomRange(true)
  }

  const goToNextWeek = () => {
    const fromDate = new Date(dateRange.from)
    const toDate = new Date(dateRange.to)
    const today = new Date()
    
    fromDate.setDate(fromDate.getDate() + 7)
    toDate.setDate(toDate.getDate() + 7)
    
    // Не даем заглядывать в будущее
    if (fromDate > today) return
    
    setDateRange({
      from: formatDateForInput(fromDate),
      to: formatDateForInput(toDate)
    })
    setPeriodType('week')
    setCustomRange(true)
  }

  const resetToCurrentWeek = () => {
    setPeriod('week')
  }

  useEffect(() => {
    const loadOperatorData = async () => {
      try {
        setLoading(true)
        
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        
        if (userError) throw new Error(userError.message)
        if (!user) {
          router.push('/login')
          return
        }

        // Ищем оператора по user_id
        const { data: authData, error: authError } = await supabase
          .from('operator_auth')
          .select(`
            operator_id,
            role,
            operators (
              id,
              name,
              short_name,
              operator_profiles (*)
            )
          `)
          .eq('user_id', user.id)
          .maybeSingle()

        if (authError) throw new Error(authError.message)
        if (!authData) {
          router.push('/login')
          return
        }

        const op = authData.operators as any
        const profile = op?.operator_profiles || {}

        setOperator({
          id: op.id,
          name: op.name,
          full_name: profile.full_name,
          short_name: op.short_name,
          photo_url: profile.photo_url,
          position: profile.position,
          phone: profile.phone,
          email: profile.email,
          hire_date: profile.hire_date,
        })

        const operatorId = op.id

        // ========== ЗАГРУЖАЕМ ДАННЫЕ ЗА ВЫБРАННЫЙ ПЕРИОД ==========
        const [
          companiesRes,
          rulesRes,
          shiftsRes,
          adjustmentsRes,
          debtsRes,
          levelRes,
          achievementsRes,
        ] = await Promise.all([
          supabase.from('companies').select('id, code'),
          supabase
            .from('operator_salary_rules')
            .select(
              'company_code, shift_type, base_per_shift, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus',
            )
            .eq('is_active', true),
          supabase
            .from('incomes')
            .select('id, date, shift, cash_amount, kaspi_amount, card_amount, company_id')
            .eq('operator_id', operatorId)
            .gte('date', dateRange.from)
            .lte('date', dateRange.to),
          supabase
            .from('operator_salary_adjustments')
            .select('amount, kind, date, comment')
            .eq('operator_id', operatorId)
            .gte('date', dateRange.from)
            .lte('date', dateRange.to),
          supabase
            .from('debts')
            .select('amount, week_start, comment, operator_id')
            .eq('operator_id', operatorId)
            .gte('week_start', dateRange.from)
            .lte('week_start', dateRange.to)
            .eq('status', 'active'),
          supabase.rpc('get_operator_level_info', { operator_uuid: operatorId }),
          supabase.rpc('get_operator_achievements', { operator_uuid: operatorId }),
        ])

        if (companiesRes.error) throw new Error(companiesRes.error.message)
        if (rulesRes.error) throw new Error(rulesRes.error.message)
        if (shiftsRes.error) throw new Error(shiftsRes.error.message)
        if (adjustmentsRes.error) throw new Error(adjustmentsRes.error.message)
        if (debtsRes.error) throw new Error(debtsRes.error.message)

        const companies = companiesRes.data
        const rulesList = rulesRes.data
        const shifts = shiftsRes.data
        const adjustments = adjustmentsRes.data

        const history: PaymentHistory[] = []

        for (const adj of adjustments || []) {
          if (adj.kind === 'bonus') {
            history.push({
              id: Date.now() + Math.random(),
              date: adj.date,
              amount: adj.amount,
              kind: 'bonus',
              comment: adj.comment || 'Премия'
            })
          } else if (adj.kind === 'advance') {
            history.push({
              id: Date.now() + Math.random(),
              date: adj.date,
              amount: adj.amount,
              kind: 'advance',
              comment: adj.comment || 'Аванс'
            })
          } else {
            history.push({
              id: Date.now() + Math.random(),
              date: adj.date,
              amount: adj.amount,
              kind: 'fine',
              comment: adj.comment || (adj.kind === 'fine' ? 'Штраф' : 'Ручной долг')
            })
          }
        }

        const autoDebtsData = debtsRes.data
        
        for (const debt of autoDebtsData || []) {
          history.push({
            id: Date.now() + Math.random(),
            date: debt.week_start,
            amount: Number(debt.amount),
            kind: 'debt',
            comment: debt.comment ? debt.comment.substring(0, 50) + '...' : 'Авто долг'
          })
        }

        const salarySummary = calculateOperatorSalarySummary({
          operatorId,
          companies: (companies || []) as Array<{ id: string; code: string | null }>,
          rules: (rulesList || []) as Array<{
            company_code: string
            shift_type: 'day' | 'night'
            base_per_shift: number | null
            threshold1_turnover: number | null
            threshold1_bonus: number | null
            threshold2_turnover: number | null
            threshold2_bonus: number | null
          }>,
          incomes: (shifts || []).map((shift: any) => ({
            ...shift,
            operator_id: operatorId,
          })),
          adjustments: (adjustments || []).map((adjustment: any) => ({
            operator_id: operatorId,
            amount: adjustment.amount,
            kind: adjustment.kind,
          })),
          debts: (autoDebtsData || []).map((debt: any) => ({
            operator_id: operatorId,
            amount: Number(debt.amount || 0),
          })),
        })

        if (salarySummary.autoBonuses > 0) {
          history.push({
            id: Date.now() + Math.random(),
            date: dateRange.to,
            amount: salarySummary.autoBonuses,
            kind: 'auto_bonus',
            comment: 'Бонусы за выполнение плана'
          })
        }

        setSalaryStats({
          totalShifts: salarySummary.shifts,
          baseSalary: salarySummary.baseSalary,
          autoBonuses: salarySummary.autoBonuses,
          manualBonuses: salarySummary.manualBonuses,
          totalAccrued: salarySummary.totalAccrued,
          autoDebts: salarySummary.autoDebts,
          totalFines: salarySummary.totalFines,
          totalAdvances: salarySummary.totalAdvances,
          totalDeductions: salarySummary.totalDeductions,
          paidAmount: 0,
          remainingAmount: salarySummary.remainingAmount
        })

        history.sort((a, b) => b.date.localeCompare(a.date))
        setPaymentHistory(history.slice(0, 15))

        if (!levelRes.error && levelRes.data && levelRes.data.length > 0) {
          setLevelInfo(levelRes.data[0])
        }

        if (!achievementsRes.error && achievementsRes.data) {
          setAchievements(achievementsRes.data)
        }

      } catch (err: any) {
        console.error('❌ Ошибка:', err)
        setError(err?.message || 'Ошибка загрузки данных')
      } finally {
        setLoading(false)
      }
    }

    loadOperatorData()
  }, [router, dateRange])

  useEffect(() => {
    let mounted = true

    const syncWorkspaceSummary = async (quiet = false) => {
      try {
        if (!quiet) {
          setWorkspaceSummaryLoading(true)
        }

        const weekStart = getCurrentWeekStart()
        const [tasksRes, shiftsRes] = await Promise.all([
          fetch('/api/operator/tasks', { cache: 'no-store' }),
          fetch(`/api/operator/shifts?weekStart=${weekStart}`, { cache: 'no-store' }),
        ])

        if (!tasksRes.ok || !shiftsRes.ok) {
          throw new Error('Не удалось обновить статус-центр')
        }

        const [tasksPayload, shiftsPayload] = await Promise.all([tasksRes.json(), shiftsRes.json()])
        if (!mounted) return

        const nextSummary = buildWorkspaceSummary(
          Array.isArray(tasksPayload?.tasks) ? tasksPayload.tasks : [],
          Array.isArray(shiftsPayload?.schedule) ? shiftsPayload.schedule : [],
        )
        setWorkspaceSummary(nextSummary)
      } catch (workspaceError) {
        console.error('Workspace summary sync error', workspaceError)
      } finally {
        if (mounted) {
          setWorkspaceSummaryLoading(false)
        }
      }
    }

    void syncWorkspaceSummary()

    const interval = window.setInterval(() => {
      void syncWorkspaceSummary(true)
    }, 30000)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncWorkspaceSummary(true)
      }
    }

    window.addEventListener('focus', handleVisibility)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mounted = false
      window.clearInterval(interval)
      window.removeEventListener('focus', handleVisibility)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    startTransition(() => {
      router.push('/login')
    })
  }

  const navigateTo = (path: string) => {
    router.prefetch(path)
    startTransition(() => {
      router.push(path)
    })
  }

  const changeTab = (tab: 'salary' | 'schedule' | 'history' | 'profile') => {
    setActiveTab(tab)
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (tab === 'salary') {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    const nextUrl = params.toString() ? `/operator-dashboard?${params.toString()}` : '/operator-dashboard'
    startTransition(() => {
      router.replace(nextUrl, { scroll: false })
    })
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  }

  const formatDateRange = (from: string, to: string) => {
    const fromDate = new Date(from)
    const toDate = new Date(to)
    
    const fromStr = fromDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    const toStr = toDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    
    if (fromDate.getMonth() === toDate.getMonth() && fromDate.getFullYear() === toDate.getFullYear()) {
      return `${fromDate.getDate()} – ${toStr}`
    }
    return `${fromStr} – ${toStr}`
  }

  // Функция для получения названия уровня
  const getLevelTitle = (level: number) => {
    const titles = [
      'Новичок',
      'Стажер',
      'Опытный',
      'Профессионал',
      'Эксперт',
      'Мастер',
      'Грандмастер',
      'Легенда',
      'Миф',
      'Бог'
    ]
    return titles[level - 1] || 'Новичок'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-violet-500/30 border-t-violet-500 mx-auto mb-6" />
            <User className="w-8 h-8 text-violet-400 absolute top-4 left-1/2 -translate-x-1/2" />
          </div>
          <p className="text-gray-400">Загрузка личного кабинета...</p>
        </div>
      </div>
    )
  }

  if (error || !operator) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
        <Card className="p-8 max-w-md border-red-500/20 bg-red-500/5">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Ошибка</h2>
            <p className="text-gray-400">{error || 'Не удалось загрузить данные'}</p>
            <Button onClick={() => router.push('/login')} variant="outline" className="border-white/10">
              Вернуться на вход
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      {/* Шапка */}
      <header className="sticky top-0 z-10 border-b border-white/5 bg-gray-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 overflow-hidden rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 sm:h-11 sm:w-11">
              {operator.photo_url ? (
                <Image
                  src={operator.photo_url}
                  alt={operator.name}
                  width={44}
                  height={44}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white font-bold">
                  {getOperatorDisplayName(operator).charAt(0)}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-bold text-white sm:text-xl">{getOperatorDisplayName(operator)}</h1>
                {levelInfo && (
                  <div className="px-2 py-0.5 bg-violet-500/20 rounded-full border border-violet-500/30 flex items-center gap-1">
                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                    <span className="text-xs font-medium text-violet-400">Ур. {levelInfo.calculated_level}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400">{operator.position || 'Оператор'}</p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {/* Кнопка чата */}
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-emerald-400"
              onClick={() => navigateTo('/operator-chat')}
              title="Общий чат"
            >
              <MessageCircle className="w-5 h-5" />
            </Button>

            {/* Кнопка достижений */}
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-yellow-400"
              onClick={() => navigateTo('/operator-achievements')}
              title="Достижения"
            >
              <Trophy className="w-5 h-5" />
            </Button>

            {/* Настройки */}
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-white"
              onClick={() => navigateTo('/operator-settings')}
            >
              <Settings className="w-5 h-5" />
            </Button>

            {/* Выход */}
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-rose-400"
              onClick={handleLogout}
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-3 py-5 sm:px-4 sm:py-8 sm:space-y-8">
        {/* Баланс и уровень */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {/* Баланс */}
          <Card className="lg:col-span-3 p-6 bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border-white/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <p className="text-sm text-gray-400 mb-2">
                  Баланс за {formatDateRange(dateRange.from, dateRange.to)}
                </p>
                <p className="text-3xl font-bold text-white sm:text-4xl">
                  {salaryStats?.remainingAmount.toLocaleString()} ₸
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-gray-500">Начислено: {salaryStats?.totalAccrued.toLocaleString()} ₸</span>
                  <span className="text-gray-500">Вычтено: {salaryStats?.totalDeductions.toLocaleString()} ₸</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white/5 rounded-xl">
                  <p className="text-xs text-gray-500">Смен</p>
                  <p className="text-xl font-bold text-white">{salaryStats?.totalShifts}</p>
                </div>
                <div className="p-3 bg-white/5 rounded-xl">
                  <p className="text-xs text-gray-500">Ставка</p>
              <p className="text-xl font-bold text-emerald-400">{DEFAULT_SHIFT_BASE_PAY.toLocaleString('ru-RU')} ₸</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Карточка уровня */}
          {levelInfo && (
            <Card className="p-6 bg-gradient-to-br from-amber-600/20 to-yellow-600/20 border-yellow-500/20">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-yellow-500/20 rounded-lg">
                  <Trophy className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Уровень {levelInfo.calculated_level}</p>
                  <p className="text-sm font-bold text-white">{getLevelTitle(levelInfo.calculated_level)}</p>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Всего XP</span>
                  <span className="text-white font-bold">{levelInfo.total_xp}</span>
                </div>
                
                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-yellow-500 to-amber-500"
                    style={{ 
                      width: `${(levelInfo.total_xp / levelInfo.next_level_xp) * 100}%`
                    }}
                  />
                </div>
                
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">До уровня {levelInfo.calculated_level + 1}</span>
                  <span className="text-yellow-400 font-bold">{levelInfo.xp_to_next_level} XP</span>
                </div>

                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full text-xs text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
                    onClick={() => router.push('/operator-achievements')}
                  >
                    <Medal className="w-3 h-3 mr-1" />
                    {achievements.length} достижений
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>

        <Card className="p-5 bg-gray-900/50 border-white/5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <h2 className="text-lg font-semibold text-white">Статус-центр</h2>
              </div>
              <p className="text-sm text-gray-400 max-w-2xl">
                Быстрый обзор ваших задач и смен на текущую неделю. Блок обновляется сам, так что
                можно сразу видеть новые ответы руководителя и изменения по графику.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <Button onClick={() => changeTab('schedule')} className="w-full bg-violet-500 hover:bg-violet-400 sm:w-auto">
                <CalendarRange className="w-4 h-4 mr-2" />
                Мой график
              </Button>
              <Button variant="outline" className="w-full border-white/10 sm:w-auto" onClick={() => navigateTo('/operator-tasks')}>
                <Target className="w-4 h-4 mr-2" />
                Мои задачи
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-emerald-400 mb-2">
                <Target className="w-4 h-4" />
                <span className="text-xs uppercase tracking-[0.2em]">Активные задачи</span>
              </div>
              <p className="text-3xl font-semibold text-white">{workspaceSummary.activeTasks}</p>
              <p className="text-xs text-gray-500 mt-2">
                В работе, в бэклоге и ожидают запуска
              </p>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-amber-400 mb-2">
                <History className="w-4 h-4" />
                <span className="text-xs uppercase tracking-[0.2em]">На проверке</span>
              </div>
              <p className="text-3xl font-semibold text-white">{workspaceSummary.reviewTasks}</p>
              <p className="text-xs text-gray-500 mt-2">
                Задачи, где ждём решение руководителя
              </p>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sky-400 mb-2">
                <Calendar className="w-4 h-4" />
                <span className="text-xs uppercase tracking-[0.2em]">Подтвердить неделю</span>
              </div>
              <p className="text-3xl font-semibold text-white">{workspaceSummary.pendingWeekConfirmations}</p>
              <p className="text-xs text-gray-500 mt-2">
                Недели, где ещё нужен ваш ответ
              </p>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-rose-400 mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs uppercase tracking-[0.2em]">Открытые вопросы</span>
              </div>
              <p className="text-3xl font-semibold text-white">{workspaceSummary.openShiftIssues}</p>
              <p className="text-xs text-gray-500 mt-2">
                Запросы по сменам, которые ещё не закрыты
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Следующая смена</p>
              <p className="text-sm font-medium text-white mt-1">
                {workspaceSummary.nextShiftLabel || 'Смены на текущую неделю пока не назначены'}
              </p>
            </div>
            <div className="text-xs text-gray-500">
              {workspaceSummaryLoading ? 'Обновляем статус-центр...' : 'Сводка синхронизируется автоматически'}
            </div>
          </div>
        </Card>

        {/* Фильтр дат */}
        <Card className="border-white/5 bg-gray-900/40 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="w-4 h-4 text-violet-400" />
              <span className="text-sm text-gray-400">Период:</span>
              
              {!customRange ? (
                <button
                  onClick={() => setCustomRange(true)}
                  className="text-sm text-white hover:text-violet-400 transition-colors"
                >
                  {formatDateRange(dateRange.from, dateRange.to)}
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    value={dateRange.from}
                    onChange={(e) => {
                      setDateRange(prev => ({ ...prev, from: e.target.value }))
                    }}
                    className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                  />
                  <span className="text-gray-500">—</span>
                  <input
                    type="date"
                    value={dateRange.to}
                    onChange={(e) => {
                      setDateRange(prev => ({ ...prev, to: e.target.value }))
                    }}
                    className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                  />
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <div className="flex min-w-max items-center gap-2">
              {/* Кнопки выбора периода */}
              <Button
                size="sm"
                variant={periodType === 'week' ? 'default' : 'ghost'}
                onClick={() => setPeriod('week')}
                className="h-8 px-3 text-xs"
              >
                Неделя
              </Button>
              <Button
                size="sm"
                variant={periodType === 'month' ? 'default' : 'ghost'}
                onClick={() => setPeriod('month')}
                className="h-8 px-3 text-xs"
              >
                Месяц
              </Button>
              <Button
                size="sm"
                variant={periodType === 'all' ? 'default' : 'ghost'}
                onClick={() => setPeriod('all')}
                className="h-8 px-3 text-xs"
              >
                <HistoryIcon className="w-3 h-3 mr-1" />
                Всё время
              </Button>

              <div className="w-px h-6 bg-white/10 mx-1" />

              <Button
                size="sm"
                variant="ghost"
                onClick={goToPrevWeek}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={resetToCurrentWeek}
                className="h-8 px-3 text-xs"
              >
                Текущая
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={goToNextWeek}
                className="h-8 w-8 p-0"
                disabled={new Date(dateRange.to) >= new Date()}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>

              {customRange && periodType !== 'week' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetToCurrentWeek}
                  className="h-8 px-3 text-xs text-violet-400"
                >
                  Сброс
                </Button>
              )}
              </div>
            </div>
          </div>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(value) => changeTab(value as 'salary' | 'schedule' | 'history' | 'profile')} className="space-y-6">
          <TabsList className="h-auto w-full justify-start overflow-x-auto border-white/5 bg-gray-900/50">
            <TabsTrigger value="salary" className="data-[state=active]:bg-violet-500/20">
              <Wallet className="w-4 h-4 mr-2" />
              Зарплата
            </TabsTrigger>
            <TabsTrigger value="schedule" className="data-[state=active]:bg-violet-500/20">
              <CalendarRange className="w-4 h-4 mr-2" />
              График
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-violet-500/20">
              <History className="w-4 h-4 mr-2" />
              История
            </TabsTrigger>
            <TabsTrigger value="profile" className="data-[state=active]:bg-violet-500/20">
              <User className="w-4 h-4 mr-2" />
              Профиль
            </TabsTrigger>
          </TabsList>

          <TabsContent value="salary" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-6 bg-emerald-500/5 border-emerald-500/20">
                <div className="flex items-center gap-3 mb-3">
                  <DollarSign className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-medium text-white">База</h3>
                </div>
                <p className="text-2xl font-bold text-emerald-400">{salaryStats?.baseSalary.toLocaleString()} ₸</p>
                <p className="text-xs text-gray-500 mt-2">{salaryStats?.totalShifts} смен</p>
              </Card>

              <Card className="p-6 bg-amber-500/5 border-amber-500/20">
                <div className="flex items-center gap-3 mb-3">
                  <Zap className="w-5 h-5 text-amber-400" />
                  <h3 className="font-medium text-white">Авто-бонусы</h3>
                </div>
                <p className="text-2xl font-bold text-amber-400">+{salaryStats?.autoBonuses.toLocaleString()} ₸</p>
                <p className="text-xs text-gray-500 mt-2">За выручку</p>
              </Card>

              <Card className="p-6 bg-violet-500/5 border-violet-500/20">
                <div className="flex items-center gap-3 mb-3">
                  <Award className="w-5 h-5 text-violet-400" />
                  <h3 className="font-medium text-white">Ручные премии</h3>
                </div>
                <p className="text-2xl font-bold text-violet-400">+{salaryStats?.manualBonuses.toLocaleString()} ₸</p>
              </Card>

              <Card className="p-6 bg-rose-500/5 border-rose-500/20">
                <div className="flex items-center gap-3 mb-3">
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                  <h3 className="font-medium text-white">Штрафы</h3>
                </div>
                <p className="text-2xl font-bold text-rose-400">-{salaryStats?.totalFines.toLocaleString()} ₸</p>
                <p className="text-xs text-gray-500 mt-2">Включая ручные долги</p>
              </Card>

              <Card className="p-6 bg-blue-500/5 border-blue-500/20">
                <div className="flex items-center gap-3 mb-3">
                  <CreditCard className="w-5 h-5 text-blue-400" />
                  <h3 className="font-medium text-white">Авансы</h3>
                </div>
                <p className="text-2xl font-bold text-blue-400">-{salaryStats?.totalAdvances.toLocaleString()} ₸</p>
              </Card>

              <Card className="p-6 bg-purple-500/5 border-purple-500/20">
                <div className="flex items-center gap-3 mb-3">
                  <Landmark className="w-5 h-5 text-purple-400" />
                  <h3 className="font-medium text-white">Авто-долги</h3>
                </div>
                <p className="text-2xl font-bold text-purple-400">-{salaryStats?.autoDebts.toLocaleString()} ₸</p>
                <p className="text-xs text-gray-500 mt-2">Из программы</p>
              </Card>

              <Card className="p-6 bg-emerald-500/5 border-emerald-500/20">
                <div className="flex items-center gap-3 mb-3">
                  <Wallet className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-medium text-white">Выплачено</h3>
                </div>
                <p className="text-2xl font-bold text-emerald-400">0 ₸</p>
              </Card>

              <Card className="p-6 bg-gradient-to-br from-violet-500 to-fuchsia-500 border-0">
                <div className="flex items-center gap-3 mb-3">
                  <Sparkles className="w-5 h-5 text-white" />
                  <h3 className="font-medium text-white">К выплате</h3>
                </div>
                <p className="text-2xl font-bold text-white">{salaryStats?.remainingAmount.toLocaleString()} ₸</p>
              </Card>
            </div>

            <Card className="p-6 bg-gray-900/50 border-white/5">
              <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4 text-violet-400" />
                Детализация за {formatDateRange(dateRange.from, dateRange.to)}
              </h3>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white/5 rounded-lg">
                  <span className="text-sm text-gray-400">
                    База ({salaryStats?.totalShifts} смен × {DEFAULT_SHIFT_BASE_PAY.toLocaleString('ru-RU')} ₸)
                  </span>
                  <span className="text-sm font-medium text-white shrink-0">+{salaryStats?.baseSalary.toLocaleString()} ₸</span>
                </div>

                {salaryStats && salaryStats.autoBonuses > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Авто-бонусы (за выручку)</span>
                    <span className="text-sm font-medium text-amber-400 shrink-0">+{salaryStats.autoBonuses.toLocaleString()} ₸</span>
                  </div>
                )}

                {salaryStats && salaryStats.manualBonuses > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Ручные премии</span>
                    <span className="text-sm font-medium text-violet-400 shrink-0">+{salaryStats.manualBonuses.toLocaleString()} ₸</span>
                  </div>
                )}

                {salaryStats && salaryStats.totalFines > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Штрафы + ручные долги</span>
                    <span className="text-sm font-medium text-rose-400 shrink-0">-{salaryStats.totalFines.toLocaleString()} ₸</span>
                  </div>
                )}

                {salaryStats && salaryStats.totalAdvances > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Авансы</span>
                    <span className="text-sm font-medium text-rose-400 shrink-0">-{salaryStats.totalAdvances.toLocaleString()} ₸</span>
                  </div>
                )}

                {salaryStats && salaryStats.autoDebts > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Авто-долги (из программы)</span>
                    <span className="text-sm font-medium text-rose-400 shrink-0">-{salaryStats.autoDebts.toLocaleString()} ₸</span>
                  </div>
                )}

                <div className="h-px bg-white/5 my-2" />
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-violet-500/20 rounded-lg">
                  <span className="text-sm font-medium text-white">Итого к выплате</span>
                  <span className="text-lg font-bold text-violet-400 shrink-0">{salaryStats?.remainingAmount.toLocaleString()} ₸</span>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="schedule" className="space-y-6">
            <OperatorSchedulePanel onOpenTasks={() => navigateTo('/operator-tasks')} />
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <Card className="p-6 bg-gray-900/50 border-white/5">
              <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                <History className="w-4 h-4 text-violet-400" />
                История операций за {formatDateRange(dateRange.from, dateRange.to)}
              </h3>
              
              {paymentHistory.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  Нет операций за выбранный период
                </p>
              ) : (
                <div className="space-y-3">
                  {paymentHistory.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white/5 rounded-lg">
                      <div className="flex items-center gap-3 min-w-0">
                        {item.kind === 'bonus' && <Award className="w-4 h-4 text-violet-400 shrink-0" />}
                        {item.kind === 'auto_bonus' && <Zap className="w-4 h-4 text-amber-400 shrink-0" />}
                        {item.kind === 'fine' && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
                        {item.kind === 'advance' && <CreditCard className="w-4 h-4 text-blue-400 shrink-0" />}
                        {item.kind === 'debt' && <Landmark className="w-4 h-4 text-purple-400 shrink-0" />}
                        {item.kind === 'salary' && <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{item.comment}</p>
                          <p className="text-xs text-gray-500">{new Date(item.date).toLocaleDateString('ru-RU')}</p>
                        </div>
                      </div>
                      <span className={`text-sm font-medium shrink-0 ${
                        ['bonus', 'auto_bonus', 'salary'].includes(item.kind) ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {['bonus', 'auto_bonus', 'salary'].includes(item.kind) ? '+' : '-'}{item.amount.toLocaleString()} ₸
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <Card className="p-6 bg-gray-900/50 border-white/5">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden flex-shrink-0">
                  {operator.photo_url ? (
                    <Image
                      src={operator.photo_url}
                      alt={operator.name}
                      width={96}
                      height={96}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-3xl font-bold">
                      {getOperatorDisplayName(operator).charAt(0)}
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-gray-500" />
                      <span className="text-gray-400">{operator.name}</span>
                    </div>
                    {operator.short_name && (
                      <div className="flex items-center gap-2 text-sm">
                        <Briefcase className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-400">{operator.short_name}</span>
                      </div>
                    )}
                    {operator.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-400">{operator.phone}</span>
                      </div>
                    )}
                    {operator.email && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-400">{operator.email}</span>
                      </div>
                    )}
                    {operator.position && (
                      <div className="flex items-center gap-2 text-sm">
                        <Building2 className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-400">{operator.position}</span>
                      </div>
                    )}
                    {operator.hire_date && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-400">
                          С {new Date(operator.hire_date).toLocaleDateString('ru-RU')}
                        </span>
                      </div>
                    )}
                  </div>

                  {levelInfo && (
                    <div className="mt-4 p-4 bg-gradient-to-br from-amber-500/10 to-yellow-500/10 rounded-xl border border-yellow-500/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-400">Достижения</span>
                        <span className="text-sm text-yellow-400">{achievements.length} получено</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                        onClick={() => router.push('/operator-achievements')}
                      >
                        <Trophy className="w-4 h-4 mr-2" />
                        Все достижения
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
