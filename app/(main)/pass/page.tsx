'use client'

import { useEffect, useState } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getPublicAppUrl } from '@/lib/core/app-url'
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
  Pencil,
  User,
  Shield,
  Sparkles,
  FileText,
  X,
  Send,
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
  const [editingLoginId, setEditingLoginId] = useState<string | null>(null)
  const [editingLoginValue, setEditingLoginValue] = useState('')
  const [savingLoginId, setSavingLoginId] = useState<string | null>(null)
  const [sendingTgId, setSendingTgId] = useState<string | null>(null)
  const [sentTgIds, setSentTgIds] = useState<Record<string, boolean>>({})

  // Загрузка операторов
  useEffect(() => {
    loadOperators()
  }, [])

  const loadOperators = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/admin/operators?active_only=true', { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      const combined: Operator[] = (Array.isArray(json?.data) ? json.data : []).map((op: any) => {
        const profile = Array.isArray(op.operator_profiles) ? op.operator_profiles[0] || {} : op.operator_profiles || {}
        const auth = op.auth || {
          user_id: null,
          username: null,
          role: 'operator',
          is_active: true,
          last_login: null,
        }

        return {
          id: op.id,
          name: op.name,
          short_name: op.short_name,
          // Только реальный логин из operator_auth; без аккаунта — null (не подставляем имя)
          username: auth.username ?? null,
          email: profile.email || null,
          role: auth.role || 'operator',
          photo_url: profile.photo_url || null,
          phone: profile.phone || null,
          telegram_chat_id: op.telegram_chat_id,
          is_active: Boolean(op.is_active),
          last_login: auth.last_login,
          user_id: auth.user_id,
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
      
      setSuccess(`Пароль для ${operator.short_name || operator.name} успешно изменен`)
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
      
      setSuccess(`Сгенерировано паролей: ${successCount}, ошибок: ${failCount}`)
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
🔑 Логин: ${op.username ?? 'нет (аккаунт входа не создан)'}
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
      text += `   🔑 Логин: ${op.username ?? 'нет (аккаунт входа не создан)'}\n`
      text += `   🔐 Пароль: ${password}\n`
      text += `   📞 Телефон: ${op.phone || 'не указан'}\n`
      text += `   💬 Telegram: ${op.telegram_chat_id || 'не указан'}\n`
      text += '-'.repeat(40) + '\n'
    })

    navigator.clipboard.writeText(text)
    setSuccess('Все данные скопированы')
    setTimeout(() => setSuccess(null), 3000)
  }

  // Экспорт в Excel
  const exportToCSV = async () => {
    const wb = createWorkbook()
    const today = new Date().toLocaleDateString('ru-RU')
    buildStyledSheet(wb, 'Операторы', 'Данные для входа операторов', `Экспорт: ${today} | Операторов: ${operators.length}`, [
      { header: 'Имя', key: 'name', width: 24, type: 'text' },
      { header: 'Логин', key: 'username', width: 20, type: 'text' },
      { header: 'Пароль', key: 'password', width: 16, type: 'text' },
      { header: 'Телефон', key: 'phone', width: 16, type: 'text' },
      { header: 'Email', key: 'email', width: 24, type: 'text' },
      { header: 'Telegram ID', key: 'telegram', width: 16, type: 'text' },
      { header: 'Ссылка для входа', key: 'link', width: 30, type: 'text' },
    ], operators.map(op => ({
      name: op.short_name || op.name,
      username: op.username ?? '',
      password: newPasswords[op.id] || '••••••••',
      phone: op.phone || '',
      email: op.email || '',
      telegram: op.telegram_chat_id || '',
      link: `${publicAppUrl}/login`,
    })))
    await downloadWorkbook(wb, `operators_${new Date().toISOString().split('T')[0]}.xlsx`)
    setSuccess('Excel файл скачан')
    setTimeout(() => setSuccess(null), 3000)
  }

  const sendToTelegram = async (op: Operator, password: string) => {
    if (!op.telegram_chat_id) {
      setError(`У ${op.short_name || op.name} не указан Telegram ID`)
      setTimeout(() => setError(null), 4000)
      return
    }
    setSendingTgId(op.id)
    try {
      const res = await fetch('/api/admin/send-operator-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: op.id,
          chatId: op.telegram_chat_id,
          username: op.username,
          password,
          name: op.short_name || op.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setSentTgIds(prev => ({ ...prev, [op.id]: true }))
      setSuccess(`Данные отправлены ${op.short_name || op.name} в Telegram`)
      setTimeout(() => setSuccess(null), 4000)
    } catch (err: any) {
      setError(err.message || 'Не удалось отправить')
      setTimeout(() => setError(null), 4000)
    } finally {
      setSendingTgId(null)
    }
  }

  const sendAllToTelegram = async () => {
    const withPassAndTg = operators.filter(op => newPasswords[op.id] && op.telegram_chat_id)
    if (withPassAndTg.length === 0) {
      setError('Сначала сгенерируйте пароли. У операторов без Telegram ID отправка недоступна.')
      setTimeout(() => setError(null), 5000)
      return
    }
    if (!confirm(`Отправить данные для входа ${withPassAndTg.length} операторам в Telegram?`)) return

    setSendingTgId('all')
    let ok = 0, fail = 0
    for (const op of withPassAndTg) {
      const res = await fetch('/api/admin/send-operator-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: op.id,
          chatId: op.telegram_chat_id,
          username: op.username,
          password: newPasswords[op.id],
          name: op.short_name || op.name,
        }),
      })
      if (res.ok) { ok++; setSentTgIds(prev => ({ ...prev, [op.id]: true })) }
      else fail++
      await new Promise(r => setTimeout(r, 300))
    }
    setSendingTgId(null)
    setSuccess(`Отправлено: ${ok}, ошибок: ${fail}`)
    setTimeout(() => setSuccess(null), 5000)
  }

  const saveLogin = async (operatorId: string) => {
    const op = operators.find(o => o.id === operatorId)
    if (!op?.user_id) {
      setError('У оператора нет аккаунта входа — сначала создайте аккаунт (супер-админ).')
      setTimeout(() => setError(null), 5000)
      return
    }
    const newUsername = editingLoginValue.trim().toLowerCase()
    if (!newUsername) return
    setSavingLoginId(operatorId)
    try {
      const res = await fetch('/api/admin/update-operator-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorId, username: newUsername }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setOperators(prev => prev.map(o => o.id === operatorId ? { ...o, username: data.username } : o))
        setEditingLoginId(null)
        setSuccess('Логин успешно изменён')
        setTimeout(() => setSuccess(null), 3000)
      } else {
        setError(typeof data.error === 'string' ? data.error : 'Ошибка')
        setTimeout(() => setError(null), 5000)
      }
    } catch {
      setError('Ошибка сети')
      setTimeout(() => setError(null), 4000)
    }
    setSavingLoginId(null)
  }

  if (loading) {
    return (
      <>
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-violet-500/30 border-t-violet-500 mx-auto mb-6" />
              <Key className="w-8 h-8 text-violet-400 absolute top-4 left-1/2 -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Загрузка данных операторов...</p>
          </div>
      </>
    )
  }

  return (
    <>
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
                  Скачать Excel
                </Button>

                <Button
                  onClick={sendAllToTelegram}
                  disabled={sendingTgId === 'all'}
                  className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0 shadow-lg shadow-blue-500/25"
                >
                  {sendingTgId === 'all' ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Отправить всем в Telegram
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

                        <td className="py-4 px-4">
                          {!op.user_id ? (
                            <div className="text-sm">
                              <span className="text-amber-400/90">Нет аккаунта входа</span>
                              <p className="text-xs text-gray-500 mt-0.5 max-w-[14rem]">
                                Создайте аккаунт оператора (супер-админ), затем можно задать логин.
                              </p>
                            </div>
                          ) : editingLoginId === op.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                autoFocus
                                value={editingLoginValue}
                                onChange={e => setEditingLoginValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveLogin(op.id); if (e.key === 'Escape') setEditingLoginId(null) }}
                                className="font-mono text-sm bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-white w-36 focus:outline-none focus:border-blue-500"
                              />
                              <button
                                onClick={() => saveLogin(op.id)}
                                disabled={savingLoginId === op.id}
                                className="px-2 py-1 text-xs bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 rounded-lg text-blue-300 transition-colors disabled:opacity-50"
                              >
                                {savingLoginId === op.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Сохранить'}
                              </button>
                              <button onClick={() => setEditingLoginId(null)} className="text-gray-600 hover:text-gray-400">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setEditingLoginId(op.id); setEditingLoginValue(op.username || '') }}
                              className="flex items-center gap-1.5 font-mono text-sm text-gray-300 hover:text-white group text-left"
                            >
                              <span>{op.username || '—'}</span>
                              <Pencil className="w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" />
                            </button>
                          )}
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
                              <button
                                onClick={() => sendToTelegram(op, newPassword)}
                                disabled={sendingTgId === op.id || !op.telegram_chat_id}
                                title={op.telegram_chat_id ? 'Отправить в Telegram' : 'Telegram ID не указан'}
                                className="p-1 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40"
                              >
                                {sendingTgId === op.id ? (
                                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                                ) : sentTgIds[op.id] ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <Send className="w-4 h-4 text-blue-400" />
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
    </>
  )
}
