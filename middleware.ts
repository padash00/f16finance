import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // 1. Инициализируем ответ
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // 2. Создаем клиент Supabase для работы с куками
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({
            request: { headers: request.headers },
          })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({
            request: { headers: request.headers },
          })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  // 3. Проверяем, кто зашел (получаем пользователя)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const url = request.nextUrl.clone()

  // --- СПИСОК ПУБЛИЧНЫХ СТРАНИЦ (доступны без авторизации) ---
  const publicPaths = ['/login', '/operator-login', '/unauthorized']
  const isPublicPath = publicPaths.some(path => url.pathname.startsWith(path))

  // --- СЦЕНАРИЙ 1: Пользователь НЕ вошел в систему (Гость) ---
  if (!user) {
    // Если это публичная страница - пускаем
    if (isPublicPath) {
      return response
    }
    // Иначе отправляем на страницу выбора входа
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // --- СЦЕНАРИЙ 2: Пользователь ВОШЕЛ в систему (Авторизован) ---
  
  // Если пытается зайти на страницы входа - редирект
  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/operator-login')) {
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // 🛑 ПРОВЕРКА ПРАВ ДОСТУПА 🛑
  
  // 1. Бэкдор для ГЛАВНОГО АДМИНА
  const MY_EMAIL = 'padash00@gmail.com'
  
  if (user.email === MY_EMAIL) {
    // Админа пускаем везде
    if (url.pathname.startsWith('/unauthorized')) {
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
    return response
  }

  // 2. Проверяем, является ли пользователь сотрудником (staff)
  const { data: staffMember } = await supabase
    .from('staff')
    .select('id, role')
    .eq('email', user.email)
    .maybeSingle()

  // 3. Проверяем, является ли пользователь оператором
  const { data: operatorAuth } = await supabase
    .from('operator_auth')
    .select(`
      operator_id,
      role,
      operators (
        id,
        name,
        is_active
      )
    `)
    .eq('user_id', user.id)
    .maybeSingle()

  // Определяем роль пользователя
  const isStaff = !!staffMember
  const isOperator = !!operatorAuth
  const staffRole = staffMember?.role || null
  const operatorRole = operatorAuth?.role || null

  // --- СПИСОК СТРАНИЦ ПО РОЛЯМ ---
  const adminPaths = [
    '/',
    '/income',
    '/income/add',
    '/expenses',
    '/expenses/add',
    '/salary',
    '/salary/rules',
    '/reports',
    '/analysis',
    '/weekly-report',
    '/staff',
    '/tax',
    '/operators',
    '/operators/*',
    '/operator-analytics',
    '/debug',
    '/settings',
    '/pass',
  ]

  const operatorPaths = [
    '/operator-dashboard',
    '/operator-dashboard/*',
    '/operator-profile',
    '/operator-profile/*',
    '/operator-chat',
    '/operator-chat/*',
    '/operator-settings',
    '/operator-settings/*',
    '/operator-achievements',
    '/operator-achievements/*',
  ]

  // Проверяем, имеет ли пользователь доступ к запрашиваемой странице
  const requestedPath = url.pathname

  // Функция проверки доступа
  const hasAccess = () => {
    // Сотрудники имеют доступ к админским страницам
    if (isStaff) {
      const hasAccessToAdminPath = adminPaths.some(path => {
        if (path.endsWith('/*')) {
          return requestedPath.startsWith(path.slice(0, -2))
        }
        return requestedPath === path
      })
      return hasAccessToAdminPath
    }

    // Операторы имеют доступ только к своим страницам
    if (isOperator) {
      const hasAccessToOperatorPath = operatorPaths.some(path => {
        if (path.endsWith('/*')) {
          return requestedPath.startsWith(path.slice(0, -2))
        }
        return requestedPath === path
      })
      return hasAccessToOperatorPath
    }

    // Неизвестный пользователь - нет доступа
    return false
  }

  // Проверяем доступ
  if (!hasAccess()) {
    // Если нет доступа и еще не на странице ошибки - отправляем туда
    if (!requestedPath.startsWith('/unauthorized')) {
      url.pathname = '/unauthorized'
      return NextResponse.redirect(url)
    }
    // Уже на странице ошибки - пускаем
    return response
  }

  // Если пользователь на странице ошибки, но имеет доступ - редирект на главную
  if (requestedPath.startsWith('/unauthorized') && hasAccess()) {
    url.pathname = isStaff ? '/' : '/operator-dashboard'
    return NextResponse.redirect(url)
  }

  return response
}

// Настройка путей, где работает этот "охранник"
export const config = {
  matcher: [
    /*
     * Применяем ко всем путям, кроме:
     * - _next/static (статические файлы Next.js)
     * - _next/image (оптимизация картинок)
     * - favicon.ico (иконка сайта)
     * - файлы изображений (svg, png, jpg и т.д.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}