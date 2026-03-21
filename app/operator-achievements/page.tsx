// app/operator-achievements/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Trophy,
  Award,
  Medal,
  Star,
  Zap,
  Clock,
  Calendar,
  LogOut,
  Settings,
  Home,
  Sparkles,
  Target,
  TrendingUp,
  Shield,
  AlertTriangle,
  CreditCard,
  Landmark,
  Briefcase,
  Building2,
  Gift,
  Lock,
  ChevronRight,
  Loader2,
  User,
  FileText,
  Phone,
  Mail,
  X,
  Info,
  CheckCircle,
  HelpCircle,
  Flame,
  Coffee,
  Moon,
  Sun,
  Baby,
  Footprints,
  Trees,
  Leaf,
  Crown,
  Gem,
  Diamond,
  Star as StarIcon,
} from 'lucide-react'

type Achievement = {
  achievement_key: string
  achievement_name: string
  achievement_description: string
  achieved_at: string
  xp_reward: number
}

type AchievementWithDetails = Achievement & {
  details?: {
    condition: string
    hint?: string
    category: string
    icon?: string
  }
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

// Функция для получения деталей достижения (ОБНОВЛЕНА)
const getAchievementDetails = (key: string): { condition: string; hint?: string; category: string } => {
  const details: Record<string, { condition: string; hint?: string; category: string }> = {
    // СТАЖ (НОВЫЕ АЧИВКИ)
    'tenure_newbie': { 
      condition: 'Начать работу в компании',
      hint: 'Выдается при создании профиля',
      category: 'tenure'
    },
    'tenure_3months': { 
      condition: 'Проработать в компании 3 месяца',
      hint: 'Уже не новичок!',
      category: 'tenure'
    },
    'tenure_6months': { 
      condition: 'Проработать в компании 6 месяцев',
      hint: 'Полгода - серьезный срок',
      category: 'tenure'
    },
    'tenure_8months': { 
      condition: 'Проработать в компании 8 месяцев',
      hint: 'Скоро первый юбилей!',
      category: 'tenure'
    },
    'tenure_1year': { 
      condition: 'Проработать в компании 1 год',
      hint: 'Поздравляем с первым юбилеем!',
      category: 'tenure'
    },
    'tenure_18months': { 
      condition: 'Проработать в компании 1.5 года',
      hint: 'Полтора года - уже опытный сотрудник',
      category: 'tenure'
    },
    'tenure_2years': { 
      condition: 'Проработать в компании 2 года',
      hint: 'Два года - стабильность',
      category: 'tenure'
    },
    'tenure_30months': { 
      condition: 'Проработать в компании 2.5 года',
      hint: 'Полпути до трех лет',
      category: 'tenure'
    },
    'tenure_3years': { 
      condition: 'Проработать в компании 3 года',
      hint: 'Три года - настоящий ветеран!',
      category: 'tenure'
    },
    'tenure_4years': { 
      condition: 'Проработать в компании 4 года',
      hint: 'Четыре года - гордость компании',
      category: 'tenure'
    },
    'tenure_5years': { 
      condition: 'Проработать в компании 5 лет',
      hint: 'Пять лет! Вы легенда!',
      category: 'tenure'
    },
    'tenure_6years': { 
      condition: 'Проработать в компании 6 лет',
      hint: 'Шесть лет преданности',
      category: 'tenure'
    },
    'tenure_7years': { 
      condition: 'Проработать в компании 7 лет',
      hint: 'Семь лет - мудрость и опыт',
      category: 'tenure'
    },
    'tenure_8years': { 
      condition: 'Проработать в компании 8 лет',
      hint: 'Восемь лет - костяк команды',
      category: 'tenure'
    },
    'tenure_9years': { 
      condition: 'Проработать в компании 9 лет',
      hint: 'Девять лет - скоро десятка!',
      category: 'tenure'
    },
    'tenure_10years': { 
      condition: 'Проработать в компании 10 лет',
      hint: 'ДЕСЯТЬ ЛЕТ! НАСТОЯЩАЯ ЛЕГЕНДА!',
      category: 'tenure'
    },
    
    // Смены
    'shift_1': { 
      condition: 'Провести первую смену',
      hint: 'Поздравляем с началом пути!',
      category: 'shifts'
    },
    'shift_10': { 
      condition: 'Провести 10 смен',
      hint: 'Уверенное начало',
      category: 'shifts'
    },
    'shift_50': { 
      condition: 'Провести 50 смен',
      hint: 'Набираете опыт',
      category: 'shifts'
    },
    'shift_100': { 
      condition: 'Провести 100 смен',
      hint: 'Сотня смен позади!',
      category: 'shifts'
    },
    'shift_250': { 
      condition: 'Провести 250 смен',
      hint: 'Серьезный результат',
      category: 'shifts'
    },
    'shift_500': { 
      condition: 'Провести 500 смен',
      hint: 'Мастер своего дела',
      category: 'shifts'
    },
    'shift_1000': { 
      condition: 'Провести 1000 смен',
      hint: 'Тысяча смен! Это легендарно!',
      category: 'shifts'
    },
    
    // Штрафы
    'no_fines_1month': { 
      condition: 'Не получать штрафов в течение 1 месяца',
      hint: 'Дисциплина - залог успеха',
      category: 'fines'
    },
    'no_fines_3months': { 
      condition: 'Не получать штрафов в течение 3 месяцев',
      hint: 'Образцовый работник',
      category: 'fines'
    },
    'no_fines_6months': { 
      condition: 'Не получать штрафов в течение 6 месяцев',
      hint: 'Безупречная работа',
      category: 'fines'
    },
    'no_fines_1year': { 
      condition: 'Не получать штрафов в течение 1 года',
      hint: 'Идеальный оператор!',
      category: 'fines'
    },
    'reformed': { 
      condition: 'Был штраф, но после этого 2 месяца без штрафов',
      hint: 'Умение исправляться - важное качество',
      category: 'fines'
    },
    
    // Долги
    'no_debts_1month': { 
      condition: 'Не иметь долгов в течение 1 месяца',
      hint: 'Финансовая дисциплина',
      category: 'debts'
    },
    'no_debts_3months': { 
      condition: 'Не иметь долгов в течение 3 месяцев',
      hint: 'Ответственный подход',
      category: 'debts'
    },
    'no_debts_6months': { 
      condition: 'Не иметь долгов в течение 6 месяцев',
      hint: 'Надежный сотрудник',
      category: 'debts'
    },
    'no_debts_1year': { 
      condition: 'Не иметь долгов в течение 1 года',
      hint: 'Кристальная репутация!',
      category: 'debts'
    },
    
    // Премии
    'first_bonus': { 
      condition: 'Получить первую премию',
      hint: 'Отличная работа замечена!',
      category: 'bonuses'
    },
    'bonus_5': { 
      condition: 'Получить 5 премий',
      hint: 'Стабильно высокие результаты',
      category: 'bonuses'
    },
    'bonus_10': { 
      condition: 'Получить 10 премий',
      hint: 'Звезда компании!',
      category: 'bonuses'
    },
    'bonus_record': { 
      condition: 'Получить самую большую премию',
      hint: 'Рекордсмен по премиям',
      category: 'bonuses'
    },
    
    // Авансы
    'advance_5': { 
      condition: 'Взять аванс 5 раз',
      hint: 'Доверие компании',
      category: 'advances'
    },
    'no_advance_6months': { 
      condition: 'Не брать аванс 6 месяцев',
      hint: 'Финансовая независимость',
      category: 'advances'
    },
    'no_advance_1year': { 
      condition: 'Не брать аванс 1 год',
      hint: 'Абсолютная самостоятельность',
      category: 'advances'
    },
    
    // Универсальность
    'universal': { 
      condition: 'Поработать во всех компаниях (Arena, Ramen, Extra)',
      hint: 'Мастер на все руки',
      category: 'universal'
    },
    'master_of_all': { 
      condition: 'Поработать во всех компаниях и во всех типах смен (день/ночь)',
      hint: 'Настоящий универсал!',
      category: 'universal'
    },
  }
  
  return details[key] || { 
    condition: 'Особое достижение', 
    hint: 'Продолжайте в том же духе!',
    category: 'other'
  }
}

// Функция для получения XP за уровень
const getXpForLevel = (level: number): number => {
  const xpRequirements = [0, 1000, 2500, 5000, 10000, 20000, 35000, 50000, 75000, 100000]
  return xpRequirements[level - 1] || 0
}

// Функция для получения иконки категории (ОБНОВЛЕНА)
const getCategoryIcon = (category: string, key: string = '', className: string = 'w-5 h-5') => {
  // Специальные иконки для разных ачивок стажа
  if (category === 'tenure') {
    if (key.includes('newbie')) return <Baby className={className} />
    if (key.includes('3months')) return <Footprints className={className} />
    if (key.includes('6months')) return <Leaf className={className} />
    if (key.includes('8months')) return <Trees className={className} />
    if (key.includes('1year')) return <Crown className={className} />
    if (key.includes('2years')) return <StarIcon className={className} />
    if (key.includes('3years')) return <Gem className={className} />
    if (key.includes('5years')) return <Diamond className={className} />
    if (key.includes('10years')) return <Flame className={className} />
    return <Clock className={className} />
  }
  
  switch(category) {
    case 'tenure': return <Clock className={className} />
    case 'shifts': return <Briefcase className={className} />
    case 'fines': return <AlertTriangle className={className} />
    case 'debts': return <Landmark className={className} />
    case 'bonuses': return <Award className={className} />
    case 'advances': return <CreditCard className={className} />
    case 'universal': return <Target className={className} />
    default: return <Trophy className={className} />
  }
}

// Функция для получения цвета категории
const getCategoryColor = (category: string): string => {
  switch(category) {
    case 'tenure': return 'text-blue-400'
    case 'shifts': return 'text-emerald-400'
    case 'fines': return 'text-rose-400'
    case 'debts': return 'text-amber-400'
    case 'bonuses': return 'text-violet-400'
    case 'advances': return 'text-cyan-400'
    case 'universal': return 'text-yellow-400'
    default: return 'text-purple-400'
  }
}

export default function OperatorAchievementsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [operator, setOperator] = useState<Operator | null>(null)
  const [achievements, setAchievements] = useState<AchievementWithDetails[]>([])
  const [levelInfo, setLevelInfo] = useState<LevelInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedAchievement, setSelectedAchievement] = useState<AchievementWithDetails | null>(null)

  // Категории достижений
  const categories = [
    { id: 'all', name: 'Все', icon: Trophy, color: 'text-purple-400', desc: 'Все полученные достижения' },
    { id: 'tenure', name: 'Стаж', icon: Clock, color: 'text-blue-400', desc: 'Достижения за верность компании' },
    { id: 'shifts', name: 'Смены', icon: Briefcase, color: 'text-emerald-400', desc: 'Количество отработанных смен' },
    { id: 'fines', name: 'Штрафы', icon: AlertTriangle, color: 'text-rose-400', desc: 'Достижения за отсутствие штрафов' },
    { id: 'debts', name: 'Долги', icon: Landmark, color: 'text-amber-400', desc: 'Финансовая дисциплина' },
    { id: 'bonuses', name: 'Премии', icon: Award, color: 'text-violet-400', desc: 'Награды за выдающиеся результаты' },
    { id: 'advances', name: 'Авансы', icon: CreditCard, color: 'text-cyan-400', desc: 'Достижения по авансам' },
    { id: 'universal', name: 'Универсал', icon: Target, color: 'text-yellow-400', desc: 'Работа в разных местах' },
  ]

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        
        // Получаем пользователя
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        // Получаем данные оператора
        const { data: authData, error: authError } = await supabase
          .from('operator_auth')
          .select(`
            operator_id,
            operators (
              id,
              name,
              short_name,
              operator_profiles (*)
            )
          `)
          .eq('user_id', user.id)
          .maybeSingle()

        if (authError) throw authError
        if (!authData) {
          router.push('/login')
          return
        }

        const op = authData.operators as any
        const profile = op?.operator_profiles || {}
        const operatorId = op.id

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

        // Загружаем уровень и XP
        const { data: levelData, error: levelError } = await supabase
          .rpc('get_operator_level_info', { operator_uuid: operatorId })

        if (levelError) {
          console.error('Error loading level:', levelError)
        } else if (levelData && levelData.length > 0) {
          setLevelInfo(levelData[0])
        }

        // Загружаем все ачивки
        const { data: achievementsData, error: achievementsError } = await supabase
          .rpc('get_operator_achievements', { operator_uuid: operatorId })

        if (achievementsError) {
          console.error('Error loading achievements:', achievementsError)
        } else if (achievementsData) {
          // Добавляем детали к каждой ачивке
          const achievementsWithDetails = achievementsData.map((ach: Achievement) => ({
            ...ach,
            details: getAchievementDetails(ach.achievement_key)
          }))
          setAchievements(achievementsWithDetails)
        }

      } catch (err: any) {
        console.error('Ошибка:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Фильтрация достижений по категории
  const filteredAchievements = achievements.filter(ach => {
    if (selectedCategory === 'all') return true
    return ach.details?.category === selectedCategory
  })

  // Группировка по дате
  const groupedByMonth = filteredAchievements.reduce((acc, ach) => {
    const date = new Date(ach.achieved_at)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!acc[monthKey]) acc[monthKey] = []
    acc[monthKey].push(ach)
    return acc
  }, {} as Record<string, AchievementWithDetails[]>)

  // Сортировка месяцев (новые сверху)
  const sortedMonths = Object.keys(groupedByMonth).sort().reverse()

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

  // Форматирование даты
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatMonth = (monthKey: string) => {
    const [year, month] = monthKey.split('-')
    const date = new Date(parseInt(year), parseInt(month) - 1, 1)
    return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-violet-500/30 border-t-violet-500 mx-auto mb-6" />
            <Trophy className="w-8 h-8 text-yellow-400 absolute top-4 left-1/2 -translate-x-1/2" />
          </div>
          <p className="text-gray-400">Загрузка достижений...</p>
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
            <Button onClick={() => router.push('/operator-dashboard')} variant="outline" className="border-white/10">
              Вернуться в дашборд
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
            <Link href="/operator-dashboard">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <Home className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-white">Достижения</h1>
              <p className="text-xs text-gray-400">{getOperatorDisplayName(operator)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-white"
              onClick={() => router.push('/operator-settings')}
            >
              <Settings className="w-5 h-5" />
            </Button>
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

      {/* Модальное окно с деталями достижения */}
      {selectedAchievement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <Card className="max-w-md w-full bg-gray-900 border-white/10 p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl bg-gradient-to-br from-yellow-500/20 to-amber-500/20`}>
                  {getCategoryIcon(
                    selectedAchievement.details?.category || 'other', 
                    selectedAchievement.achievement_key,
                    'w-6 h-6 text-yellow-400'
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">{selectedAchievement.achievement_name}</h3>
                  <p className="text-sm text-gray-400">Получено {formatDate(selectedAchievement.achieved_at)}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedAchievement(null)}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-white/5 rounded-xl">
                <p className="text-sm text-gray-300 mb-3">{selectedAchievement.achievement_description}</p>
                
                <div className="flex items-start gap-2 text-xs text-gray-500 mb-2">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>Как получить:</span>
                </div>
                <p className="text-sm text-white mb-2">{selectedAchievement.details?.condition}</p>
                
                {selectedAchievement.details?.hint && (
                  <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 p-2 rounded-lg">
                    <HelpCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{selectedAchievement.details.hint}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white/5 rounded-lg text-center">
                  <p className="text-xs text-gray-400 mb-1">Награда</p>
                  <p className="text-lg font-bold text-yellow-400">+{selectedAchievement.xp_reward} XP</p>
                </div>
                <div className="p-3 bg-white/5 rounded-lg text-center">
                  <p className="text-xs text-gray-400 mb-1">Категория</p>
                  <p className="text-sm text-white">
                    {categories.find(c => c.id === selectedAchievement.details?.category)?.name || 'Другое'}
                  </p>
                </div>
              </div>

              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => setSelectedAchievement(null)}
                  className="border-white/10 hover:bg-white/10"
                >
                  Закрыть
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Профиль и уровень */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Карточка профиля */}
          <Card className="lg:col-span-1 p-6 bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 border-white/5">
            <div className="flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden mb-4">
                {operator.photo_url ? (
                  <Image
                    src={operator.photo_url}
                    alt={operator.name}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                    loading="eager"
                    priority
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-3xl font-bold">
                    {getOperatorDisplayName(operator).charAt(0)}
                  </div>
                )}
              </div>
              <h2 className="text-xl font-bold text-white">{getOperatorDisplayName(operator)}</h2>
              <p className="text-sm text-gray-400 mb-4">{operator.position || 'Оператор'}</p>
              
              {levelInfo ? (
                <>
                  <div className="w-full p-4 bg-white/5 rounded-xl mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">Уровень</span>
                      <span className="text-lg font-bold text-yellow-400">{levelInfo.calculated_level}</span>
                    </div>
                    <p className="text-center text-yellow-400 font-medium mb-2">{getLevelTitle(levelInfo.calculated_level)}</p>
                    <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-yellow-500 to-amber-500"
                        style={{ width: `${Math.min(100, ((levelInfo.total_xp - getXpForLevel(levelInfo.calculated_level)) / (levelInfo.next_level_xp - getXpForLevel(levelInfo.calculated_level))) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs mt-2">
                      <span className="text-gray-500">{levelInfo.total_xp} XP</span>
                      <span className="text-yellow-400">{levelInfo.xp_to_next_level} до {levelInfo.calculated_level + 1}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 w-full">
                    <div className="p-3 bg-white/5 rounded-lg text-center">
                      <p className="text-2xl font-bold text-white">{achievements.length}</p>
                      <p className="text-xs text-gray-400">Получено</p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-lg text-center">
                      <p className="text-2xl font-bold text-yellow-400">{levelInfo.total_xp}</p>
                      <p className="text-xs text-gray-400">Всего XP</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="w-full p-4 bg-white/5 rounded-xl mb-4">
                  <p className="text-center text-gray-400">Загрузка данных...</p>
                </div>
              )}
            </div>
          </Card>

          {/* Статистика по категориям */}
          <Card className="lg:col-span-2 p-6 bg-gray-900/40 border-white/5">
            <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-violet-400" />
              Категории достижений
            </h3>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {categories.filter(c => c.id !== 'all').map(cat => {
                const count = achievements.filter(a => a.details?.category === cat.id).length
                const progress = Math.min(100, (count / 15) * 100) // Прогресс (макс 15 ачивок в категории)
                
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`p-4 rounded-xl border transition-all ${
                      selectedCategory === cat.id
                        ? 'bg-white/10 border-white/20'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                    title={cat.desc}
                  >
                    <div className={`${cat.color} mb-2`}>
                      <cat.icon className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium text-white">{cat.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{count} получено</p>
                    <div className="w-full h-1 bg-gray-700 rounded-full mt-2">
                      <div 
                        className={`h-full rounded-full ${cat.color.replace('text', 'bg')}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>
        </div>

        {/* Фильтры */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {categories.map(cat => {
            const count = cat.id === 'all' 
              ? achievements.length 
              : achievements.filter(a => a.details?.category === cat.id).length
            
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'
                }`}
                title={cat.desc}
              >
                <cat.icon className="w-4 h-4 inline mr-2" />
                {cat.name}
                <span className="ml-2 text-xs opacity-60">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Список достижений */}
        <Card className="p-6 bg-gray-900/40 border-white/5">
          <h3 className="text-sm font-medium text-white mb-6 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-400" />
            {selectedCategory === 'all' ? 'Все достижения' : categories.find(c => c.id === selectedCategory)?.name}
          </h3>

          {filteredAchievements.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-gray-600" />
              </div>
              <p className="text-gray-400 mb-2">Нет достижений в этой категории</p>
              <p className="text-sm text-gray-600">Продолжайте работать, чтобы получить их!</p>
            </div>
          ) : (
            <div className="space-y-8">
              {sortedMonths.map(monthKey => (
                <div key={monthKey}>
                  <h4 className="text-sm font-medium text-gray-400 mb-4">{formatMonth(monthKey)}</h4>
                  <div className="space-y-3">
                    {groupedByMonth[monthKey].map(ach => {
                      const category = categories.find(c => c.id === ach.details?.category)
                      const categoryColor = getCategoryColor(ach.details?.category || 'other')
                      
                      return (
                        <button
                          key={ach.achievement_key}
                          onClick={() => setSelectedAchievement(ach)}
                          className="w-full flex items-start gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-colors text-left"
                        >
                          <div className={`p-3 rounded-xl ${category?.color.replace('text', 'bg')}/10`}>
                            {getCategoryIcon(
                              ach.details?.category || 'other', 
                              ach.achievement_key,
                              `w-6 h-6 ${category?.color || 'text-purple-400'}`
                            )}
                          </div>
                          
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-medium text-white">{ach.achievement_name}</h4>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-yellow-400">+{ach.xp_reward} XP</span>
                                <ChevronRight className="w-4 h-4 text-gray-600" />
                              </div>
                            </div>
                            <p className="text-sm text-gray-400 mb-2 line-clamp-2">{ach.achievement_description}</p>
                            <div className="flex items-center gap-2 text-xs text-gray-600">
                              <CheckCircle className="w-3 h-3 text-emerald-400" />
                              <span>Получено {new Date(ach.achieved_at).toLocaleDateString('ru-RU')}</span>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Объяснение системы */}
        <Card className="p-6 bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-500/20 rounded-xl">
              <Info className="w-6 h-6 text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-white mb-2">Как это работает?</h3>
              <ul className="text-sm text-gray-400 space-y-2 list-disc list-inside">
                <li><span className="text-yellow-400">XP</span> — опыт, который вы получаете за достижения</li>
                <li>Чем больше XP, тем выше ваш <span className="text-yellow-400">уровень</span></li>
                <li>Новые уровни открывают новые возможности</li>
                <li>Нажимайте на любое достижение, чтобы увидеть подробности</li>
                <li>Следите за прогрессом в каждой категории</li>
              </ul>
            </div>
          </div>
        </Card>

        {/* Секретные достижения */}
        <Card className="p-6 bg-gradient-to-br from-purple-900/20 to-pink-900/20 border-purple-500/20">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/20 rounded-xl">
              <Sparkles className="w-6 h-6 text-purple-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-white mb-2">Секретные достижения</h3>
              <p className="text-sm text-gray-400 mb-4">
                Некоторые достижения скрыты, пока вы их не получите. Продолжайте работать, 
                открывайте новые возможности и становитесь легендой!
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-white/5 rounded-lg">
                    <Lock className="w-4 h-4 text-gray-600" />
                    <span className="text-xs text-gray-500">???</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Кнопка назад */}
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => router.push('/operator-dashboard')}
            className="border-white/10 hover:bg-white/10"
          >
            Вернуться в дашборд
          </Button>
        </div>
      </main>
    </div>
  )
}
