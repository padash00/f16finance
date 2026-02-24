'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Loader2
} from 'lucide-react'
import Link from 'next/link'
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout>()

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

        // ✅ ИСПРАВЛЕНО: используем maybeSingle() вместо single()
        const { data: authData, error: authError } = await supabase
          .from('operator_auth')
          .select(`
            id,
            operators (
              short_name,
              name,
              operator_profiles (
                photo_url
              )
            )
          `)
          .eq('user_id', user.id)
          .maybeSingle()  // вместо .single()

        if (authError) {
          console.error('❌ Ошибка получения данных оператора:', authError)
          return
        }

        console.log('3️⃣ Данные оператора:', authData)

        if (authData && isSubscribed) {
          const op = authData.operators as any
          setOperatorId(authData.id)
          setOperatorName(op?.short_name || op?.name || 'Оператор')
          setOperatorAvatar(op?.operator_profiles?.photo_url)
          
          // Устанавливаем статус онлайн
          await updateOnlineStatus(true)
        } else {
          console.log('❌ Оператор не найден для user_id:', user.id)
          // Возможно, нужно создать запись?
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
              name
            )
          `)
          .order('is_online', { ascending: false })

        if (onlineData) {
          setOnlineUsers(onlineData.map((u: any) => ({
            id: u.id,
            name: u.operators?.short_name || u.operators?.name || 'Оператор',
            is_online: u.is_online,
            last_seen: u.last_seen
          })))
        }

        // Загружаем последние 50 сообщений
        console.log('4️⃣ Загружаем сообщения...')
        const { data, error } = await supabase
          .from('operator_chat_messages')
          .select('*')
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
            (payload) => {
              console.log('7️⃣ 🔔 НОВОЕ СООБЩЕНИЕ!', payload.new)
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
            (payload) => {
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
        setMessages(prev => [...prev, data])
      }
    } catch (err) {
      console.error('❌ Ошибка:', err)
      setNewMessage(text)
    }
  }

  const handleTyping = () => {
    // Здесь можно добавить индикатор "печатает"
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    
    // Отправляем событие что печатаем
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
                      <p className="text-xs text-gray-500 mb-1 ml-1">
                        {msg.sender_name}
                      </p>
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
            <div key={user.id} className="flex items-center gap-3 p-2 hover:bg-gray-800 rounded-lg">
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
              <div className="flex-1">
                <p className="text-sm text-white">
                  {user.name}
                  {user.id === operatorId && <span className="text-xs text-gray-500 ml-2">(вы)</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {user.is_online ? 'онлайн' : `был ${formatLastSeen(user.last_seen)}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}