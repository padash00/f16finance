import { NextResponse } from 'next/server'
import { requireAdminRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function POST(request: Request) {
  try {
    const guard = await requireAdminRequest(request)
    if (guard) return guard

    const { userId, password } = await request.json()
    
    if (!userId || !password) {
      return NextResponse.json(
        { error: 'userId и password обязательны' },
        { status: 400 }
      )
    }

    const supabaseAdmin = createAdminSupabaseClient()
    
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
