import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function POST(request: Request) {
  console.log('🚀 API called: /api/admin/create-operator-account')
  
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    // 1. Парсим тело запроса
    const body = await request.json()
    console.log('Request body:', { 
      operatorId: body.operatorId, 
      username: body.username, 
      email: body.email,
      name: body.name 
    })
    
    const { operatorId, username, email, name } = body

    // 2. Проверяем обязательные поля
    if (!operatorId || !username || !email) {
      console.error('Missing required fields:', { operatorId, username, email })
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // 3. Проверяем формат email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      console.error('Invalid email format:', email)
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // 4. Проверяем переменные окружения
    console.log('Environment check:', {
      hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL || !!process.env.SUPABASE_URL,
      hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY || !!process.env.SUPABASE_SERVICE_KEY
    })

    // 5. Создаем клиент с service role key
    const supabase = createAdminSupabaseClient()

    // 6. Проверяем, не существует ли уже аккаунт
    const { data: existingAuth, error: checkError } = await supabase
      .from('operator_auth')
      .select('id')
      .eq('operator_id', operatorId)
      .maybeSingle()

    if (checkError) {
      console.error('Error checking existing auth:', checkError)
      return NextResponse.json(
        { error: 'Database error: ' + checkError.message },
        { status: 500 }
      )
    }

    if (existingAuth) {
      return NextResponse.json(
        { error: 'Account already exists for this operator' },
        { status: 400 }
      )
    }

    // 7. Генерируем криптографически стойкий пароль
    const generatePassword = () => {
      const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
      const lower = 'abcdefghijkmnopqrstuvwxyz'
      const digits = '0123456789'
      const special = '!@#$%^&*'
      const all = upper + lower + digits + special
      const bytes = crypto.getRandomValues(new Uint8Array(20))
      let password = ''
      // Гарантируем наличие каждого типа символов
      password += upper[bytes[0] % upper.length]
      password += lower[bytes[1] % lower.length]
      password += digits[bytes[2] % digits.length]
      password += special[bytes[3] % special.length]
      for (let i = 4; i < 20; i++) {
        password += all[bytes[i] % all.length]
      }
      // Перемешиваем, чтобы первые 4 символа были не предсказуемы
      const arr = password.split('')
      for (let i = arr.length - 1; i > 0; i--) {
        const j = bytes[i % bytes.length] % (i + 1)
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr.join('')
    }

    const password = generatePassword()
    console.log('Generated password for user:', { username, email })

    // 8. Создаем пользователя в auth.users
    console.log('Creating auth user with email:', email)
    const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        role: 'operator',
        operator_id: operatorId,
        name: name || username
      }
    })

    if (createError) {
      console.error('Error creating auth user:', createError)
      
      // Если пользователь уже существует, пытаемся найти его
      if (createError.message.includes('already registered')) {
        const { data: users } = await supabase.auth.admin.listUsers()
        const foundUser = users?.users.find(u => u.email === email)
        
        if (foundUser) {
          console.log('Found existing user:', foundUser.id)
          
          // Создаем запись в operator_auth для существующего пользователя
          const { error: linkError } = await supabase
            .from('operator_auth')
            .insert({
              operator_id: operatorId,
              user_id: foundUser.id,
              username: username,
              role: 'operator',
              is_active: true
            })

          if (linkError) {
            console.error('Error linking existing user:', linkError)
            return NextResponse.json(
              { error: linkError.message },
              { status: 500 }
            )
          }

          return NextResponse.json({
            success: true,
            username: username,
            operatorId: operatorId,
            userId: foundUser.id,
            note: 'User already existed. Password set to new one. Credentials sent to email.'
          })
        }
      }
      
      return NextResponse.json(
        { error: createError.message },
        { status: 500 }
      )
    }

    if (!authUser.user) {
      console.error('No user returned from auth.admin.createUser')
      return NextResponse.json(
        { error: 'Failed to create user: No user returned' },
        { status: 500 }
      )
    }

    console.log('Auth user created successfully:', authUser.user.id)

    // 9. Создаем запись в operator_auth
    const { error: authError } = await supabase
      .from('operator_auth')
      .insert({
        operator_id: operatorId,
        user_id: authUser.user.id,
        username: username,
        role: 'operator',
        is_active: true
      })

    if (authError) {
      console.error('Error creating operator auth:', authError)
      
      // Если не удалось создать запись, удаляем созданного пользователя
      try {
        await supabase.auth.admin.deleteUser(authUser.user.id)
        console.log('Rolled back: deleted auth user')
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError)
      }
      
      return NextResponse.json(
        { error: authError.message },
        { status: 500 }
      )
    }

    console.log('Operator auth record created successfully')

    // 10. Возвращаем успешный ответ (пароль НЕ возвращаем — отправляется на email)
    return NextResponse.json({
      success: true,
      username: username,
      operatorId: operatorId,
      userId: authUser.user.id
    })

  } catch (err: any) {
    console.error('Unexpected error in API:', err)
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Operator account creation API',
    usage: 'POST with { operatorId, username, email, name }'
  })
}
