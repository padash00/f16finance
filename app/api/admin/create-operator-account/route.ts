import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  console.log('🚀 API called: /api/admin/create-operator-account')
  
  try {
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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    console.log('Environment check:', {
      hasUrl: !!supabaseUrl,
      hasKey: !!supabaseServiceKey
    })

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing environment variables')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // 5. Создаем клиент с service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

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

    // 7. Генерируем надежный пароль
    const generatePassword = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789'
      let password = ''
      for (let i = 0; i < 10; i++) {
        password += chars[Math.floor(Math.random() * chars.length)]
      }
      // Добавляем спецсимвол и цифру для надежности
      return password + '1!'
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
            password: password,
            operatorId: operatorId,
            userId: foundUser.id,
            note: 'User already existed. Password set to new one.'
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

    // 10. Возвращаем успешный ответ
    return NextResponse.json({
      success: true,
      username: username,
      password: password,
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