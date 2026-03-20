'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'  // 👈 ЭТОТ ИМПОРТ НУЖЕН
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Send,
  LogOut,
  Home,
  Smile,
  Paperclip,
  MoreVertical,
  Check,
  CheckCheck,
  Bell,
  BellOff,
  Users,
  User as UserIcon,
  Settings,
  Loader2,
  X,
  Phone,
  Mail,
  Briefcase,
  Calendar,
  Award,
  Clock,
  Star,
  MessageCircle,
  UserCircle,
  ChevronRight,
  Trophy,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Message = {
  id: number
  sender_id: string
  sender_name: string
  message: string
  created_at: string
  is_edited?: boolean
}

type OnlineUser = {
  id: string
  name: string
  is_online: boolean
  last_seen: string
  photo_url?: string | null
  position?: string | null
  phone?: string | null
  email?: string | null
  hire_date?: string | null
  total_xp?: number
  level?: number
  achievements_count?: number
}

type OperatorProfile = {
  id: string
  name: string
  full_name?: string | null
  short_name: string | null
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  total_xp: number
  level: number
  achievements_count: number
  last_seen: string
  is_online: boolean
}

const CHAT_RETENTION_HOURS = 24

function getChatRetentionCutoffISO() {
  return new Date(Date.now() - CHAT_RETENTION_HOURS * 60 * 60 * 1000).toISOString()
}

