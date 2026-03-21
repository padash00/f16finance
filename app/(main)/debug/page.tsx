'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient' // Импортируем существующий клиент
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Database,
  Users,
  FileText,
  Calendar,
  DollarSign,
  Award,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  HardDrive,
  Key,
  Server,
  Clock,
  Zap,
} from 'lucide-react'

// Удаляем строку с createClientComponentClient - она не нужна
// const supabase = createClientComponentClient() <- УДАЛИТЬ!

type TestResult = {
  name: string
  status: 'success' | 'error' | 'warning' | 'pending'
  message?: string
  details?: any
  time?: number
}

type TableInfo = {
  name: string
  count: number
  hasData: boolean
  error?: string
}

type HealthSummary = {
  env: {
    supabaseUrl: boolean
    supabaseAnonKey: boolean
    telegramBotToken: boolean
    serviceRole: boolean
    adminEmails: string[]
  }
  checks?: {
    totals?: {
      tasks: number
      taskComments: number
      shifts: number
      operators: number
    }
    dataQuality?: {
      tasksWithoutOperator: number
      overdueOpenTasks: number
      activeOperatorsWithoutTelegram: number
    }
    summary?: {
      warnings?: string[]
    }
  }
}

export default function DebugPage() {
  const [tests, setTests] = useState<TestResult[]>([
    { name: 'Подключение к Supabase', status: 'pending' },
    { name: 'Переменные окружения', status: 'pending' },
    { name: 'Таблица operators', status: 'pending' },
    { name: 'Таблица operator_profiles', status: 'pending' },
    { name: 'Таблица operator_documents', status: 'pending' },
    { name: 'Таблица operator_notes', status: 'pending' },
    { name: 'Таблица operator_work_history', status: 'pending' },
    { name: 'Таблица incomes', status: 'pending' },
    { name: 'Таблица companies', status: 'pending' },
    { name: 'Таблица debts', status: 'pending' },
    { name: 'Таблица operator_salary_adjustments', status: 'pending' },
    { name: 'Storage bucket operator-files', status: 'pending' },
    { name: 'Авторизация', status: 'pending' },
  ])
  
  const [tableDetails, setTableDetails] = useState<TableInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    env: false,
    tables: false,
    auth: false,
    storage: false,
  })
  const [envVars, setEnvVars] = useState({
    url: '',
    urlExists: false,
    keyExists: false,
  })
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null)

  const runAllTests = async () => {
    setLoading(true)
    
    setTests(prev => prev.map(t => ({ ...t, status: 'pending', message: undefined, time: undefined })))
    
    const startTime = Date.now()
    const results: TestResult[] = []
    
    // Тест 1: Переменные окружения
    const envStart = Date.now()
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    setEnvVars({
      url: url || '',
      urlExists: !!url,
      keyExists: !!key,
    })
    
    results.push({
      name: 'Переменные окружения',
      status: url && key ? 'success' : 'error',
      message: url && key ? 'OK' : 'Отсутствуют переменные окружения',
      time: Date.now() - envStart,
    })
    
    // Тест 2: Подключение к Supabase
    const connStart = Date.now()
    try {
      const { data, error } = await supabase.from('operators').select('count', { count: 'exact', head: true })
      results.push({
        name: 'Подключение к Supabase',
        status: error ? 'error' : 'success',
        message: error ? error.message : 'Успешно',
        details: error,
        time: Date.now() - connStart,
      })
    } catch (err: any) {
      results.push({
        name: 'Подключение к Supabase',
        status: 'error',
        message: err.message,
        details: err,
        time: Date.now() - connStart,
      })
    }
    
    // Тест 3: Авторизация
    const authStart = Date.now()
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      results.push({
        name: 'Авторизация',
        status: error ? 'warning' : session ? 'success' : 'warning',
        message: error ? error.message : session ? `Пользователь: ${session.user.email}` : 'Не авторизован (гостевой режим)',
        time: Date.now() - authStart,
      })
    } catch (err: any) {
      results.push({
        name: 'Авторизация',
        status: 'warning',
        message: err.message,
        time: Date.now() - authStart,
      })
    }
    
    // Тесты таблиц
    const tables = [
      'operators',
      'operator_profiles',
      'operator_documents',
      'operator_notes',
      'operator_work_history',
      'incomes',
      'companies',
      'debts',
      'operator_salary_adjustments',
    ]
    
    const tableInfo: TableInfo[] = []
    
    for (const table of tables) {
      const tableStart = Date.now()
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
        
        if (error) {
          results.push({
            name: `Таблица ${table}`,
            status: error.code === '42P01' ? 'warning' : 'error',
            message: error.code === '42P01' ? 'Таблица не существует' : error.message,
            details: error,
            time: Date.now() - tableStart,
          })
          tableInfo.push({ name: table, count: 0, hasData: false, error: error.message })
        } else {
          results.push({
            name: `Таблица ${table}`,
            status: 'success',
            message: `Найдено записей: ${count}`,
            time: Date.now() - tableStart,
          })
          tableInfo.push({ name: table, count: count || 0, hasData: (count || 0) > 0 })
        }
      } catch (err: any) {
        results.push({
          name: `Таблица ${table}`,
          status: 'error',
          message: err.message,
          time: Date.now() - tableStart,
        })
        tableInfo.push({ name: table, count: 0, hasData: false, error: err.message })
      }
    }
    
    setTableDetails(tableInfo)
    
    // Тест Storage
    const storageStart = Date.now()
    try {
      const { data: buckets, error } = await supabase.storage.listBuckets()
      
      if (error) {
        results.push({
          name: 'Storage bucket operator-files',
          status: 'error',
          message: error.message,
          time: Date.now() - storageStart,
        })
      } else {
        const hasBucket = buckets?.some((b: any) => b.name === 'operator-files')
        results.push({
          name: 'Storage bucket operator-files',
          status: hasBucket ? 'success' : 'warning',
          message: hasBucket ? 'Bucket найден' : 'Bucket operator-files не найден',
          details: buckets?.map((b: any) => b.name),
          time: Date.now() - storageStart,
        })
      }
    } catch (err: any) {
      results.push({
        name: 'Storage bucket operator-files',
        status: 'error',
        message: err.message,
        time: Date.now() - storageStart,
      })
    }
    
    setTests(prev => {
      const newTests = [...prev]
      results.forEach(result => {
        const index = newTests.findIndex(t => t.name === result.name)
        if (index !== -1) {
          newTests[index] = result
        }
      })
      return newTests
    })

    try {
      const response = await fetch('/api/admin/health')
      const json = await response.json().catch(() => null)
      if (response.ok) {
        setHealthSummary(json)
      }
    } catch (error) {
      console.error('Health summary error', error)
    }
    
    setLoading(false)
  }

  useEffect(() => {
    runAllTests()
  }, [])

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />
      case 'error':
        return <XCircle className="w-5 h-5 text-rose-400" />
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-400" />
      default:
        return <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-emerald-500/10 border-emerald-500/20'
      case 'error':
        return 'bg-rose-500/10 border-rose-500/20'
      case 'warning':
        return 'bg-amber-500/10 border-amber-500/20'
      default:
        return 'bg-gray-800/30 border-white/5'
    }
  }

  const stats = {
    total: tests.length,
    success: tests.filter(t => t.status === 'success').length,
    error: tests.filter(t => t.status === 'error').length,
    warning: tests.filter(t => t.status === 'warning').length,
    pending: tests.filter(t => t.status === 'pending').length,
  }

  return (
    <>
        <div className="app-page-tight max-w-5xl space-y-6">
          {/* Header */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border border-white/10 p-6 lg:p-8">
            <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-fuchsia-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl shadow-lg shadow-violet-500/25">
                  <Database className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Диагностика системы
                  </h1>
                  <p className="text-gray-400 mt-1">
                    Проверка подключений и целостности данных
                  </p>
                </div>
              </div>

              <Button
                onClick={runAllTests}
                disabled={loading}
                className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white border-0"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Запустить проверку
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Успешно</p>
                  <p className="text-xl font-bold text-emerald-400">{stats.success}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Предупреждения</p>
                  <p className="text-xl font-bold text-amber-400">{stats.warning}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-500/20">
                  <XCircle className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Ошибки</p>
                  <p className="text-xl font-bold text-rose-400">{stats.error}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <Clock className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Всего тестов</p>
                  <p className="text-xl font-bold text-blue-400">{stats.total}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Test Results */}
          <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Server className="w-5 h-5 text-violet-400" />
              Результаты тестов
            </h2>

            <div className="space-y-2">
              {tests.map((test, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-xl border transition-all ${getStatusColor(test.status)}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      {getStatusIcon(test.status)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-white">{test.name}</span>
                          {test.time && (
                            <span className="text-xs text-gray-500">
                              {test.time}ms
                            </span>
                          )}
                        </div>
                        {test.message && (
                          <p className="text-sm text-gray-400 mt-1">{test.message}</p>
                        )}
                        {test.details && (
                          <pre className="mt-2 p-2 bg-gray-950/50 rounded-lg text-xs text-gray-500 overflow-x-auto">
                            {JSON.stringify(test.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      test.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                      test.status === 'error' ? 'bg-rose-500/20 text-rose-400' :
                      test.status === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {test.status === 'success' ? 'Успешно' :
                       test.status === 'error' ? 'Ошибка' :
                       test.status === 'warning' ? 'Предупреждение' :
                       'Проверка...'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Environment Variables */}
          <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <button
              onClick={() => toggleSection('env')}
              className="w-full flex items-center justify-between"
            >
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-400" />
                Переменные окружения
              </h2>
              {expandedSections.env ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>

            {expandedSections.env && (
              <div className="mt-4 space-y-3">
                <div className="p-3 bg-gray-800/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">NEXT_PUBLIC_SUPABASE_URL</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${envVars.urlExists ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {envVars.urlExists ? '✓ Найден' : '✗ Отсутствует'}
                    </span>
                  </div>
                  {envVars.url && (
                    <p className="mt-1 text-xs text-gray-500 font-mono truncate">{envVars.url}</p>
                  )}
                </div>

                <div className="p-3 bg-gray-800/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${envVars.keyExists ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {envVars.keyExists ? '✓ Найден' : '✗ Отсутствует'}
                    </span>
                  </div>
                  {envVars.keyExists && (
                    <p className="mt-1 text-xs text-gray-500 font-mono truncate">
                      {envVars.urlExists ? '••••••••' + envVars.url.slice(-8) : ''}
                    </p>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Tables Details */}
          <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <button
              onClick={() => toggleSection('tables')}
              className="w-full flex items-center justify-between"
            >
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-400" />
                Детали таблиц
              </h2>
              {expandedSections.tables ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>

            {expandedSections.tables && (
              <div className="mt-4 space-y-2">
                {tableDetails.map((table, index) => (
                  <div key={index} className="p-3 bg-gray-800/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">{table.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          table.error ? 'bg-rose-500/20 text-rose-400' :
                          table.hasData ? 'bg-emerald-500/20 text-emerald-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>
                          {table.error ? 'Ошибка' : table.hasData ? `${table.count} записей` : 'Пусто'}
                        </span>
                      </div>
                    </div>
                    {table.error && (
                      <p className="mt-1 text-xs text-rose-400">{table.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Quick Fixes */}
          <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              Быстрые исправления
            </h2>

            <div className="space-y-3">
              {!envVars.urlExists || !envVars.keyExists ? (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <p className="text-sm text-amber-400 font-medium mb-2">
                    Отсутствуют переменные окружения
                  </p>
                  <p className="text-xs text-gray-400 mb-3">
                    Создайте файл .env.local в корне проекта и добавьте:
                  </p>
                  <pre className="p-3 bg-gray-950/50 rounded-lg text-xs text-gray-300">
                    NEXT_PUBLIC_SUPABASE_URL=https://ваш-проект.supabase.co{'\n'}
                    NEXT_PUBLIC_SUPABASE_ANON_KEY=ваш-anon-ключ
                  </pre>
                </div>
              ) : null}

              {tableDetails.some(t => t.error?.includes('does not exist')) && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <p className="text-sm text-amber-400 font-medium mb-2">
                    Отсутствуют таблицы
                  </p>
                  <p className="text-xs text-gray-400">
                    Некоторые таблицы не найдены. Выполните SQL скрипты для создания таблиц.
                  </p>
                </div>
              )}

              {tests.find(t => t.name === 'Storage bucket operator-files')?.status === 'warning' && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <p className="text-sm text-amber-400 font-medium mb-2">
                    Не найден bucket operator-files
                  </p>
                  <p className="text-xs text-gray-400">
                    Создайте bucket в Supabase Storage с именем "operator-files" (public bucket).
                  </p>
                </div>
              )}
            </div>
          </Card>

          {healthSummary ? (
            <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-cyan-400" />
                Централизованный Health Check
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
                <div className="p-4 rounded-xl bg-gray-800/30 border border-white/5">
                  <p className="text-xs text-gray-500">Tasks</p>
                  <p className="text-2xl font-bold text-white">{healthSummary.checks?.totals?.tasks ?? 0}</p>
                </div>
                <div className="p-4 rounded-xl bg-gray-800/30 border border-white/5">
                  <p className="text-xs text-gray-500">Comments</p>
                  <p className="text-2xl font-bold text-white">{healthSummary.checks?.totals?.taskComments ?? 0}</p>
                </div>
                <div className="p-4 rounded-xl bg-gray-800/30 border border-white/5">
                  <p className="text-xs text-gray-500">Shifts</p>
                  <p className="text-2xl font-bold text-white">{healthSummary.checks?.totals?.shifts ?? 0}</p>
                </div>
                <div className="p-4 rounded-xl bg-gray-800/30 border border-white/5">
                  <p className="text-xs text-gray-500">Operators</p>
                  <p className="text-2xl font-bold text-white">{healthSummary.checks?.totals?.operators ?? 0}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-amber-300">Задачи без оператора</p>
                  <p className="text-xl font-bold text-white">{healthSummary.checks?.dataQuality?.tasksWithoutOperator ?? 0}</p>
                </div>
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <p className="text-xs text-rose-300">Просроченные открытые задачи</p>
                  <p className="text-xl font-bold text-white">{healthSummary.checks?.dataQuality?.overdueOpenTasks ?? 0}</p>
                </div>
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <p className="text-xs text-blue-300">Активные без Telegram</p>
                  <p className="text-xl font-bold text-white">{healthSummary.checks?.dataQuality?.activeOperatorsWithoutTelegram ?? 0}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={`text-xs px-2 py-1 rounded-full ${healthSummary.env.telegramBotToken ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  Telegram token: {healthSummary.env.telegramBotToken ? 'OK' : 'missing'}
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${healthSummary.env.serviceRole ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  Service role: {healthSummary.env.serviceRole ? 'OK' : 'limited'}
                </span>
                <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-gray-300">
                  Admin emails: {healthSummary.env.adminEmails.join(', ') || 'not set'}
                </span>
              </div>

              {healthSummary.checks?.summary?.warnings?.length ? (
                <div className="mt-4 space-y-2">
                  {healthSummary.checks.summary.warnings.map((warning) => (
                    <div key={warning} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      {warning}
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}

          {/* SQL для создания таблиц */}
          <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-400" />
              SQL для создания таблиц
            </h2>

            <pre className="p-4 bg-gray-950/50 rounded-lg text-xs text-gray-300 overflow-x-auto">
{`-- Таблица профилей операторов
CREATE TABLE IF NOT EXISTS public.operator_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id UUID REFERENCES public.operators(id) ON DELETE CASCADE UNIQUE,
    photo_url TEXT,
    position TEXT,
    phone TEXT,
    email TEXT,
    hire_date DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Таблица документов
CREATE TABLE IF NOT EXISTS public.operator_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id UUID REFERENCES public.operators(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    document_name TEXT NOT NULL,
    document_url TEXT NOT NULL,
    document_number TEXT,
    issue_date DATE,
    expiry_date DATE,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Таблица заметок
CREATE TABLE IF NOT EXISTS public.operator_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id UUID REFERENCES public.operators(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    note_type TEXT DEFAULT 'general',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Таблица истории работы
CREATE TABLE IF NOT EXISTS public.operator_work_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id UUID REFERENCES public.operators(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    position TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    is_current BOOLEAN DEFAULT false,
    salary DECIMAL(10,2),
    salary_type TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);`}
            </pre>
          </Card>
        </div>
    </>
  )
}
