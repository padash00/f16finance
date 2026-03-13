'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getPublicAppUrl } from '@/lib/core/app-url'
import { supabase } from '@/lib/supabaseClient'
import {
  Users,
  Key,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  Phone,
  User,
  Shield,
  Sparkles,
  Lock,
  FileText,
} from 'lucide-react'
import Image from 'next/image'

type Operator = {
  id: string
  name: string
  short_name: string | null
  username: string | null
  email: string | null
  role: string
  photo_url: string | null
  phone: string | null
  telegram_chat_id: string | null
  is_active: boolean
  last_login: string | null
  user_id: string | null
}

export default function AccessPage() {
  const publicAppUrl = typeof window !== 'undefined' ? getPublicAppUrl(window.location.origin) : getPublicAppUrl()
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState<string | null>(null)
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [newPasswords, setNewPasswords] = useState<Record<string, string>>({})

  // Загрузка операторов
  useEffect(() => {
    loadOperators()
  }, [])

  const loadOperators = async () => {
    try {
      setLoading(true)
      setError(null)

      // Получаем только АКТИВНЫХ операторов
      const { data: operatorsData, error: operatorsError } = await supabase
        .from('operators')
        .select('id, name, short_name, is_active, telegram_chat_id')
        .eq('is_active', true)  // ✅ Фильтр только активных
        .order('name')

      if (operatorsError) throw operatorsError

      // Получаем их профили
      const { data: profilesData, error: profilesError } = await supabase
        .from('operator_profiles')
        .select('operator_id, photo_url, phone, email')

      if (profilesError) throw profilesError

      // Получаем данные для входа из operator_auth
      const { data: authData, error: authError } = await supabase
        .from('operator_auth')
        .select('operator_id, user_id, username, role, is_active, last_login')

      if (authError) throw authError

      // Создаем карту профилей
      const profileMap = new Map()
      for (const p of profilesData || []) {
        profileMap.set(p.operator_id, {
          photo_url: p.photo_url,
          phone: p.phone,
          email: p.email
        })
      }

      // Создаем карту auth данных
      const authMap = new Map()
      for (const a of authData || []) {
        authMap.set(a.operator_id, {
          user_id: a.user_id,
          username: a.username,
          role: a.role,
          is_active: a.is_active,
          last_login: a.last_login
        })
      }

      // Объединяем данные
      const combined: Operator[] = (operatorsData || []).map((op: any) => {
        const profile = profileMap.get(op.id) || {}
        const auth = authMap.get(op.id) || { 
          user_id: null,
          username: null, 
          role: 'operator', 
          is_active: true,
          last_login: null 
        }
        
        return {
          id: op.id,
          name: op.name,
          short_name: op.short_name,
          username: auth.username || op.name?.toLowerCase().replace(/\s+/g, '.'),
          email: profile.email || null,
          role: auth.role || 'operator',
          photo_url: profile.photo_url || null,
          phone: profile.phone || null,
          telegram_chat_id: op.telegram_chat_id,
          is_active: true, // Уже отфильтровано
          last_login: auth.last_login,
          user_id: auth.user_id
        }
      })

      setOperators(combined)
    } catch (err: any) {
      console.error('Ошибка загрузки:', err)
      setError(err.message || 'Не удалось загрузить операторов')
    } finally {
      setLoading(false)
    }
  }

  // Генерация случайного пароля
  const generatePassword = (length: number = 8): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    let password = ''
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return password
  }

  // Сброс пароля через API
  const resetPassword = async (operatorId: string) => {
    try {
      setResetting(operatorId)
      setError(null)

      const operator = operators.find(op => op.id === operatorId)
      if (!operator) throw new Error('Оператор не найден')
      
      if (!operator.user_id) {
        throw new Error('У оператора нет привязки к auth.users')
      }

      const newPassword = generatePassword(8)
      
      // Вызываем наш API route
      const response = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: operator.user_id,
          password: newPassword
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка при смене пароля')
      }
      
      // Сохраняем пароль для отображения
      setNewPasswords(prev => ({ ...prev, [operatorId]: newPassword }))
      setShowPasswords(prev => ({ ...prev, [operatorId]: true }))
      
      setSuccess(`✅ Пароль для ${operator.short_name || operator.name} успешно изменен`)
      setTimeout(() => setSuccess(null), 5000)
    } catch (err: any) {
      console.error('Ошибка сброса:', err)
      setError(err.message || 'Не удалось сбросить пароль')
    } finally {
      setResetting(null)
    }
  }

  // Генерация паролей для всех операторов
  const resetAllPasswords = async () => {
    if (!confirm('Сгенерировать новые пароли для ВСЕХ активных операторов? Старые пароли перестанут работать!')) {
      return
    }

    try {
      setResetting('all')
      setError(null)
      setSuccess(null)

      const results: Record<string, string> = {}
      let successCount = 0
      let failCount = 0

      for (const op of operators) {
        if (!op.user_id) {
          console.log(`Оператор ${op.name} без auth.user_id`)
          failCount++
          continue
        }

        try {
          const newPassword = generatePassword(8)
          
          const response = await fetch('/api/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: op.user_id,
              password: newPassword
            })
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Ошибка')
          }
          
          results[op.id] = newPassword
          successCount++
          
          // Небольшая задержка между запросами
          await new Promise(resolve => setTimeout(resolve, 300))
        } catch (err) {
          console.error(`Ошибка для ${op.name}:`, err)
          failCount++
        }
      }

      setNewPasswords(results)
      
      // Показываем все новые пароли
      const showAll: Record<string, boolean> = {}
      Object.keys(results).forEach(id => { showAll[id] = true })
      setShowPasswords(showAll)
      
      setSuccess(`✅ Сгенерировано паролей: ${successCount}, ошибок: ${failCount}`)
      setTimeout(() => setSuccess(null), 5000)
    } catch (err: any) {
      console.error('Ошибка генерации:', err)
      setError(err.message || 'Не удалось сгенерировать пароли')
    } finally {
      setResetting(null)
    }
  }

  // Копирование данных оператора
  const copyOperatorData = (op: Operator) => {
    const password = newPasswords[op.id] || '••••••••'
    
    const text = `👤 Оператор: ${op.short_name || op.name}
🔑 Логин: ${op.username}
🔐 Пароль: ${password}
📞 Телефон: ${op.phone || 'не указан'}
📧 Email: ${op.email || 'не указан'}
💬 Telegram ID: ${op.telegram_chat_id || 'не указан'}
🌐 Ссылка для входа: ${publicAppUrl}/login`

    navigator.clipboard.writeText(text)
    setCopiedId(op.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Копирование всех данных
  const copyAllData = () => {
    let text = '🔐 ДАННЫЕ ДЛЯ ВХОДА ОПЕРАТОРОВ\n'
    text += '='.repeat(60) + '\n'
    text += `🌐 Ссылка для входа: ${publicAppUrl}/login\n`
    text += '='.repeat(60) + '\n\n'

    operators.forEach(op => {
      const password = newPasswords[op.id] || '••••••••'
      
      text += `👤 ${op.short_name || op.name}\n`
      text += `   🔑 Логин: ${op.username}\n`
      text += `   🔐 Пароль: ${password}\n`
      text += `   📞 Телефон: ${op.phone || 'не указан'}\n`
      text += `   💬 Telegram: ${op.telegram_chat_id || 'не указан'}\n`
      text += '-'.repeat(40) + '\n'
    })

    navigator.clipboard.writeText(text)
    setSuccess('Все данные скопированы')
    setTimeout(() => setSuccess(null), 3000)
  }

  // Экспорт в CSV
  const exportToCSV = () => {
    const headers = ['Имя', 'Логин', 'Пароль', 'Телефон', 'Email', 'Telegram ID', 'Ссылка для входа']
    
    const rows = operators.map(op => [
      op.short_name || op.name,
      op.username || '',
      newPasswords[op.id] || '••••••••',
      op.phone || '',
      op.email || '',
      op.telegram_chat_id || '',
      `${publicAppUrl}/login`
    ])

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.join(';'))
    ].join('\n')

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    
    link.setAttribute('href', url)
    link.setAttribute('download', `operators_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.display = 'none'
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    
    setSuccess('CSV файл скачан')
    setTimeout(() => setSuccess(null), 3000)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-violet-500/30 border-t-violet-500 mx-auto mb-6" />
              <Key className="w-8 h-8 text-violet-400 absolute top-4 left-1/2 -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Загрузка данных операторов...</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <Sidebar />
      
      <main className="app-main">
        <div className="app-page max-w-7xl space-y-6">
          
          {/* Уведомления */}
          {error && (
            <div className="fixed top-5 right-5 z-50 bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-2xl backdrop-blur-xl flex items-center gap-3">
              <AlertTriangle className="w-5 h-5" />
              {error}
            </div>
          )}

          {success && (
            <div className="fixed top-5 right-5 z-50 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-3 rounded-2xl backdrop-blur-xl flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5" />
              {success}
            </div>
          )}

          {/* Хедер */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600/20 via-teal-600/20 to-cyan-600/20 border border-white/10 p-6 lg:p-8">
            <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-2xl shadow-lg shadow-emerald-500/25">
                  <Key className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Управление доступом
                  </h1>
                  <p className="text-gray-400 mt-1">Активные операторы ({operators.length})</p>
                </div>
              </div>

              {/* Панель действий */}
              <div className="flex flex-wrap gap-3 mt-6">
                <Button
                  onClick={resetAllPasswords}
                  disabled={resetting === 'all'}
                  className="bg-gradient-to-r from-emerald-500 to-green-500 text-white border-0 shadow-lg shadow-emerald-500/25"
                >
                  {resetting === 'all' ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Сгенерировать всем пароли
                </Button>

                <Button
                  onClick={copyAllData}
                  variant="outline"
                  className="border-white/10 bg-white/5 hover:bg-white/10"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Копировать все данные
                </Button>

                <Button
                  onClick={exportToCSV}
                  variant="outline"
                  className="border-white/10 bg-white/5 hover:bg-white/10"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Скачать CSV
                </Button>

                <Button
                  onClick={loadOperators}
                  variant="outline"
                  className="border-white/10 bg-white/5 hover:bg-white/10 ml-auto"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Обновить
                </Button>
              </div>
            </div>
          </div>

          {/* Статистика */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-violet-500/20 rounded-lg">
                  <Users className="w-4 h-4 text-violet-400" />
                </div>
                <p className="text-xs text-gray-500 uppercase">Всего активных</p>
              </div>
              <p className="text-2xl font-bold text-white">{operators.length}</p>
            </Card>

            <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-amber-500/20 rounded-lg">
                  <Shield className="w-4 h-4 text-amber-400" />
                </div>
                <p className="text-xs text-gray-500 uppercase">С Telegram</p>
              </div>
              <p className="text-2xl font-bold text-amber-400">
                {operators.filter(o => o.telegram_chat_id).length}
              </p>
            </Card>

            <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <Key className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-xs text-gray-500 uppercase">Сгенерировано</p>
              </div>
              <p className="text-2xl font-bold text-emerald-400">
                {Object.keys(newPasswords).length}
              </p>
            </Card>
          </div>

          {/* Таблица операторов */}
          <Card className="overflow-hidden bg-gray-900/40 backdrop-blur-xl border-white/5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 bg-white/5">
                    <th className="py-4 px-4 text-left font-medium text-gray-400">Оператор</th>
                    <th className="py-4 px-4 text-left font-medium text-gray-400">Логин</th>
                    <th className="py-4 px-4 text-left font-medium text-gray-400">Новый пароль</th>
                    <th className="py-4 px-4 text-left font-medium text-gray-400">Телефон</th>
                    <th className="py-4 px-4 text-left font-medium text-gray-400">Telegram</th>
                    <th className="py-4 px-4 text-center font-medium text-gray-400">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {operators.map((op) => {
                    const newPassword = newPasswords[op.id]
                    
                    return (
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
                                  className="object-cover w-full h-full"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                                  {op.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div>
                              <span className="font-medium text-white block">
                                {op.short_name || op.name}
                              </span>
                              <span className="text-xs text-gray-500">{op.role}</span>
                            </div>
                          </div>
                        </td>

                        <td className="py-4 px-4 font-mono text-sm text-gray-300">
                          {op.username}
                        </td>

                        <td className="py-4 px-4">
                          {newPassword ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20">
                                {showPasswords[op.id] ? newPassword : '••••••••'}
                              </span>
                              <button
                                onClick={() => setShowPasswords(prev => ({ 
                                  ...prev, 
                                  [op.id]: !prev[op.id] 
                                }))}
                                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                              >
                                {showPasswords[op.id] ? (
                                  <EyeOff className="w-4 h-4 text-gray-400" />
                                ) : (
                                  <Eye className="w-4 h-4 text-gray-400" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                              onClick={() => resetPassword(op.id)}
                              disabled={resetting === op.id}
                            >
                              {resetting === op.id ? (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              ) : (
                                <Key className="w-3 h-3 mr-1" />
                              )}
                              Сменить пароль
                            </Button>
                          )}
                        </td>

                        <td className="py-4 px-4 text-gray-400">
                          {op.phone || '—'}
                        </td>

                        <td className="py-4 px-4">
                          {op.telegram_chat_id ? (
                            <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full border border-emerald-500/20">
                              {op.telegram_chat_id}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-600">—</span>
                          )}
                        </td>

                        <td className="py-4 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 border-white/10 hover:bg-white/10"
                              onClick={() => copyOperatorData(op)}
                              disabled={!newPassword}
                            >
                              {copiedId === op.id ? (
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {operators.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-500">
                        Нет активных операторов в системе
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Инструкция */}
          <Card className="p-6 bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-blue-500/20 rounded-xl">
                <FileText className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white mb-2">Как пользоваться:</h3>
                <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside">
                  <li>Показываются только активные операторы</li>
                  <li>Нажмите "Сгенерировать всем пароли" для массовой смены паролей</li>
                  <li>Или меняйте пароли индивидуально кнопкой "Сменить пароль"</li>
                  <li>Новые пароли сразу сохраняются в системе и будут работать при входе</li>
                  <li>После генерации скопируйте данные и передайте операторам</li>
                  <li>Пароль отображается только один раз - сохраните его!</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
