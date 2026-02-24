'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Brain, Lock, Mail, Loader2, AlertCircle, Eye, EyeOff, Shield, User } from 'lucide-react'

type UserType = 'admin' | 'operator' | null

export default function UnifiedLoginPage() {
  const router = useRouter()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [userType, setUserType] = useState<UserType>(null)

  // Определяем тип пользователя по логину
  const detectUserType = (login: string): UserType => {
    // Если логин содержит @ - это админ (email)
    if (login.includes('@')) {
      return 'admin'
    }
    // Иначе - оператор
    return 'operator'
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const detectedType = detectUserType(login)
      setUserType(detectedType)

      if (detectedType === 'admin') {
        // Вход для администратора (через email)
        console.log('Admin login attempt:', login)
        
        const { error } = await supabase.auth.signInWithPassword({
          email: login,
          password: password
        })

        if (error) throw error

        // ✅ Админ идет на ГЛАВНУЮ страницу
        router.push('/')
        router.refresh()
        
      } else {
        // Вход для оператора (через username)
        console.log('Operator login attempt:', login)

        // 1. Ищем оператора по username
        const { data: authData, error: authError } = await supabase
          .from('operator_auth')
          .select(`
            id,
            operator_id,
            user_id,
            role,
            is_active,
            operators (
              id,
              name,
              short_name,
              operator_profiles (
                photo_url
              )
            )
          `)
          .eq('username', login)
          .eq('is_active', true)
          .maybeSingle()

        if (authError) throw authError
        if (!authData) throw new Error('Неверный логин или пароль')

        // 2. Входим через Supabase Auth (используем email-заглушку)
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: `${login}@operator.local`,
          password: password
        })

        if (signInError) throw new Error('Неверный логин или пароль')

        // 3. Обновляем last_login
        await supabase
          .from('operator_auth')
          .update({ last_login: new Date().toISOString() })
          .eq('id', authData.id)

        // 4. Оператор идет в личный кабинет
        router.push('/operator-dashboard')
      }

    } catch (err: any) {
      console.error('Login error:', err)
      setError(err.message || 'Неверный логин или пароль')
      setUserType(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 border-white/10 bg-gray-900/50 backdrop-blur-xl">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/25">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">F16 Finance</h1>
          <p className="text-sm text-gray-400 mt-1">Вход в систему</p>
          
          {/* Индикатор типа пользователя */}
          {userType && (
            <div className={`mt-3 px-3 py-1 rounded-full text-xs flex items-center gap-1 ${
              userType === 'admin' 
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' 
                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            }`}>
              {userType === 'admin' ? (
                <>
                  <Shield className="w-3 h-3" />
                  <span>Вход как администратор</span>
                </>
              ) : (
                <>
                  <User className="w-3 h-3" />
                  <span>Вход как оператор</span>
                </>
              )}
            </div>
          )}
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 ml-1">
              Логин или Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                type="text"
                value={login}
                onChange={(e) => {
                  setLogin(e.target.value)
                  setUserType(null) // Сбрасываем при изменении
                }}
                className="w-full bg-gray-800/50 border-white/10 pl-10 text-white"
                placeholder="admin@mail.ru или логин оператора"
                required
                autoComplete="username"
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              Админ: email • Оператор: логин
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 ml-1">Пароль</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800/50 border-white/10 pl-10 pr-10 text-white"
                placeholder="Введите пароль"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Вход...
              </>
            ) : (
              'Войти'
            )}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            Нет доступа? Обратитесь к администратору
          </p>
        </div>

        <p className="text-[10px] text-gray-600 text-center mt-6">
          F16 Finance • Панель управления клубом
        </p>
      </Card>
    </div>
  )
}