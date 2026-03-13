import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessPath, getDefaultAppPath, normalizeStaffRole, isPublicPath } from '@/lib/core/access'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'

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

  // API-маршруты живут по собственной авторизации в route handlers.
  if (url.pathname.startsWith('/api/')) {
    return response
  }

  // --- СЦЕНАРИЙ 1: Пользователь НЕ вошел в систему (Гость) ---
  if (!user) {
    // Если это публичная страница - пускаем
    if (isPublicPath(url.pathname)) {
      return response
    }
    // Иначе отправляем на страницу выбора входа
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // --- СЦЕНАРИЙ 2: Пользователь ВОШЕЛ в систему (Авторизован) ---

  const isSuperAdmin = isAdminEmail(user.email)

  // 2. Проверяем, является ли пользователь сотрудником (staff)
  const staffMember = isSuperAdmin ? null : await resolveStaffByUser(supabase, user)
  const staffRole = normalizeStaffRole(staffMember?.role)

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
  const isStaff = isSuperAdmin || !!staffMember
  const isOperator = !!operatorAuth
  const defaultPath = getDefaultAppPath({ isSuperAdmin, isStaff, isOperator, staffRole })

  // Если пытается зайти на страницы входа - редирект в домашний раздел по роли
  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/operator-login')) {
    url.pathname = defaultPath
    return NextResponse.redirect(url)
  }

  // Проверяем, имеет ли пользователь доступ к запрашиваемой странице
  const requestedPath = url.pathname
  const hasAccess = canAccessPath({
    pathname: requestedPath,
    isStaff,
    isOperator,
    staffRole,
    isSuperAdmin,
  })

  if (requestedPath === '/' && !hasAccess) {
    url.pathname = defaultPath
    return NextResponse.redirect(url)
  }

  // Проверяем доступ
  if (!hasAccess) {
    // Если нет доступа и еще не на странице ошибки - отправляем туда
    if (!requestedPath.startsWith('/unauthorized')) {
      url.pathname = '/unauthorized'
      return NextResponse.redirect(url)
    }
    // Уже на странице ошибки - пускаем
    return response
  }

  // Если пользователь на странице ошибки, но имеет доступ - редирект на главную
  if (requestedPath.startsWith('/unauthorized') && hasAccess) {
    url.pathname = defaultPath
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
