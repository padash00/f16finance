'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

type Company = {
  id: string
  code: string
}

type SalaryRule = {
  company_code: string
  shift_type: 'day' | 'night'
  base_per_shift: number
  threshold1_turnover: number
  threshold1_bonus: number
  threshold2_turnover: number
  threshold2_bonus: number
}

// Константа с датой запуска системы (1 ноября 2025)
const SYSTEM_START_DATE = '2025-11-01'

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

  // Функция для форматирования даты в локальный формат
  const formatDateForInput = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Функция для получения диапазона текущей недели (пн-вс)
  const getWeekRange = () => {
    const now = new Date()
    
    // Находим понедельник текущей недели
    const monday = new Date(now)
    const day = monday.getDay() || 7 // воскресенье = 7
    if (day !== 1) {
      monday.setDate(monday.getDate() - (day - 1))
    }
    monday.setHours(0, 0, 0, 0)
    
    // Находим воскресенье
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)
    
    return {
      from: formatDateForInput(monday),
      to: formatDateForInput(sunday)
    }
  }

  // Функция для получения диапазона текущего месяца
  const getMonthRange = () => {
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    
    return {
      from: formatDateForInput(firstDay),
      to: formatDateForInput(lastDay)
    }
  }

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
        
        console.log('1️⃣ Проверяем авторизацию...')
        
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        
        if (userError) throw new Error(userError.message)
        if (!user) {
          router.push('/login')
          return
        }

        console.log('2️⃣ Пользователь найден:', user.id)

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
              operator_profiles (
                photo_url,
                position,
                phone,
                email,
                hire_date
              )
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
          short_name: op.short_name,
          photo_url: profile.photo_url,
          position: profile.position,
          phone: profile.phone,
          email: profile.email,
          hire_date: profile.hire_date,
        })

        const operatorId = op.id

        // ========== ЗАГРУЖАЕМ ДАННЫЕ ЗА ВЫБРАННЫЙ ПЕРИОД ==========
        console.log('📅 Период:', dateRange.from, '→', dateRange.to)

        // Загружаем компании
        const { data: companies, error: companiesError } = await supabase
          .from('companies')
          .select('id, code')

        if (companiesError) throw new Error(companiesError.message)

        const companyMap = new Map<string, string>()
        for (const c of companies || []) {
          companyMap.set(c.id, c.code)
        }

        // Загружаем правила зарплаты
        const { data: rulesList, error: rulesError } = await supabase
          .from('operator_salary_rules')
          .select('company_code, shift_type, base_per_shift, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus')
          .eq('is_active', true)

        if (rulesError) throw new Error(rulesError.message)

        const rulesMap = new Map<string, SalaryRule>()
        for (const rule of rulesList || []) {
          const key = `${rule.company_code}_${rule.shift_type}`
          rulesMap.set(key, rule as SalaryRule)
        }

        // Загружаем смены
        const { data: shifts, error: shiftsError } = await supabase
          .from('incomes')
          .select('id, date, shift, cash_amount, kaspi_amount, card_amount, company_id')
          .eq('operator_id', operatorId)
          .gte('date', dateRange.from)
          .lte('date', dateRange.to)

        if (shiftsError) throw new Error(shiftsError.message)

        console.log(`📊 Загружено смен: ${shifts?.length || 0} за период ${dateRange.from} - ${dateRange.to}`)

        // Подсчет уникальных смен
        const shiftSet = new Set<string>()
        for (const shift of shifts || []) {
          const turnover = (shift.cash_amount || 0) + (shift.kaspi_amount || 0) + (shift.card_amount || 0)
          if (turnover > 0) {
            const shiftKey = `${shift.date}|${shift.company_id}|${shift.shift || 'day'}`
            shiftSet.add(shiftKey)
          }
        }
        
        const totalShifts = shiftSet.size
        const basePerShift = 8000
        const baseSalary = totalShifts * basePerShift

        // Расчет авто-бонусов
        let totalAutoBonuses = 0
        
        for (const shift of shifts || []) {
          const turnover = (shift.cash_amount || 0) + (shift.kaspi_amount || 0) + (shift.card_amount || 0)
          const companyCode = companyMap.get(shift.company_id)
          if (!companyCode) continue
          
          const shiftType = shift.shift || 'day'
          const ruleKey = `${companyCode}_${shiftType}`
          const rule = rulesMap.get(ruleKey)
          
          if (!rule) continue
          
          let shiftBonus = 0
          if (rule.threshold1_turnover && turnover >= rule.threshold1_turnover) {
            shiftBonus += rule.threshold1_bonus || 0
          }
          if (rule.threshold2_turnover && turnover >= rule.threshold2_turnover) {
            shiftBonus += rule.threshold2_bonus || 0
          }
          
          totalAutoBonuses += shiftBonus
        }

        // Загружаем корректировки
        const { data: adjustments, error: adjustmentsError } = await supabase
          .from('operator_salary_adjustments')
          .select('amount, kind, date, comment')
          .eq('operator_id', operatorId)
          .gte('date', dateRange.from)
          .lte('date', dateRange.to)

        if (adjustmentsError) throw new Error(adjustmentsError.message)

        let totalManualBonuses = 0
        let totalFines = 0
        let totalAdvances = 0
        const history: PaymentHistory[] = []

        for (const adj of adjustments || []) {
          if (adj.kind === 'bonus') {
            totalManualBonuses += adj.amount
            history.push({
              id: Date.now() + Math.random(),
              date: adj.date,
              amount: adj.amount,
              kind: 'bonus',
              comment: adj.comment || 'Премия'
            })
          } else if (adj.kind === 'advance') {
            totalAdvances += adj.amount
            history.push({
              id: Date.now() + Math.random(),
              date: adj.date,
              amount: adj.amount,
              kind: 'advance',
              comment: adj.comment || 'Аванс'
            })
          } else {
            totalFines += adj.amount
            history.push({
              id: Date.now() + Math.random(),
              date: adj.date,
              amount: adj.amount,
              kind: 'fine',
              comment: adj.comment || (adj.kind === 'fine' ? 'Штраф' : 'Ручной долг')
            })
          }
        }

        // Загружаем автоматические долги
        const { data: autoDebtsData, error: debtsError } = await supabase
          .from('debts')
          .select('amount, date, comment')
          .eq('operator_id', operatorId)
          .gte('date', dateRange.from)
          .lte('date', dateRange.to)
          .eq('status', 'active')

        if (debtsError) throw new Error(debtsError.message)

        const totalAutoDebts = (autoDebtsData || []).reduce((sum, d) => sum + (Number(d.amount) || 0), 0)
        
        for (const debt of autoDebtsData || []) {
          history.push({
            id: Date.now() + Math.random(),
            date: debt.date,
            amount: Number(debt.amount),
            kind: 'debt',
            comment: debt.comment ? debt.comment.substring(0, 50) + '...' : 'Авто долг'
          })
        }

        // Добавляем авто-бонусы в историю
        if (totalAutoBonuses > 0) {
          history.push({
            id: Date.now() + Math.random(),
            date: dateRange.to,
            amount: totalAutoBonuses,
            kind: 'auto_bonus',
            comment: 'Бонусы за выполнение плана'
          })
        }

        // Итоговый расчет
        const totalAccrued = baseSalary + totalAutoBonuses + totalManualBonuses
        const totalDeductions = totalAutoDebts + totalFines + totalAdvances
        const remainingAmount = totalAccrued - totalDeductions

        console.log('🧮 ИТОГО:', {
          totalShifts,
          baseSalary,
          autoBonuses: totalAutoBonuses,
          manualBonuses: totalManualBonuses,
          totalAccrued,
          autoDebts: totalAutoDebts,
          fines: totalFines,
          advances: totalAdvances,
          totalDeductions,
          remaining: remainingAmount
        })

        setSalaryStats({
          totalShifts,
          baseSalary,
          autoBonuses: totalAutoBonuses,
          manualBonuses: totalManualBonuses,
          totalAccrued,
          autoDebts: totalAutoDebts,
          totalFines,
          totalAdvances,
          totalDeductions,
          paidAmount: 0,
          remainingAmount
        })

        history.sort((a, b) => b.date.localeCompare(a.date))
        setPaymentHistory(history.slice(0, 15))

        // ========== ЗАГРУЖАЕМ ДАННЫЕ О ДОСТИЖЕНИЯХ ==========
        console.log('🏆 Загружаем достижения...')
        
        // Получаем уровень и XP
        const { data: levelData, error: levelError } = await supabase
          .rpc('get_operator_level_info', { operator_uuid: operatorId })

        if (!levelError && levelData && levelData.length > 0) {
          setLevelInfo(levelData[0])
        }

        // Получаем все ачивки
        const { data: achievementsData, error: achievementsError } = await supabase
          .rpc('get_operator_achievements', { operator_uuid: operatorId })

        if (!achievementsError && achievementsData) {
          setAchievements(achievementsData)
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

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
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
      <header className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden">
              {operator.photo_url ? (
                <Image
                  src={operator.photo_url}
                  alt={operator.name}
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white font-bold">
                  {operator.name.charAt(0)}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">{operator.short_name || operator.name}</h1>
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

          <div className="flex items-center gap-2">
            {/* Кнопка чата */}
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-emerald-400"
              onClick={() => router.push('/operator-chat')}
              title="Общий чат"
            >
              <MessageCircle className="w-5 h-5" />
            </Button>

            {/* Кнопка достижений */}
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-yellow-400"
              onClick={() => router.push('/operator-achievements')}
              title="Достижения"
            >
              <Trophy className="w-5 h-5" />
            </Button>

            {/* Настройки */}
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-white"
              onClick={() => router.push('/operator-settings')}
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

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Баланс и уровень */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Баланс */}
          <Card className="lg:col-span-3 p-6 bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border-white/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <p className="text-sm text-gray-400 mb-2">
                  Баланс за {formatDateRange(dateRange.from, dateRange.to)}
                </p>
                <p className="text-4xl font-bold text-white">
                  {salaryStats?.remainingAmount.toLocaleString()} ₸
                </p>
                <div className="flex items-center gap-4 mt-4 text-xs">
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
                  <p className="text-xl font-bold text-emerald-400">8 000 ₸</p>
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

        {/* Фильтр дат */}
        <Card className="p-4 bg-gray-900/40 border-white/5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
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

            <div className="flex items-center gap-2">
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
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="salary" className="space-y-6">
          <TabsList className="bg-gray-900/50 border-white/5">
            <TabsTrigger value="salary" className="data-[state=active]:bg-violet-500/20">
              <Wallet className="w-4 h-4 mr-2" />
              Зарплата
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
                <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                  <span className="text-sm text-gray-400">
                    Базовая зарплата ({salaryStats?.totalShifts} смен × 8 000 ₸)
                  </span>
                  <span className="text-sm font-medium text-white">+{salaryStats?.baseSalary.toLocaleString()} ₸</span>
                </div>
                
                {salaryStats && salaryStats.autoBonuses > 0 && (
                  <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Авто-бонусы (за выручку)</span>
                    <span className="text-sm font-medium text-amber-400">+{salaryStats.autoBonuses.toLocaleString()} ₸</span>
                  </div>
                )}

                {salaryStats && salaryStats.manualBonuses > 0 && (
                  <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Ручные премии</span>
                    <span className="text-sm font-medium text-violet-400">+{salaryStats.manualBonuses.toLocaleString()} ₸</span>
                  </div>
                )}

                {salaryStats && salaryStats.totalFines > 0 && (
                  <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Штрафы + ручные долги</span>
                    <span className="text-sm font-medium text-rose-400">-{salaryStats.totalFines.toLocaleString()} ₸</span>
                  </div>
                )}

                {salaryStats && salaryStats.totalAdvances > 0 && (
                  <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Авансы</span>
                    <span className="text-sm font-medium text-rose-400">-{salaryStats.totalAdvances.toLocaleString()} ₸</span>
                  </div>
                )}

                {salaryStats && salaryStats.autoDebts > 0 && (
                  <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                    <span className="text-sm text-gray-400">Авто-долги (из программы)</span>
                    <span className="text-sm font-medium text-rose-400">-{salaryStats.autoDebts.toLocaleString()} ₸</span>
                  </div>
                )}

                <div className="h-px bg-white/5 my-2" />
                <div className="flex justify-between items-center p-3 bg-violet-500/20 rounded-lg">
                  <span className="text-sm font-medium text-white">Итого к выплате</span>
                  <span className="text-lg font-bold text-violet-400">{salaryStats?.remainingAmount.toLocaleString()} ₸</span>
                </div>
              </div>
            </Card>
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
                    <div key={item.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                      <div className="flex items-center gap-3">
                        {item.kind === 'bonus' && <Award className="w-4 h-4 text-violet-400" />}
                        {item.kind === 'auto_bonus' && <Zap className="w-4 h-4 text-amber-400" />}
                        {item.kind === 'fine' && <AlertTriangle className="w-4 h-4 text-rose-400" />}
                        {item.kind === 'advance' && <CreditCard className="w-4 h-4 text-blue-400" />}
                        {item.kind === 'debt' && <Landmark className="w-4 h-4 text-purple-400" />}
                        {item.kind === 'salary' && <Wallet className="w-4 h-4 text-emerald-400" />}
                        <div>
                          <p className="text-sm text-white">{item.comment}</p>
                          <p className="text-xs text-gray-500">{new Date(item.date).toLocaleDateString('ru-RU')}</p>
                        </div>
                      </div>
                      <span className={`text-sm font-medium ${
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
                      {operator.name.charAt(0)}
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