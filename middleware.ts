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

  // --- СЦЕНАРИЙ 1: Пользователь НЕ вошел в систему (Гость) ---
  if (!user) {
    // Если он пытается зайти куда угодно, кроме страницы входа или страницы "нет доступа"
    if (!url.pathname.startsWith('/login') && !url.pathname.startsWith('/unauthorized')) {
      // Отправляем его на страницу входа
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    // Если он уже на странице входа — пускаем
    return response
  }

  // --- СЦЕНАРИЙ 2: Пользователь ВОШЕЛ в систему (Авторизован) ---
  if (user) {
    // Если он пытается зайти на страницу входа, будучи уже внутри -> кидаем на главную
    if (url.pathname.startsWith('/login')) {
      url.pathname = '/'
      return NextResponse.redirect(url)
    }

    // 🛑 ПРОВЕРКА БЕЛОГО СПИСКА (WHITELIST) 🛑
    
    // 1. Бэкдор для ГЛАВНОГО АДМИНА (чтобы вы себя не заблокировали)
    // ⚠️ ВПИШИТЕ СЮДА СВОЙ EMAIL, С КОТОРОГО ВЫ ЗАРЕГИСТРИРОВАЛИСЬ
    const MY_EMAIL = 'padash00@gmail.com' 
    
    if (user.email === MY_EMAIL) {
        // Админа пускаем везде. Если он случайно на странице "нет доступа", возвращаем на главную
        if (url.pathname.startsWith('/unauthorized')) {
            url.pathname = '/'
            return NextResponse.redirect(url)
        }
        return response 
    }

    // 2. Ищем человека в таблице сотрудников (staff)
    const { data: staffMember } = await supabase
      .from('staff')
      .select('id')
      .eq('email', user.email)
      .single()

    // ВАРИАНТ А: ЕГО НЕТ В СПИСКЕ -> БЛОКИРУЕМ
    if (!staffMember) {
      // Если он еще не на странице ошибки, отправляем туда
      if (!url.pathname.startsWith('/unauthorized')) {
        url.pathname = '/unauthorized'
        return NextResponse.redirect(url)
      }
      // Если он уже там, пусть сидит (пускаем к странице ошибки)
      return response
    }
    
    // ВАРИАНТ Б: ОН ЕСТЬ В СПИСКЕ (Сотрудник) -> ПУСКАЕМ
    if (staffMember) {
      // Если он по ошибке зашел на "нет доступа", возвращаем в работу
      if (url.pathname.startsWith('/unauthorized')) {
        url.pathname = '/'
        return NextResponse.redirect(url)
      }
      // Пускаем к рабочим страницам
      return response
    }
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