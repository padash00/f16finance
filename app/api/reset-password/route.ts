import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { userId, password } = await request.json()
    
    if (!userId || !password) {
      return NextResponse.json(
        { error: 'userId и password обязательны' },
        { status: 400 }
      )
    }

    // Проверяем наличие переменных окружения
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing environment variables')
      return NextResponse.json(
        { error: 'Ошибка конфигурации сервера' },
        { status: 500 }
      )
    }

    // Создаем admin клиент с service role key
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
    
    // Обновляем пароль через admin API
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password }
    )
    
    if (error) {
      console.error('Admin API error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }
    
    return NextResponse.json({ 
      success: true,
      user: data.user
    })
  } catch (error: any) {
    console.error('Server error:', error)
    return NextResponse.json(
      { error: error.message || 'Внутренняя ошибка сервера' },
      { status: 500 }
    )
  }
}