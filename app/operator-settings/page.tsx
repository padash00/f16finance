'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  User,
  Bell,
  Lock,
  Camera,
  Moon,
  Sun,
  Globe,
  Shield,
  Smartphone,
  Mail,
  Phone,
  Briefcase,
  Calendar,
  Save,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Upload,
  X,
  Palette,
  Languages,
  Volume2,
  Vibrate,
} from 'lucide-react'

type Operator = {
  id: string
  name: string
  short_name: string
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
}

type ProfileSettings = {
  // Личная информация (из operator_profiles)
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  
  // Настройки уведомлений
  notification_email: boolean
  notification_push: boolean
  notification_sound: boolean
  notification_vibration: boolean
  notification_preview: boolean
  show_online_status: boolean
  
  // Настройки оформления
  theme: 'dark' | 'light'
  language: 'ru' | 'kk' | 'en'
}

export default function OperatorSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [operator, setOperator] = useState<Operator | null>(null)
  const [profile, setProfile] = useState<ProfileSettings | null>(null)
  const [operatorId, setOperatorId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Состояния для изменения пароля
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  // Загрузка данных
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true)

        // Получаем пользователя
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        // Получаем данные оператора из auth
        const { data: authData } = await supabase
          .from('operator_auth')
          .select(`
            id,
            operators (
              id,
              name,
              short_name
            )
          `)
          .eq('user_id', user.id)
          .single()

        if (!authData) {
          router.push('/login')
          return
        }

        setOperatorId(authData.id)

        const op = authData.operators as any

        // Получаем профиль оператора
        const { data: profileData } = await supabase
          .from('operator_profiles')
          .select('*')
          .eq('operator_id', op.id)
          .single()

        setOperator({
          id: op.id,
          name: op.name,
          short_name: op.short_name || op.name,
          photo_url: profileData?.photo_url || null,
          position: profileData?.position || null,
          phone: profileData?.phone || null,
          email: profileData?.email || null,
          hire_date: profileData?.hire_date || null,
        })

        // Загружаем настройки
        setProfile({
          photo_url: profileData?.photo_url || null,
          position: profileData?.position || null,
          phone: profileData?.phone || null,
          email: profileData?.email || null,
          hire_date: profileData?.hire_date || null,
          notification_email: profileData?.notification_email ?? true,
          notification_push: profileData?.notification_push ?? true,
          notification_sound: profileData?.notification_sound ?? true,
          notification_vibration: profileData?.notification_vibration ?? true,
          notification_preview: profileData?.notification_preview ?? true,
          show_online_status: profileData?.show_online_status ?? true,
          theme: profileData?.theme || 'dark',
          language: profileData?.language || 'ru',
        })

      } catch (err) {
        console.error('Error loading settings:', err)
        setError('Ошибка загрузки настроек')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [router])

  // Сохранение настроек в БД
  const saveSettings = async () => {
    if (!operator || !profile) return

    try {
      setSaving(true)
      setError(null)

      const { error: updateError } = await supabase
        .from('operator_profiles')
        .update({
          phone: profile.phone,
          email: profile.email,
          notification_email: profile.notification_email,
          notification_push: profile.notification_push,
          notification_sound: profile.notification_sound,
          notification_vibration: profile.notification_vibration,
          notification_preview: profile.notification_preview,
          show_online_status: profile.show_online_status,
          theme: profile.theme,
          language: profile.language,
          updated_at: new Date().toISOString()
        })
        .eq('operator_id', operator.id)

      if (updateError) throw updateError

      setSuccess('Настройки сохранены')
      setTimeout(() => setSuccess(null), 3000)

    } catch (err: any) {
      console.error('Error saving settings:', err)
      setError(err.message || 'Ошибка сохранения настроек')
    } finally {
      setSaving(false)
    }
  }

  // Обновление полей профиля
  const updateProfileField = (field: keyof ProfileSettings, value: any) => {
    setProfile(prev => prev ? { ...prev, [field]: value } : null)
  }

  // Смена пароля
  const changePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Заполните все поля')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают')
      return
    }

    if (newPassword.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }

    try {
      setChangingPassword(true)
      setError(null)

      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error

      setSuccess('Пароль успешно изменен')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setSuccess(null), 3000)

    } catch (err: any) {
      setError(err.message || 'Ошибка при смене пароля')
    } finally {
      setChangingPassword(false)
    }
  }

  // Загрузка аватара
  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !operator) return

    try {
      setSaving(true)

      if (file.size > 5 * 1024 * 1024) {
        setError('Файл слишком большой. Максимум 5MB')
        return
      }

      if (!file.type.startsWith('image/')) {
        setError('Пожалуйста, выберите изображение')
        return
      }

      const fileExt = file.name.split('.').pop()
      const fileName = `${operator.id}-${Date.now()}.${fileExt}`
      const filePath = `avatars/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('operator-files')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('operator-files')
        .getPublicUrl(filePath)

      const { error: updateError } = await supabase
        .from('operator_profiles')
        .upsert({
          operator_id: operator.id,
          photo_url: publicUrl
        }, { onConflict: 'operator_id' })

      if (updateError) throw updateError

      setOperator(prev => prev ? { ...prev, photo_url: publicUrl } : null)
      updateProfileField('photo_url', publicUrl)
      setSuccess('Аватар обновлен')
      setTimeout(() => setSuccess(null), 3000)

    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки аватара')
    } finally {
      setSaving(false)
    }
  }

  // Удаление аватара
  const removeAvatar = async () => {
    if (!operator?.photo_url) return

    try {
      setSaving(true)

      const { error } = await supabase
        .from('operator_profiles')
        .upsert({
          operator_id: operator.id,
          photo_url: null
        }, { onConflict: 'operator_id' })

      if (error) throw error

      setOperator(prev => prev ? { ...prev, photo_url: null } : null)
      updateProfileField('photo_url', null)
      setSuccess('Аватар удален')
      setTimeout(() => setSuccess(null), 3000)

    } catch (err) {
      setError('Ошибка удаления аватара')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      {/* Шапка */}
      <header className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/operator-dashboard" className="p-2 hover:bg-white/5 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </Link>
            <h1 className="text-xl font-bold text-white">Настройки</h1>
          </div>

          <Button
            onClick={saveSettings}
            disabled={saving}
            className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Сохранить
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Уведомления */}
        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            {success}
          </div>
        )}

        <Tabs defaultValue="profile" className="space-y-6">
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
            <TabsTrigger value="appearance" className="data-[state=active]:bg-violet-500/20">
              <Palette className="w-4 h-4 mr-2" />
              Оформление
            </TabsTrigger>
          </TabsList>

          {/* Вкладка: Профиль */}
          <TabsContent value="profile" className="space-y-6">
            <Card className="p-6 bg-gray-900/50 border-white/5">
              <h3 className="text-lg font-medium text-white mb-4">Фото профиля</h3>
              
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden">
                    {operator?.photo_url ? (
                      <Image
                        src={operator.photo_url}
                        alt={operator.name}
                        width={96}
                        height={96}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white text-3xl font-bold">
                        {operator?.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  <label className="absolute -bottom-2 -right-2 p-2 bg-gray-800 rounded-lg border border-white/10 cursor-pointer hover:bg-gray-700 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={uploadAvatar}
                      className="hidden"
                    />
                    <Camera className="w-4 h-4 text-gray-400" />
                  </label>

                  {operator?.photo_url && (
                    <button
                      onClick={removeAvatar}
                      className="absolute -top-2 -right-2 p-1.5 bg-rose-500 rounded-lg hover:bg-rose-600 transition-colors"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                </div>

                <div className="flex-1">
                  <p className="text-sm text-gray-400 mb-2">
                    Рекомендуемый размер: до 5MB. Форматы: JPG, PNG, GIF
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-gray-900/50 border-white/5">
              <h3 className="text-lg font-medium text-white mb-4">Личная информация</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Имя</label>
                  <div className="flex items-center gap-2 p-3 bg-gray-800/50 rounded-lg">
                    <User className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-white">{operator?.name}</span>
                  </div>
                </div>

                {operator?.short_name && (
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Краткое имя</label>
                    <div className="flex items-center gap-2 p-3 bg-gray-800/50 rounded-lg">
                      <Briefcase className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-white">{operator.short_name}</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Телефон</label>
                  <Input
                    value={profile?.phone || ''}
                    onChange={(e) => updateProfileField('phone', e.target.value)}
                    className="bg-gray-800/50 border-white/10"
                    placeholder="+7 (777) 777-77-77"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Email</label>
                  <Input
                    type="email"
                    value={profile?.email || ''}
                    onChange={(e) => updateProfileField('email', e.target.value)}
                    className="bg-gray-800/50 border-white/10"
                    placeholder="email@example.com"
                  />
                </div>

                {operator?.position && (
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Должность</label>
                    <div className="flex items-center gap-2 p-3 bg-gray-800/50 rounded-lg">
                      <Briefcase className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-white">{operator.position}</span>
                    </div>
                  </div>
                )}

                {operator?.hire_date && (
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Дата найма</label>
                    <div className="flex items-center gap-2 p-3 bg-gray-800/50 rounded-lg">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-white">
                        {new Date(operator.hire_date).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Вкладка: Уведомления */}
          <TabsContent value="notifications" className="space-y-6">
            <Card className="p-6 bg-gray-900/50 border-white/5">
              <h3 className="text-lg font-medium text-white mb-4">Настройки уведомлений</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
                  <div>
                    <p className="text-sm text-white">Email уведомления</p>
                    <p className="text-xs text-gray-500">Получать уведомления на email</p>
                  </div>
                  <Switch
                    checked={profile?.notification_email ?? true}
                    onCheckedChange={(checked) => updateProfileField('notification_email', checked)}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
                  <div>
                    <p className="text-sm text-white">Push уведомления</p>
                    <p className="text-xs text-gray-500">Уведомления в браузере</p>
                  </div>
                  <Switch
                    checked={profile?.notification_push ?? true}
                    onCheckedChange={(checked) => updateProfileField('notification_push', checked)}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-gray-500" />
                    <div>
                      <p className="text-sm text-white">Звук</p>
                      <p className="text-xs text-gray-500">Звуковое оповещение</p>
                    </div>
                  </div>
                  <Switch
                    checked={profile?.notification_sound ?? true}
                    onCheckedChange={(checked) => updateProfileField('notification_sound', checked)}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Vibrate className="w-4 h-4 text-gray-500" />
                    <div>
                      <p className="text-sm text-white">Вибрация</p>
                      <p className="text-xs text-gray-500">Вибросигнал на телефоне</p>
                    </div>
                  </div>
                  <Switch
                    checked={profile?.notification_vibration ?? true}
                    onCheckedChange={(checked) => updateProfileField('notification_vibration', checked)}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
                  <div>
                    <p className="text-sm text-white">Превью сообщений</p>
                    <p className="text-xs text-gray-500">Показывать текст сообщений в уведомлениях</p>
                  </div>
                  <Switch
                    checked={profile?.notification_preview ?? true}
                    onCheckedChange={(checked) => updateProfileField('notification_preview', checked)}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
                  <div>
                    <p className="text-sm text-white">Показывать онлайн статус</p>
                    <p className="text-xs text-gray-500">Другие видят когда вы онлайн</p>
                  </div>
                  <Switch
                    checked={profile?.show_online_status ?? true}
                    onCheckedChange={(checked) => updateProfileField('show_online_status', checked)}
                  />
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Вкладка: Безопасность */}
          <TabsContent value="security" className="space-y-6">
            <Card className="p-6 bg-gray-900/50 border-white/5">
              <h3 className="text-lg font-medium text-white mb-4">Смена пароля</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Текущий пароль</label>
                  <div className="relative">
                    <Input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="bg-gray-800/50 border-white/10 pr-10"
                      placeholder="Введите текущий пароль"
                    />
                    <button
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Новый пароль</label>
                  <div className="relative">
                    <Input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="bg-gray-800/50 border-white/10 pr-10"
                      placeholder="Введите новый пароль"
                    />
                    <button
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Подтверждение пароля</label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="bg-gray-800/50 border-white/10 pr-10"
                      placeholder="Подтвердите новый пароль"
                    />
                    <button
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  onClick={changePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                  className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
                >
                  {changingPassword ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4 mr-2" />
                  )}
                  Изменить пароль
                </Button>
              </div>
            </Card>
          </TabsContent>

          {/* Вкладка: Оформление */}
          <TabsContent value="appearance" className="space-y-6">
            <Card className="p-6 bg-gray-900/50 border-white/5">
              <h3 className="text-lg font-medium text-white mb-4">Оформление</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    {profile?.theme === 'dark' ? (
                      <Moon className="w-4 h-4 text-gray-500" />
                    ) : (
                      <Sun className="w-4 h-4 text-gray-500" />
                    )}
                    <div>
                      <p className="text-sm text-white">Тема оформления</p>
                      <p className="text-xs text-gray-500">Выберите тему интерфейса</p>
                    </div>
                  </div>
                  <select
                    value={profile?.theme || 'dark'}
                    onChange={(e) => updateProfileField('theme', e.target.value as 'dark' | 'light')}
                    className="bg-gray-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="dark">Тёмная</option>
                    <option value="light">Светлая</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-500" />
                    <div>
                      <p className="text-sm text-white">Язык интерфейса</p>
                      <p className="text-xs text-gray-500">Выберите язык</p>
                    </div>
                  </div>
                  <select
                    value={profile?.language || 'ru'}
                    onChange={(e) => updateProfileField('language', e.target.value as 'ru' | 'kk' | 'en')}
                    className="bg-gray-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="ru">Русский</option>
                    <option value="kk">Қазақша</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}