export default function OperatorChatPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [operatorId, setOperatorId] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [operatorAvatar, setOperatorAvatar] = useState<string | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [showSidebar, setShowSidebar] = useState(false)
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [selectedProfile, setSelectedProfile] = useState<OperatorProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Скролл вниз при новых сообщениях
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Обновление статуса онлайн
  const updateOnlineStatus = useCallback(async (isOnline: boolean) => {
    if (!operatorId) return
    
    await supabase
      .from('operator_auth')
      .update({ 
        is_online: isOnline,
        last_seen: new Date().toISOString()
      })
      .eq('id', operatorId)
  }, [operatorId])

  // Загрузка профиля оператора
  const loadOperatorProfile = async (userId: string) => {
    try {
      setLoadingProfile(true)
      console.log(`📥 Загрузка профиля пользователя ${userId}`)
      
      // Получаем данные оператора
      const { data: authData, error: authError } = await supabase
        .from('operator_auth')
        .select(`
          id,
          operator_id,
          operators (
            id,
            name,
            short_name,
            operator_profiles (*)
          )
        `)
        .eq('id', userId)
        .maybeSingle()

      if (authError) throw authError
      if (!authData) {
        console.log('❌ Оператор не найден')
        return
      }

      const op = authData.operators as any
      const profile = op?.operator_profiles || {}
      const operatorId = op.id

      // Получаем уровень и XP
      const { data: levelData } = await supabase
        .rpc('get_operator_level_info', { operator_uuid: operatorId })

      // Получаем количество достижений
      const { data: achievementsData } = await supabase
        .rpc('get_operator_achievements', { operator_uuid: operatorId })

      const levelInfo = levelData && levelData.length > 0 ? levelData[0] : { calculated_level: 1, total_xp: 0 }
      const achievementsCount = achievementsData?.length || 0

      // Получаем статус онлайн
      const { data: statusData } = await supabase
        .from('operator_auth')
        .select('is_online, last_seen')
        .eq('id', userId)
        .maybeSingle()

      setSelectedProfile({
        id: userId,
        name: op.name,
        short_name: op.short_name,
        photo_url: profile.photo_url,
        position: profile.position,
        phone: profile.phone,
        email: profile.email,
        hire_date: profile.hire_date,
        total_xp: levelInfo.total_xp || 0,
        level: levelInfo.calculated_level || 1,
        achievements_count: achievementsCount,
        last_seen: statusData?.last_seen || new Date().toISOString(),
        is_online: statusData?.is_online || false,
      })

    } catch (err) {
      console.error('❌ Ошибка загрузки профиля:', err)
    } finally {
      setLoadingProfile(false)
    }
  }

  // Загрузка данных и подписка
  useEffect(() => {
    let isSubscribed = true
    let subscription: any = null
    let typingSubscription: any = null

    const initChat = async () => {
      try {
        console.log('1️⃣ Начинаем инициализацию чата')
        
        // Получаем пользователя
        const { data: { user } } = await supabase.auth.getUser()
        console.log('2️⃣ Пользователь:', user?.id)
        
        if (!user) {
          router.push('/login')
          return
        }

        // Получаем данные оператора
        const { data: authData, error: authError } = await supabase
          .from('operator_auth')
          .select(`
            id,
            operators (
              short_name,
              name,
              operator_profiles (*)
            )
          `)
          .eq('user_id', user.id)
          .maybeSingle()

        console.log('3️⃣ Данные оператора:', authData)

        if (authData && isSubscribed) {
          const op = authData.operators as any
          setOperatorId(authData.id)
          setOperatorName(getOperatorDisplayName(op, 'Оператор'))
          setOperatorAvatar(op?.operator_profiles?.photo_url)
          
          // Устанавливаем статус онлайн
          await updateOnlineStatus(true)
        }

        // Загружаем онлайн пользователей
        const { data: onlineData } = await supabase
          .from('operator_auth')
          .select(`
            id,
            is_online,
            last_seen,
            operators (
              short_name,
              name,
              operator_profiles (*)
            )
          `)
          .order('is_online', { ascending: false })

        if (onlineData) {
          setOnlineUsers(onlineData.map((u: any) => ({
            id: u.id,
            name: getOperatorDisplayName(u.operators, 'Оператор'),
            is_online: u.is_online,
            last_seen: u.last_seen,
            photo_url: u.operators?.operator_profiles?.photo_url,
            position: u.operators?.operator_profiles?.position,
            phone: u.operators?.operator_profiles?.phone,
            email: u.operators?.operator_profiles?.email,
            hire_date: u.operators?.operator_profiles?.hire_date,
          })))
        }

        // Загружаем последние 50 сообщений
        console.log('4️⃣ Загружаем сообщения...')
        const retentionCutoff = getChatRetentionCutoffISO()
        const { data, error } = await supabase
          .from('operator_chat_messages')
          .select('*')
          .gte('created_at', retentionCutoff)
          .order('created_at', { ascending: true })
          .limit(50)

        if (error) {
          console.error('5️⃣ Ошибка загрузки:', error)
        } else {
          console.log('5️⃣ Загружено сообщений:', data?.length)
          if (isSubscribed) {
            setMessages(data || [])
          }
        }

        // Подписка на новые сообщения
        console.log('6️⃣ Настраиваем подписку на сообщения...')
        subscription = supabase
          .channel('chat-messages')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'operator_chat_messages'
            },
            (payload: any) => {
              console.log('7️⃣ 🔔 НОВОЕ СООБЩЕНИЕ!', payload.new)
              if (new Date((payload.new as any).created_at).getTime() < Date.now() - CHAT_RETENTION_HOURS * 60 * 60 * 1000) {
                return
              }
              if (isSubscribed) {
                setMessages(prev => [...prev, payload.new as Message])
                
                // Показываем уведомление если окно не активно
                if (document.hidden && notificationsEnabled) {
                  const sender = (payload.new as any).sender_name
                  const message = (payload.new as any).message
                  new Notification(`💬 ${sender}`, {
                    body: message.length > 50 ? message.substring(0, 50) + '...' : message,
                    icon: '/icon.png'
                  })
                }
              }
            }
          )
          .subscribe()

        // Подписка на изменения статуса пользователей
        const statusSubscription = supabase
          .channel('online-status')
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'operator_auth'
            },
            (payload: any) => {
              console.log('🔄 Статус изменен:', payload.new)
              setOnlineUsers(prev => 
                prev.map(u => 
                  u.id === payload.new.id 
                    ? { 
                        ...u, 
                        is_online: payload.new.is_online,
                        last_seen: payload.new.last_seen 
                      }
                    : u
                )
              )
            }
          )
          .subscribe()

        // Запрашиваем разрешение на уведомления
        if (Notification.permission === 'default') {
          Notification.requestPermission()
        }

      } catch (err) {
        console.error('❌ Ошибка:', err)
      } finally {
        setLoading(false)
      }
    }

    initChat()

    // Очистка при размонтировании
    return () => {
      console.log('9️⃣ Очищаем подписки')
      isSubscribed = false
      updateOnlineStatus(false)
      if (subscription) {
        supabase.removeChannel(subscription)
      }
    }
  }, [router, updateOnlineStatus, notificationsEnabled])

  const sendMessage = async () => {
    if (!newMessage.trim() || !operatorId || !operatorName) return

    const text = newMessage.trim()
    setNewMessage('')
    
    console.log('📤 Отправляем сообщение:', text)

    try {
      const { data, error } = await supabase
        .from('operator_chat_messages')
        .insert({
          sender_id: operatorId,
          sender_name: operatorName,
          message: text
        })
        .select()
        .single()

      if (error) {
        console.error('❌ Ошибка отправки:', error)
        setNewMessage(text)
      } else {
        console.log('✅ Сообщение отправлено')
        if (new Date((data as any).created_at).getTime() >= Date.now() - CHAT_RETENTION_HOURS * 60 * 60 * 1000) {
          setMessages(prev => [...prev, data])
        }
      }
    } catch (err) {
      console.error('❌ Ошибка:', err)
      setNewMessage(text)
    }
  }

  const handleTyping = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      // Убираем индикатор через 2 секунды
    }, 2000)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    } else {
      handleTyping()
    }
  }

  const formatTime = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const minutes = Math.floor(diff / 60000)
    
    if (minutes < 1) return 'только что'
    if (minutes < 60) return `${minutes} мин назад`
    
    return d.toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const formatLastSeen = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (minutes < 1) return 'только что'
    if (minutes < 60) return `${minutes} мин назад`
    if (hours < 24) return `${hours} ч назад`
    return `${days} дн назад`
  }

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

  const emojis = ['😊', '😂', '❤️', '👍', '🎉', '🔥', '👋', '😢', '😡', '🤔']

  if (loading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-950 flex">
      {/* Модальное окно профиля */}
      {selectedProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <Card className="max-w-md w-full bg-gray-900 border-white/10 p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden">
                  {selectedProfile.photo_url ? (
                    <Image
                      src={selectedProfile.photo_url}
                      alt={selectedProfile.name}
                      width={48}
                      height={48}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-lg font-bold">
                      {selectedProfile.name.charAt(0)}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">{getOperatorDisplayName(selectedProfile, 'Оператор')}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={`w-2 h-2 rounded-full ${selectedProfile.is_online ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <span className="text-xs text-gray-400">
                      {selectedProfile.is_online ? 'онлайн' : `был ${formatLastSeen(selectedProfile.last_seen)}`}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedProfile(null)}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {loadingProfile ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Должность */}
                {selectedProfile.position && (
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                    <Briefcase className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-white">{selectedProfile.position}</span>
                  </div>
                )}

                {/* Контакты */}
                {selectedProfile.phone && (
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-white">{selectedProfile.phone}</span>
                  </div>
                )}

                {selectedProfile.email && (
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-white">{selectedProfile.email}</span>
                  </div>
                )}

                {/* Дата устройства */}
                {selectedProfile.hire_date && (
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-white">
                      С {new Date(selectedProfile.hire_date).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                )}

                {/* Достижения */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 bg-yellow-500/10 rounded-lg text-center">
                    <Star className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
                    <p className="text-lg font-bold text-yellow-400">{selectedProfile.level}</p>
                    <p className="text-xs text-gray-500">Уровень</p>
                  </div>
                  <div className="p-3 bg-blue-500/10 rounded-lg text-center">
                    <Award className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                    <p className="text-lg font-bold text-blue-400">{selectedProfile.total_xp}</p>
                    <p className="text-xs text-gray-500">XP</p>
                  </div>
                  <div className="p-3 bg-emerald-500/10 rounded-lg text-center">
                    <Trophy className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                    <p className="text-lg font-bold text-emerald-400">{selectedProfile.achievements_count}</p>
                    <p className="text-xs text-gray-500">Достижений</p>
                  </div>
                </div>

                {/* Кнопка "Написать" */}
                <Button
                  className="w-full mt-2 bg-gradient-to-r from-violet-500 to-fuchsia-500"
                  onClick={() => {
                    setSelectedProfile(null)
                    // Можно добавить фокус на ввод сообщения
                  }}
                >
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Написать сообщение
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Основной чат */}
      <div className="flex-1 flex flex-col">
        {/* Шапка */}
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/operator-dashboard" className="text-gray-400 hover:text-white">
              <Home className="w-5 h-5" />
            </Link>
            
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="lg:hidden p-2 hover:bg-gray-800 rounded-lg"
            >
              <Users className="w-5 h-5 text-gray-400" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden">
                {operatorAvatar ? (
                  <Image
                    src={operatorAvatar}
                    alt={operatorName}
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                    {operatorName.charAt(0)}
                  </div>
                )}
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Общий чат</h1>
                <p className="text-xs text-gray-500">
                  {onlineUsers.filter(u => u.is_online).length} онлайн
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white"
              title={notificationsEnabled ? 'Отключить уведомления' : 'Включить уведомления'}
            >
              {notificationsEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
            </button>
            
            <Link href="/operator-settings">
              <button className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white">
                <Settings className="w-5 h-5" />
              </button>
            </Link>

            <button
              onClick={() => supabase.auth.signOut().then(() => router.push('/login'))}
              className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-red-400"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Сообщения */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-600 mt-10">
              Нет сообщений. Напишите что-нибудь!
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === operatorId
              
              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[70%] ${isMe ? 'order-2' : 'order-1'}`}>
                    {!isMe && (
                      <button
                        onClick={() => loadOperatorProfile(msg.sender_id)}
                        className="text-xs text-gray-500 hover:text-violet-400 mb-1 ml-1 transition-colors flex items-center gap-1"
                      >
                        <UserCircle className="w-3 h-3" />
                        {msg.sender_name}
                      </button>
                    )}
                    <div
                      className={cn(
                        "p-3 rounded-2xl",
                        isMe
                          ? 'bg-violet-500 text-white rounded-br-none'
                          : 'bg-gray-800 text-gray-200 rounded-bl-none'
                      )}
                    >
                      <p className="text-sm break-words">{msg.message}</p>
                    </div>
                    <div className={`flex items-center gap-1 mt-1 text-xs text-gray-600 px-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <span>{formatTime(msg.created_at)}</span>
                      {isMe && (
                        <span title="Прочитано">
                          <CheckCheck className="w-3 h-3 text-blue-400" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Ввод сообщения */}
        <div className="border-t border-gray-800 bg-gray-900 p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Напишите сообщение..."
                className="w-full bg-gray-800 border-gray-700 text-white pr-20"
              />
              
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white"
                >
                  <Smile className="w-4 h-4" />
                </button>
                <button
                  className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              </div>

              {/* Панель эмодзи */}
              {showEmojiPicker && (
                <div className="absolute bottom-full mb-2 left-0 bg-gray-800 border border-gray-700 rounded-lg p-2 flex gap-1 flex-wrap max-w-[200px]">
                  {emojis.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => {
                        setNewMessage(prev => prev + emoji)
                        setShowEmojiPicker(false)
                      }}
                      className="p-1 hover:bg-gray-700 rounded text-lg"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={sendMessage}
              disabled={!newMessage.trim()}
              className="bg-violet-500 hover:bg-violet-600"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Боковая панель с пользователями */}
      <div className={cn(
        "w-80 border-l border-gray-800 bg-gray-900/50 p-4 overflow-y-auto",
        showSidebar ? 'block' : 'hidden lg:block'
      )}>
        <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
          <Users className="w-4 h-4" />
          Онлайн ({onlineUsers.filter(u => u.is_online).length})
        </h3>

        <div className="space-y-3">
          {onlineUsers.map(user => (
            <button
              key={user.id}
              onClick={() => loadOperatorProfile(user.id)}
              className="w-full flex items-center gap-3 p-2 hover:bg-gray-800 rounded-lg transition-colors text-left"
            >
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 overflow-hidden">
                  {user.id === operatorId && operatorAvatar ? (
                    <Image
                      src={operatorAvatar}
                      alt={user.name}
                      width={32}
                      height={32}
                      className="w-full h-full object-cover"
                    />
                  ) : user.photo_url ? (
                    <Image
                      src={user.photo_url}
                      alt={user.name}
                      width={32}
                      height={32}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                      {user.name.charAt(0)}
                    </div>
                  )}
                </div>
                {user.is_online && (
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-gray-900" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">
                  {user.name}
                  {user.id === operatorId && <span className="text-xs text-gray-500 ml-2">(вы)</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {user.is_online ? 'онлайн' : `был ${formatLastSeen(user.last_seen)}`}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
