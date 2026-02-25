'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
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
  Users,
  BarChart3,
  Filter,
  Search,
  Eye, // 👈 ВАЖНО: добавить этот импорт!
} from 'lucide-react'

type Achievement = {
  achievement_key: string
  achievement_name: string
  achievement_description: string
  achieved_at: string
  xp_reward: number
}

type OperatorWithAchievements = {
  id: string
  name: string
  short_name: string | null
  photo_url: string | null
  position: string | null
  achievements: Achievement[]
  total_xp: number
  level: number
  achievements_count: number
  last_achievement: string | null
}

type LevelInfo = {
  current_level: number
  total_xp: number
}

export default function OperatorAchievementsAllPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [operators, setOperators] = useState<OperatorWithAchievements[]>([])
  const [filteredOperators, setFilteredOperators] = useState<OperatorWithAchievements[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'xp' | 'achievements' | 'name'>('xp')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [selectedOperator, setSelectedOperator] = useState<OperatorWithAchievements | null>(null)
  const [stats, setStats] = useState({
    totalOperators: 0,
    totalAchievements: 0,
    totalXP: 0,
    averageXP: 0,
    topOperator: '',
  })

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        
        console.log('📊 Начинаем загрузку данных для страницы всех достижений')
        console.log('1️⃣ Проверяем авторизацию...')
        
        // Проверяем авторизацию
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        
        if (userError) {
          console.error('❌ Ошибка авторизации:', userError)
          throw userError
        }
        
        if (!user) {
          console.log('👤 Пользователь не авторизован, редирект на /login')
          router.push('/login')
          return
        }
        
        console.log('✅ Пользователь авторизован:', user.email)
        
        // Получаем всех активных операторов
        console.log('2️⃣ Загружаем список активных операторов из таблицы operators...')
        const { data: operatorsData, error: operatorsError } = await supabase
          .from('operators')
          .select(`
            id,
            name,
            short_name,
            is_active,
            operator_profiles (
              photo_url,
              position
            )
          `)
          .eq('is_active', true)
          .order('name')

        if (operatorsError) {
          console.error('❌ Ошибка загрузки операторов:', operatorsError)
          throw operatorsError
        }

        console.log(`✅ Загружено ${operatorsData?.length || 0} активных операторов`)
        console.log('📋 Список операторов:', operatorsData?.map(op => ({ 
          id: op.id, 
          name: op.name,
          has_profile: !!op.operator_profiles 
        })))

        const operatorsWithAchievements: OperatorWithAchievements[] = []

        // Для каждого оператора загружаем достижения и уровень
        console.log('3️⃣ Начинаем загрузку достижений для каждого оператора...')
        
        for (let i = 0; i < (operatorsData?.length || 0); i++) {
          const op = operatorsData[i]
          const profile = op.operator_profiles || {}
          
          console.log(`   🔄 Оператор ${i+1}/${operatorsData?.length}: ${op.name} (ID: ${op.id})`)
          
          // Получаем уровень и XP
          console.log(`      ⏳ Загружаем уровень и XP...`)
          const { data: levelData, error: levelError } = await supabase
            .rpc('get_operator_level_info', { operator_uuid: op.id })

          if (levelError) {
            console.error(`      ❌ Ошибка загрузки уровня для ${op.name}:`, levelError)
          } else {
            console.log(`      ✅ Уровень загружен:`, levelData)
          }

          // Получаем все ачивки
          console.log(`      ⏳ Загружаем достижения...`)
          const { data: achievementsData, error: achievementsError } = await supabase
            .rpc('get_operator_achievements', { operator_uuid: op.id })

          if (achievementsError) {
            console.error(`      ❌ Ошибка загрузки достижений для ${op.name}:`, achievementsError)
          } else {
            console.log(`      ✅ Загружено ${achievementsData?.length || 0} достижений`)
          }

          const achievements = achievementsData || []
          const levelInfo = levelData && levelData.length > 0 ? levelData[0] : { calculated_level: 1, total_xp: 0 }
          
          // Находим последнее достижение
          let lastAchievement = null
          if (achievements.length > 0) {
            const sorted = [...achievements].sort((a, b) => 
              new Date(b.achieved_at).getTime() - new Date(a.achieved_at).getTime()
            )
            lastAchievement = sorted[0].achievement_name
            console.log(`      🏆 Последнее достижение: ${lastAchievement}`)
          }

          operatorsWithAchievements.push({
            id: op.id,
            name: op.name,
            short_name: op.short_name,
            photo_url: profile.photo_url || null,
            position: profile.position || null,
            achievements,
            total_xp: levelInfo.total_xp || 0,
            level: levelInfo.calculated_level || 1,
            achievements_count: achievements.length,
            last_achievement: lastAchievement,
          })
        }

        console.log('✅ Завершена загрузка всех операторов')
        console.log('📊 Итоговые данные:', operatorsWithAchievements.map(op => ({
          name: op.name,
          level: op.level,
          xp: op.total_xp,
          achievements: op.achievements_count
        })))

        // Сортируем по умолчанию (по XP)
        const sorted = [...operatorsWithAchievements].sort((a, b) => b.total_xp - a.total_xp)
        
        setOperators(sorted)
        setFilteredOperators(sorted)

        // Рассчитываем статистику
        const totalXP = sorted.reduce((sum, op) => sum + op.total_xp, 0)
        const newStats = {
          totalOperators: sorted.length,
          totalAchievements: sorted.reduce((sum, op) => sum + op.achievements_count, 0),
          totalXP: totalXP,
          averageXP: sorted.length > 0 ? Math.round(totalXP / sorted.length) : 0,
          topOperator: sorted.length > 0 ? (sorted[0].short_name || sorted[0].name) : '',
        }
        
        console.log('📈 Статистика:', newStats)
        setStats(newStats)

      } catch (err: any) {
        console.error('❌ Критическая ошибка в loadData:', err)
        console.error('   Сообщение:', err.message)
        console.error('   Стек:', err.stack)
        setError(err.message)
      } finally {
        console.log('🏁 Загрузка данных завершена')
        setLoading(false)
      }
    }

    loadData()
  }, [router])

  const handleLogout = async () => {
    console.log('🚪 Выход из системы...')
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Поиск и сортировка
  useEffect(() => {
    console.log(`🔍 Поиск: "${searchQuery}", Сортировка: ${sortBy} (${sortDirection})`)
    
    let filtered = [...operators]

    // Поиск по имени
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(op => 
        op.name.toLowerCase().includes(query) ||
        (op.short_name && op.short_name.toLowerCase().includes(query))
      )
      console.log(`   Найдено ${filtered.length} операторов по запросу "${searchQuery}"`)
    }

    // Сортировка
    filtered.sort((a, b) => {
      let comparison = 0
      if (sortBy === 'xp') {
        comparison = a.total_xp - b.total_xp
      } else if (sortBy === 'achievements') {
        comparison = a.achievements_count - b.achievements_count
      } else if (sortBy === 'name') {
        comparison = (a.short_name || a.name).localeCompare(b.short_name || b.name)
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })

    setFilteredOperators(filtered)
  }, [operators, searchQuery, sortBy, sortDirection])

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

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const handleViewAchievements = (op: OperatorWithAchievements) => {
    console.log(`👁️ Просмотр достижений оператора: ${op.name} (ID: ${op.id})`)
    console.log(`   Уровень: ${op.level}, XP: ${op.total_xp}, Достижений: ${op.achievements_count}`)
    setSelectedOperator(op)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-violet-500/30 border-t-violet-500 mx-auto mb-6" />
            <Trophy className="w-8 h-8 text-yellow-400 absolute top-4 left-1/2 -translate-x-1/2" />
          </div>
          <p className="text-gray-400">Загрузка достижений операторов...</p>
        </div>
      </div>
    )
  }

  if (error) {
    console.error('❌ Рендер страницы с ошибкой:', error)
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
        <Card className="p-8 max-w-md border-red-500/20 bg-red-500/5">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Ошибка</h2>
            <p className="text-gray-400">{error}</p>
            <Button onClick={() => router.push('/')} variant="outline" className="border-white/10">
              Вернуться на главную
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  console.log(`🖥️ Рендер страницы: ${filteredOperators.length} операторов отображается`)
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      {/* Шапка */}
      <header className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <Home className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-white">Все достижения</h1>
              <p className="text-xs text-gray-400">Статистика и прогресс операторов</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-white"
              onClick={() => router.push('/settings')}
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

      {/* Модальное окно с деталями оператора */}
      {selectedOperator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <Card className="max-w-2xl w-full bg-gray-900 border-white/10 p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden">
                  {selectedOperator.photo_url ? (
                    <Image
                      src={selectedOperator.photo_url}
                      alt={selectedOperator.name}
                      width={48}
                      height={48}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-lg font-bold">
                      {selectedOperator.name.charAt(0)}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">{selectedOperator.short_name || selectedOperator.name}</h3>
                  <p className="text-sm text-gray-400">{selectedOperator.position || 'Оператор'}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  console.log(`❌ Закрытие модального окна для ${selectedOperator.name}`)
                  setSelectedOperator(null)
                }}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 bg-white/5 rounded-lg text-center">
                <p className="text-xs text-gray-400 mb-1">Уровень</p>
                <p className="text-xl font-bold text-yellow-400">{selectedOperator.level}</p>
                <p className="text-xs text-gray-500">{getLevelTitle(selectedOperator.level)}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-lg text-center">
                <p className="text-xs text-gray-400 mb-1">Всего XP</p>
                <p className="text-xl font-bold text-yellow-400">{selectedOperator.total_xp}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-lg text-center">
                <p className="text-xs text-gray-400 mb-1">Достижений</p>
                <p className="text-xl font-bold text-emerald-400">{selectedOperator.achievements_count}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-lg text-center">
                <p className="text-xs text-gray-400 mb-1">Последнее</p>
                <p className="text-sm text-white truncate" title={selectedOperator.last_achievement || ''}>
                  {selectedOperator.last_achievement || 'Нет'}
                </p>
              </div>
            </div>

            <h4 className="text-sm font-medium text-white mb-3">Полученные достижения</h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {selectedOperator.achievements.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">Нет достижений</p>
              ) : (
                selectedOperator.achievements.map((ach) => (
                  <div key={ach.achievement_key} className="p-3 bg-white/5 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-white">{ach.achievement_name}</span>
                      <span className="text-xs text-yellow-400">+{ach.xp_reward} XP</span>
                    </div>
                    <p className="text-xs text-gray-400">{ach.achievement_description}</p>
                    <p className="text-[10px] text-gray-600 mt-1">{formatDate(ach.achieved_at)}</p>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  console.log(`❌ Закрытие модального окна для ${selectedOperator.name}`)
                  setSelectedOperator(null)
                }}
                className="border-white/10 hover:bg-white/10"
              >
                Закрыть
              </Button>
            </div>
          </Card>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Статистика */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card className="p-5 bg-gradient-to-br from-purple-600/20 to-indigo-600/20 border-purple-500/20">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Users className="w-4 h-4 text-purple-400" />
              </div>
              <p className="text-xs text-gray-400 uppercase">Операторов</p>
            </div>
            <p className="text-2xl font-bold text-white">{stats.totalOperators}</p>
          </Card>

          <Card className="p-5 bg-gradient-to-br from-amber-600/20 to-yellow-600/20 border-amber-500/20">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <Trophy className="w-4 h-4 text-amber-400" />
              </div>
              <p className="text-xs text-gray-400 uppercase">Достижений</p>
            </div>
            <p className="text-2xl font-bold text-white">{stats.totalAchievements}</p>
          </Card>

          <Card className="p-5 bg-gradient-to-br from-emerald-600/20 to-teal-600/20 border-emerald-500/20">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-500/20 rounded-lg">
                <Star className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-xs text-gray-400 uppercase">Всего XP</p>
            </div>
            <p className="text-2xl font-bold text-white">{stats.totalXP}</p>
          </Card>

          <Card className="p-5 bg-gradient-to-br from-blue-600/20 to-cyan-600/20 border-blue-500/20">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <BarChart3 className="w-4 h-4 text-blue-400" />
              </div>
              <p className="text-xs text-gray-400 uppercase">Средний XP</p>
            </div>
            <p className="text-2xl font-bold text-white">{stats.averageXP}</p>
          </Card>

          <Card className="p-5 bg-gradient-to-br from-rose-600/20 to-pink-600/20 border-rose-500/20">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-rose-500/20 rounded-lg">
                <Crown className="w-4 h-4 text-rose-400" />
              </div>
              <p className="text-xs text-gray-400 uppercase">Лидер</p>
            </div>
            <p className="text-xl font-bold text-white truncate">{stats.topOperator}</p>
          </Card>
        </div>

        {/* Поиск и фильтры */}
        <Card className="p-4 bg-gray-900/40 border-white/5">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск оператора..."
                  className="w-full bg-gray-800 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchQuery('')}
                className="border-white/10 hover:bg-white/10"
              >
                Сброс
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Сортировать:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="xp">По XP</option>
                <option value="achievements">По достижениям</option>
                <option value="name">По имени</option>
              </select>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="h-9 w-9"
              >
                {sortDirection === 'asc' ? '↑' : '↓'}
              </Button>
            </div>
          </div>
        </Card>

        {/* Таблица операторов */}
        <Card className="overflow-hidden bg-gray-900/40 border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/5">
                  <th className="py-4 px-4 text-left font-medium text-gray-400">Оператор</th>
                  <th className="py-4 px-4 text-center font-medium text-gray-400">Уровень</th>
                  <th className="py-4 px-4 text-center font-medium text-gray-400">XP</th>
                  <th className="py-4 px-4 text-center font-medium text-gray-400">Достижений</th>
                  <th className="py-4 px-4 text-left font-medium text-gray-400">Последнее достижение</th>
                  <th className="py-4 px-4 text-center font-medium text-gray-400">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredOperators.map((op) => (
                  <tr key={op.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-gradient-to-br from-violet-500 to-fuchsia-500 flex-shrink-0">
                          {op.photo_url ? (
                            <Image
                              src={op.photo_url}
                              alt={op.name}
                              width={32}
                              height={32}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                              {op.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div>
                          <span className="font-medium text-white block">
                            {op.short_name || op.name}
                          </span>
                          <span className="text-xs text-gray-500">{op.position || 'Оператор'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <div className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/10 rounded-full border border-yellow-500/20">
                        <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        <span className="text-sm font-medium text-yellow-400">{op.level}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center font-mono text-white">{op.total_xp}</td>
                    <td className="py-4 px-4 text-center">
                      <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs">
                        {op.achievements_count}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-gray-400 max-w-[200px] truncate">
                      {op.last_achievement || '—'}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleViewAchievements(op)}
                        className="border-white/10 hover:bg-white/10"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Достижения
                      </Button>
                    </td>
                  </tr>
                ))}

                {filteredOperators.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-500">
                      Нет операторов
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Инфо-блок */}
        <Card className="p-6 bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-500/20 rounded-xl">
              <Info className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white mb-2">О системе достижений</h3>
              <p className="text-sm text-gray-400">
                Операторы получают XP за различные достижения: стаж работы, количество смен, 
                отсутствие штрафов, получение премий и многое другое. Чем больше XP, тем выше уровень.
              </p>
            </div>
          </div>
        </Card>
      </main>
    </div>
  )
}
