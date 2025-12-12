'use client'

import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabaseClient"

export default function UnauthorizedPage() {
  const router = useRouter()

  const handleLogout = async () => {
    // чистим сессию
    await supabase.auth.signOut()
    // отправляем на логин
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#050505] text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-[#0b0b0f] border border-white/10 rounded-2xl shadow-xl p-8 flex flex-col items-center text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/40 flex items-center justify-center mb-2">
            <Lock className="w-7 h-7 text-red-400" />
          </div>

          <h1 className="text-2xl font-bold tracking-tight">
            Нет доступа к странице
          </h1>

          <p className="text-sm text-muted-foreground">
            У вас нет прав для просмотра этого раздела. Если вы считаете, что это ошибка — свяжитесь с владельцем системы
            или администратором.
          </p>

          <div className="w-full border-t border-white/10 pt-4 mt-2 space-y-2">
            <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <AlertTriangle className="w-3 h-3 text-yellow-400" />
              <span>Доступ только для авторизованных пользователей</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-2">
              {/* Кнопка: сначала выходим, потом на логин */}
              <Button
                onClick={handleLogout}
                className="flex-1 h-9 text-sm font-medium bg-[#d7ff00] text-black hover:bg-[#c4f000]"
              >
                Выйти и войти снова
              </Button>

              <Link href="/" className="flex-1">
                <Button className="w-full h-9 text-sm" variant="outline">
                  На главную
                </Button>
              </Link>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/70 mt-2">
            F16 Finance · Панель управления клубом
          </p>
        </div>
      </div>
    </div>
  )
}
