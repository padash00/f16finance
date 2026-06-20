import { Pressable, Text, View } from 'react-native'

import { useAuth } from '@/lib/auth'
import { supabaseHost } from '@/lib/supabase'
import { T } from '@/lib/theme'

const configRef = (supabaseHost.split('.')[0] || '').toLowerCase()

/** Достаём ref проекта из JWT (claim ref / iss). atob есть в Hermes (RN 0.81). */
function refFromToken(token?: string | null): string | null {
  if (!token) return null
  const decode = (globalThis as any).atob as ((s: string) => string) | undefined
  if (!decode) return null
  try {
    const part = token.split('.')[1] || ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)
    const json = JSON.parse(decode(b64))
    if (json.ref) return String(json.ref).toLowerCase()
    const m = String(json.iss || '').match(/https?:\/\/([^.]+)\.supabase/)
    return m ? m[1].toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * Диагностика входа: показывает, к какому Supabase-проекту привязаны приложение и токен.
 * Если токен выдан ДРУГИМ проектом (осталась старая сессия после смены .env) — сервер
 * отвечает unauthorized; предлагаем выйти и войти заново.
 */
export function AuthDiag() {
  const { session, signOut } = useAuth()
  const tokenRef = refFromToken(session?.access_token)
  const mismatch = !!tokenRef && !!configRef && tokenRef !== configRef

  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      {mismatch ? (
        <View style={{ backgroundColor: '#1d0f0f', borderColor: '#3b1212', borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 }}>
          <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '800' }}>Сессия от другого проекта</Text>
          <Text style={{ color: '#9ca3af', fontSize: 12 }}>
            Токен выдан проектом «{tokenRef}», а приложение настроено на «{configRef}». Поэтому сервер отвечает unauthorized. Выйдите и войдите заново.
          </Text>
          <Pressable onPress={() => void signOut()} style={{ alignSelf: 'flex-start', backgroundColor: '#3b1212', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: '#fca5a5', fontWeight: '800', fontSize: 13 }}>Выйти и войти заново</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={{ color: T.textDim, fontSize: 10 }}>
        Supabase: {supabaseHost}{tokenRef ? ` · токен: ${tokenRef}` : ' · нет токена'}
      </Text>
    </View>
  )
}
