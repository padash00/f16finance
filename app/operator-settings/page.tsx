// app/operator-settings/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { toOperatorAuthEmail } from '@/lib/core/auth'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import {
  User,
  Settings,
  LogOut,
  Home,
  Loader2,
  AlertTriangle,
  CheckCircle,
  X,
  Phone,
  Mail,
  Briefcase,
  Calendar,
  MapPin,
  Key,
  Bell,
  BellRing,
  Camera,
  Save,
  Lock,
  Eye,
  EyeOff,
  MessageCircle,
  DollarSign,
  AtSign,
} from 'lucide-react'

type OperatorProfile = {
  id: string
  name: string
  full_name: string | null
  short_name: string | null
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  birth_date: string | null
  city: string | null
  about: string | null
  username?: string | null
}

type NotificationSettings = {
  telegram: boolean
  chat: boolean
  salary: boolean
}

export default function OperatorSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [operator, setOperator] = useState<OperatorProfile | null>(null)
  const [username, setUsername] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('profile')
  
  // Форма профиля
  const [formData, setFormData] = useState({
    full_name: '',
    short_name: '',
    position: '',
    phone: '',
    email: '',
    birth_date: '',
    city: '',
    about: '',
  })
  
  // Настройки уведомлений (хранятся локально)
  const [notifications, setNotifications] = useState<NotificationSettings>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('operator_notifications')
      return saved ? JSON.parse(saved) : {
        telegram: true,
        chat: true,
        salary: true,
      }
    }
    return {
      telegram: true,
      chat: true,
      salary: true,
    }
  })
  
  // Смена пароля
  const [passwordData, setPasswordData] = useState({
    current: '',
    new: '',
    confirm: '',
  })
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  // Смена логина
  const [loginData, setLoginData] = useState({
    current: '',
    new: '',
  })
  const [changingLogin, setChangingLogin] = useState(false)

  useEffect(() => {
    const loadProfile = async () => {
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
            username,
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

        setUsername(authData.username || '')

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
          birth_date: profile.birth_date,
          city: profile.city,
          about: profile.about,
          username: authData.username,
        })

        // Заполняем форму
        setFormData({
          full_name: profile.full_name || '',
          short_name: op.short_name || '',
          position: profile.position || '',
          phone: profile.phone || '',
          email: profile.email || '',
          birth_date: profile.birth_date || '',
          city: profile.city || '',
          about: profile.about || '',
        })

      } catch (err: any) {
        console.error('Ошибка загрузки профиля:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [router])

  // Сохраняем уведомления в localStorage при изменении
  useEffect(() => {
    localStorage.setItem('operator_notifications', JSON.stringify(notifications))
  }, [notifications])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const uploadAvatar = async (file: File) => {
    try {
      setUploading(true)
      setError(null)

      if (!operator) return

      const fileExt = file.name.split('.').pop()
      const fileName = `${operator.id}-${Date.now()}.${fileExt}`
      const filePath = `avatars/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('operator-files')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('operator-files')
        .getPublicUrl(filePath)

      const photo_url = urlData.publicUrl

      const { error: updateError } = await supabase
        .from('operator_profiles')
        .update({ photo_url })
        .eq('operator_id', operator.id)

      if (updateError) throw updateError

      setOperator(prev => prev ? { ...prev, photo_url } : null)
      setSuccess('Фото успешно обновлено')
      setTimeout(() => setSuccess(null), 3000)

    } catch (err: any) {
      console.error('Ошибка загрузки фото:', err)
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const removeAvatar = async () => {
    try {
      setUploading(true)
      setError(null)

      if (!operator?.photo_url || !operator) return

      const { error: updateError } = await supabase
        .from('operator_profiles')
        .update({ photo_url: null })
        .eq('operator_id', operator.id)

      if (updateError) throw updateError

      setOperator(prev => prev ? { ...prev, photo_url: null } : null)
      setSuccess('Фото удалено')
      setTimeout(() => setSuccess(null), 3000)

    } catch (err: any) {
      console.error('Ошибка удаления фото:', err)
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const saveProfile = async () => {
    try {
      setSaving(true)
      setError(null)

      if (!operator) return

      const { error: updateError } = await supabase
        .from('operators')
        .update({ short_name: formData.short_name || null })
        .eq('id', operator.id)

      if (updateError) throw updateError

      const { error: profileError } = await supabase
        .from('operator_profiles')
        .update({
          full_name: formData.full_name || null,
          position: formData.position || null,
          phone: formData.phone || null,
          email: formData.email || null,
          birth_date: formData.birth_date || null,
          city: formData.city || null,
          about: formData.about || null,
        })
        .eq('operator_id', operator.id)

      if (profileError) throw profileError

      setSuccess('Настройки профиля сохранены')
      setTimeout(() => setSuccess(null), 3000)

    } catch (err: any) {
      console.error('Ошибка сохранения:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async () => {
    try {
      setChangingPassword(true)
      setError(null)

      if (!passwordData.current || !passwordData.new || !passwordData.confirm) {
        throw new Error('Заполните все поля')
      }

      if (passwordData.new !== passwordData.confirm) {
        throw new Error('Новые пароли не совпадают')
      }

      if (passwordData.new.length < 8) {
        throw new Error('Пароль должен быть не менее 8 символов')
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РєРѕРЅС„РёРіСѓСЂР°С†РёСЋ Supabase')
      }

      const verificationClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })

      const { error: signInError } = await verificationClient.auth.signInWithPassword({
        email: toOperatorAuthEmail(username),
        password: passwordData.current,
      })

      const data = { error: signInError?.message || 'Current password is invalid' }

      if (signInError) {
        throw new Error(data.error || 'Ошибка смены пароля')
      }

      await verificationClient.auth.signOut().catch(() => null)

      const { error: updateError } = await supabase.auth.updateUser({
        password: passwordData.new,
      })

      if (updateError) {
        throw updateError
      }

      setSuccess('Пароль успешно изменен')
      setPasswordData({ current: '', new: '', confirm: '' })
      setTimeout(() => setSuccess(null), 3000)

    } catch (err: any) {
      console.error('Ошибка смены пароля:', err)
      setError(err.message)
    } finally {
      setChangingPassword(false)
    }
  }

  const changeLogin = async () => {
    try {
      setChangingLogin(true)
      setError(null)

      throw new Error('РЎРјРµРЅР° Р»РѕРіРёРЅР° РІСЂРµРјРµРЅРЅРѕ РѕС‚РєР»СЋС‡РµРЅР°. РЎРЅР°С‡Р°Р»Р° РЅСѓР¶РЅРѕ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°С‚СЊ Р»РѕРіРёРЅ СЃ auth-Р°РєРєР°СѓРЅС‚РѕРј, С‡С‚РѕР±С‹ РЅРµ СЃР»РѕРјР°С‚СЊ РІС…РѕРґ.')

      if (!loginData.current || !loginData.new) {
        throw new Error('Заполните все поля')
      }

      if (loginData.new.length < 3) {
        throw new Error('Логин должен быть не менее 3 символов')
      }

      if (loginData.current !== username) {
        throw new Error('Текущий логин неверен')
      }

      const { data: existingUser } = await supabase
        .from('operator_auth')
        .select('id')
        .eq('username', loginData.new)
        .maybeSingle()

      if (existingUser) {
        throw new Error('Этот логин уже занят')
      }

      const { error: updateError } = await supabase
        .from('operator_auth')
        .update({ username: loginData.new })
        .eq('operator_id', operator?.id)

      if (updateError) throw updateError

      setUsername(loginData.new)
      setSuccess('Логин успешно изменен')
      setLoginData({ current: '', new: '' })
      setTimeout(() => setSuccess(null), 3000)

    } catch (err: any) {
      console.error('Ошибка смены логина:', err)
      setError(err.message)
    } finally {
      setChangingLogin(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    )
  }

  if (!operator) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
        <Card className="p-8 border-red-500/20 bg-red-500/5">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-4" />
          <p className="text-gray-400">Оператор не найден</p>
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
              <h1 className="text-xl font-bold text-white">Настройки</h1>
              <p className="text-xs text-gray-400">{getOperatorDisplayName(operator)}</p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="text-gray-400 hover:text-rose-400"
            onClick={handleLogout}
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Уведомления */}
        {error && (
          <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2 text-emerald-400">
            <CheckCircle className="w-4 h-4" />
            {success}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-gray-900/50 border-white/5">
            <TabsTrigger value="profile" className="data-[state=active]:bg-violet-500/20">
              <User className="w-4 h-4 mr-2" />
              Профиль
            </TabsTrigger>
            <TabsTrigger value="notifications" className="data-[state=active]:bg-violet-500/20">
              <Bell className="w-4 h-4 mr-2" />
              Уведомления
            </TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-violet-500/20">
              <Lock className="w-4 h-4 mr-2" />
              Безопасность
            </TabsTrigger>
          </TabsList>

          {/* Вкладка Профиль */}
          <TabsContent value="profile" className="space-y-6">
            <Card className="p-6 bg-gray-900/40 border-white/5">
              <h3 className="text-sm font-medium text-white mb-4">Фото профиля</h3>
              
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden">
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
                  {uploading && (
                    <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-white animate-spin" />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('avatar-upload')?.click()}
                    disabled={uploading}
                    className="border-white/10 hover:bg-white/10"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Загрузить фото
                  </Button>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadAvatar(file)
                    }}
                  />
                  {operator.photo_url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={removeAvatar}
                      disabled={uploading}
                      className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Удалить
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-gray-900/40 border-white/5">
              <h3 className="text-sm font-medium text-white mb-4">Личная информация</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Полное ФИО</label>
                  <Input
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="Фамилия Имя Отчество"
                    className="bg-gray-800 border-white/10"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Отображаемое имя</label>
                  <Input
                    value={formData.short_name}
                    onChange={(e) => setFormData({ ...formData, short_name: e.target.value })}
                    placeholder="Как вас называть в чате"
                    className="bg-gray-800 border-white/10"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Должность</label>
                  <Input
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    placeholder="Ваша должность"
                    className="bg-gray-800 border-white/10"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Телефон</label>
                    <Input
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+7 (777) 777-77-77"
                      className="bg-gray-800 border-white/10"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Email</label>
                    <Input
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="mail@example.com"
                      className="bg-gray-800 border-white/10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Дата рождения</label>
                    <Input
                      type="date"
                      value={formData.birth_date}
                      onChange={(e) => setFormData({ ...formData, birth_date: e.target.value })}
                      className="bg-gray-800 border-white/10"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Город</label>
                    <Input
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      placeholder="Алматы"
                      className="bg-gray-800 border-white/10"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">О себе</label>
                  <textarea
                    value={formData.about}
                    onChange={(e) => setFormData({ ...formData, about: e.target.value })}
                    placeholder="Расскажите немного о себе..."
                    rows={4}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:border-violet-500 focus:outline-none"
                  />
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Вкладка Уведомления */}
          <TabsContent value="notifications">
            <Card className="p-6 bg-gray-900/40 border-white/5">
              <h3 className="text-sm font-medium text-white mb-4">Настройки уведомлений</h3>
              <p className="text-xs text-gray-500 mb-4">Настройки сохраняются локально в вашем браузере</p>
              
              <div className="space-y-4">
                <label className="flex items-center justify-between p-4 bg-white/5 rounded-lg cursor-pointer">
                  <div className="flex items-center gap-3">
                    <BellRing className="w-5 h-5 text-emerald-400" />
                    <div>
                      <p className="text-sm text-white">Telegram уведомления</p>
                      <p className="text-xs text-gray-500">О долгах и зарплате</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.telegram}
                    onChange={(e) => setNotifications({ ...notifications, telegram: e.target.checked })}
                    className="w-5 h-5 rounded border-white/10 bg-gray-800 text-violet-500"
                  />
                </label>

                <label className="flex items-center justify-between p-4 bg-white/5 rounded-lg cursor-pointer">
                  <div className="flex items-center gap-3">
                    <MessageCircle className="w-5 h-5 text-blue-400" />
                    <div>
                      <p className="text-sm text-white">Уведомления в чате</p>
                      <p className="text-xs text-gray-500">О новых сообщениях</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.chat}
                    onChange={(e) => setNotifications({ ...notifications, chat: e.target.checked })}
                    className="w-5 h-5 rounded border-white/10 bg-gray-800 text-violet-500"
                  />
                </label>

                <label className="flex items-center justify-between p-4 bg-white/5 rounded-lg cursor-pointer">
                  <div className="flex items-center gap-3">
                    <DollarSign className="w-5 h-5 text-amber-400" />
                    <div>
                      <p className="text-sm text-white">Уведомления о зарплате</p>
                      <p className="text-xs text-gray-500">При начислении зарплаты</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.salary}
                    onChange={(e) => setNotifications({ ...notifications, salary: e.target.checked })}
                    className="w-5 h-5 rounded border-white/10 bg-gray-800 text-violet-500"
                  />
                </label>
              </div>
            </Card>
          </TabsContent>

          {/* Вкладка Безопасность */}
          <TabsContent value="security">
            <Card className="p-6 bg-gray-900/40 border-white/5">
              <h3 className="text-sm font-medium text-white mb-4">Ваш логин</h3>
              <div className="p-4 bg-white/5 rounded-lg mb-6">
                <div className="flex items-center gap-3">
                  <AtSign className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="text-sm text-white font-mono">{username}</p>
                    <p className="text-xs text-gray-500">Используется для входа</p>
                  </div>
                </div>
              </div>

              <h3 className="text-sm font-medium text-white mb-4">Смена логина</h3>
              
              <div className="space-y-4 mb-8">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Текущий логин</label>
                  <Input
                    type="text"
                    value={loginData.current}
                    onChange={(e) => setLoginData({ ...loginData, current: e.target.value })}
                    placeholder="Введите текущий логин"
                    className="bg-gray-800 border-white/10"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Новый логин</label>
                  <Input
                    type="text"
                    value={loginData.new}
                    onChange={(e) => setLoginData({ ...loginData, new: e.target.value })}
                    placeholder="Введите новый логин"
                    className="bg-gray-800 border-white/10"
                  />
                </div>

                <Button
                  onClick={changeLogin}
                  disabled={changingLogin}
                  className="w-full bg-gradient-to-r from-blue-500 to-cyan-500"
                >
                  {changingLogin ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <AtSign className="w-4 h-4 mr-2" />
                  )}
                  Сменить логин
                </Button>
              </div>

              <h3 className="text-sm font-medium text-white mb-4">Смена пароля</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Текущий пароль</label>
                  <div className="relative">
                    <Input
                      type={showCurrent ? 'text' : 'password'}
                      value={passwordData.current}
                      onChange={(e) => setPasswordData({ ...passwordData, current: e.target.value })}
                      className="bg-gray-800 border-white/10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent(!showCurrent)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Новый пароль</label>
                  <div className="relative">
                    <Input
                      type={showNew ? 'text' : 'password'}
                      value={passwordData.new}
                      onChange={(e) => setPasswordData({ ...passwordData, new: e.target.value })}
                      className="bg-gray-800 border-white/10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(!showNew)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Подтвердите пароль</label>
                  <div className="relative">
                    <Input
                      type={showConfirm ? 'text' : 'password'}
                      value={passwordData.confirm}
                      onChange={(e) => setPasswordData({ ...passwordData, confirm: e.target.value })}
                      className="bg-gray-800 border-white/10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  onClick={changePassword}
                  disabled={changingPassword}
                  className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                >
                  {changingPassword ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4 mr-2" />
                  )}
                  Сменить пароль
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Кнопка сохранения */}
        <div className="mt-6 flex justify-end">
          <Button
            onClick={saveProfile}
            disabled={saving}
            className="bg-gradient-to-r from-emerald-500 to-green-500"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Сохранить изменения
          </Button>
        </div>
      </main>
    </div>
  )
}
