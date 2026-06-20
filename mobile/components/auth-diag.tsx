import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { useAuth } from '@/lib/auth'
import { supabaseHost } from '@/lib/supabase'
import { T } from '@/lib/theme'

const configRef = (supabaseHost.split('.')[0] || '').toLowerCase()
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://ordaops.kz'

type Claims = { ref: string | null; exp: number | null }

/** Декодим JWT payload (claim ref/iss + exp). atob есть в Hermes (RN 0.81). */
function decodeClaims(token?: string | null): Claims {
  if (!token) return { ref: null, exp: null }
  const decode = (globalThis as any).atob as ((s: string) => string) | undefined
  if (!decode) return { ref: null, exp: null }
  try {
    const part = token.split('.')[1] || ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)
    const json = JSON.parse(decode(b64))
    let ref: string | null = json.ref ? String(json.ref).toLowerCase() : null
    if (!ref) {
      const m = String(json.iss || '').match(/https?:\/\/([^.]+)\.supabase/)
      ref = m ? m[1].toLowerCase() : null
    }
    return { ref, exp: typeof json.exp === 'number' ? json.exp : null }
  } catch {
    return { ref: null, exp: null }
  }
}

export function AuthDiag() {
  const router = useRouter()
  const { session, signOut } = useAuth()
  const { ref: tokenRef, exp } = decodeClaims(session?.access_token)
  const [serverRef, setServerRef] = useState<string | null>(null)
  const [whoami, setWhoami] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/health/supabase`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.ref) setServerRef(String(j.ref).toLowerCase()) })
      .catch(() => {})
    const token = session?.access_token
    if (token) {
      fetch(`${API_BASE}/api/health/whoami`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive || !j) return
          setWhoami(j.verdict ? String(j.verdict) : (j.userId ? `user ${j.email || j.userId}` : `НЕТ user · ${j.error || 'null'}`))
        })
        .catch(() => {})
    }
    return () => { alive = false }
  }, [session?.access_token])

  const nowSec = Math.floor(Date.now() / 1000)
  const expired = exp != null && exp < nowSec
  const minsLeft = exp != null ? Math.round((exp - nowSec) / 60) : null
  const staleSession = !!tokenRef && !!configRef && tokenRef !== configRef
  const serverMismatch = !staleSession && !!serverRef && !!tokenRef && serverRef !== tokenRef

  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      {staleSession ? (
        <Banner title="Старая сессия другого проекта" text={`Токен от «${tokenRef}», приложение настроено на «${configRef}».`} />
      ) : serverMismatch ? (
        <Banner title="Приложение и сервер — разные проекты" text={`Сервер на «${serverRef}», токен — «${tokenRef}». Поправь mobile/.env на проект сервера и expo start -c.`} />
      ) : expired ? (
        <Banner title="Токен сессии истёк" text="Старая сессия в памяти не обновилась. Выйдите и войдите заново — получите свежий токен." />
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {/* Чистый перелогин помогает почти всегда: стирает старую сессию и берёт свежий токен. */}
        <Pressable onPress={() => void signOut()} style={{ backgroundColor: '#3b1212', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: '#fca5a5', fontWeight: '800', fontSize: 13 }}>Выйти и войти заново</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/diag')} style={{ borderColor: T.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: T.textMut, fontWeight: '800', fontSize: 13 }}>Полная диагностика</Text>
        </Pressable>
      </View>

      <Text style={{ color: T.textDim, fontSize: 10 }}>
        прилож.: {configRef || '—'} · токен: {tokenRef || 'нет'} · сервер: {serverRef || '…'}
        {exp != null ? ` · токен ${expired ? `истёк ${-Number(minsLeft)} мин назад` : `ещё ${minsLeft} мин`}` : ''}
      </Text>
      <Text style={{ color: T.textDim, fontSize: 10 }}>сервер видит: {whoami || '…'}</Text>
    </View>
  )
}

function Banner({ title, text }: { title: string; text: string }) {
  return (
    <View style={{ backgroundColor: '#1d0f0f', borderColor: '#3b1212', borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 }}>
      <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: '#9ca3af', fontSize: 12 }}>{text}</Text>
    </View>
  )
}
