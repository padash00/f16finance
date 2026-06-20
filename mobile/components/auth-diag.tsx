import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useAuth } from '@/lib/auth'
import { supabaseHost } from '@/lib/supabase'
import { T } from '@/lib/theme'

const configRef = (supabaseHost.split('.')[0] || '').toLowerCase()
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://ordaops.kz'

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
 * Диагностика входа: сравнивает Supabase-проект приложения, токена и СЕРВЕРА (Vercel).
 * unauthorized при совпадении app=токен, но при ином проекте сервера → сервер отвергает
 * токен. Если app≠токен — осталась старая сессия (выйти и войти). Если сервер≠токен —
 * mobile/.env смотрит не на тот проект, что Vercel.
 */
export function AuthDiag() {
  const { session, signOut } = useAuth()
  const tokenRef = refFromToken(session?.access_token)
  const [serverRef, setServerRef] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/health/supabase`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.ref) setServerRef(String(j.ref).toLowerCase()) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const staleSession = !!tokenRef && !!configRef && tokenRef !== configRef
  const serverMismatch = !!serverRef && !!tokenRef && serverRef !== tokenRef

  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      {staleSession ? (
        <View style={{ backgroundColor: '#1d0f0f', borderColor: '#3b1212', borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 }}>
          <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '800' }}>Старая сессия другого проекта</Text>
          <Text style={{ color: '#9ca3af', fontSize: 12 }}>Токен от «{tokenRef}», приложение настроено на «{configRef}». Выйдите и войдите заново.</Text>
          <Pressable onPress={() => void signOut()} style={{ alignSelf: 'flex-start', backgroundColor: '#3b1212', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: '#fca5a5', fontWeight: '800', fontSize: 13 }}>Выйти и войти заново</Text>
          </Pressable>
        </View>
      ) : serverMismatch ? (
        <View style={{ backgroundColor: '#1d0f0f', borderColor: '#3b1212', borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 }}>
          <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '800' }}>Приложение и сервер — разные проекты</Text>
          <Text style={{ color: '#9ca3af', fontSize: 12 }}>
            Сервер (сайт) работает на проекте «{serverRef}», а приложение/токен — «{tokenRef}». Поэтому сервер отвечает unauthorized. Исправь в mobile/.env: EXPO_PUBLIC_SUPABASE_URL и ANON_KEY на проект «{serverRef}», затем перезапусти expo start -c.
          </Text>
        </View>
      ) : null}
      <Text style={{ color: T.textDim, fontSize: 10 }}>
        прилож.: {configRef || '—'} · токен: {tokenRef || 'нет'} · сервер: {serverRef || '…'}
      </Text>
    </View>
  )
}
