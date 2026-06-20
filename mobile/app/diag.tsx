import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { supabase, supabaseHost } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { T } from '@/lib/theme'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://www.ordaops.kz'
const configRef = (supabaseHost.split('.')[0] || '').toLowerCase()

function decode(token?: string | null): any {
  if (!token) return null
  const a = (globalThis as any).atob as ((s: string) => string) | undefined
  if (!a) return null
  try {
    const p = token.split('.')[1] || ''
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (p.length % 4)) % 4)
    return JSON.parse(a(b64))
  } catch {
    return null
  }
}

// Страницы/эндпоинты, которые приложение реально дёргает.
const ENDPOINTS: { label: string; path: string }[] = [
  { label: 'Главная (дашборд)', path: '/api/admin/dashboard' },
  { label: 'Финансы (свод)', path: '/api/admin/reports/bundle?days=30' },
  { label: 'Команда (смены)', path: '/api/admin/operators-presence' },
  { label: 'Подписка', path: '/api/admin/my-subscription' },
  { label: 'Согласования', path: '/api/admin/expenses/pending' },
  { label: 'Кабинет оператора', path: '/api/operator/overview' },
]

type Row = { label: string; status: number; ok: boolean; detail: string }

export default function DiagScreen() {
  const router = useRouter()
  const { signOut } = useAuth()
  const [token, setToken] = useState<string | null>(null)
  const [serverRef, setServerRef] = useState<string | null>(null)
  const [whoami, setWhoami] = useState<string>('…')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const run = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.auth.getSession()
    const tk = data.session?.access_token || null
    setToken(tk)

    // health сервера
    try {
      const r = await fetch(`${API_BASE}/api/health/supabase`)
      const j = await r.json().catch(() => null)
      setServerRef(j?.ref ? String(j.ref).toLowerCase() : null)
    } catch { setServerRef(null) }

    // whoami (3 способа)
    if (tk) {
      try {
        const r = await fetch(`${API_BASE}/api/health/whoami`, { headers: { Authorization: `Bearer ${tk}` } })
        const j = await r.json().catch(() => null)
        setWhoami(j?.verdict || (j?.userId ? `user ${j.email || j.userId}` : `НЕТ user · ${j?.error || 'null'}`))
      } catch (e: any) { setWhoami(`ошибка: ${e?.message || 'ex'}`) }
    } else setWhoami('нет токена')

    // пинг каждой страницы
    const out: Row[] = []
    for (const ep of ENDPOINTS) {
      try {
        const r = await fetch(`${API_BASE}${ep.path}`, { headers: tk ? { Authorization: `Bearer ${tk}`, Accept: 'application/json' } : { Accept: 'application/json' } })
        let detail = ''
        if (!r.ok) {
          const j = await r.json().catch(() => null)
          detail = j?.error || j?.message || ''
        }
        out.push({ label: ep.label, status: r.status, ok: r.ok, detail })
      } catch (e: any) {
        out.push({ label: ep.label, status: 0, ok: false, detail: e?.message || 'нет связи' })
      }
    }
    setRows(out)
    setLoading(false)
  }, [])

  useEffect(() => { void run() }, [run])

  const claims = decode(token)
  const tokenRef = claims ? String(claims.ref || '').toLowerCase() || null : null
  const exp = claims?.exp ? Math.round((claims.exp - Date.now() / 1000) / 60) : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '800', flex: 1 }}>Диагностика</Text>
        <Pressable onPress={() => void run()} hitSlop={10}><Ionicons name="refresh" size={20} color={T.textMut} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40, gap: 14 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={run} tintColor={T.green} />}>
        <Block title="Проект Supabase">
          <KV k="приложение" v={configRef || '—'} />
          <KV k="токен" v={tokenRef || 'нет'} bad={!!tokenRef && tokenRef !== configRef} />
          <KV k="сервер (Vercel)" v={serverRef || '…'} bad={!!serverRef && !!tokenRef && serverRef !== tokenRef} />
        </Block>

        <Block title="Токен">
          <KV k="пользователь" v={claims?.email || claims?.sub || 'нет'} />
          <KV k="роль" v={claims?.role || '—'} />
          <KV k="срок" v={exp == null ? '—' : exp < 0 ? `истёк ${-exp} мин назад` : `ещё ${exp} мин`} bad={exp != null && exp < 0} />
        </Block>

        <Block title="Сервер видит по токену">
          <Text style={{ color: T.textMut, fontSize: 12 }}>{whoami}</Text>
        </Block>

        <Block title="Страницы / эндпоинты">
          {loading && rows.length === 0 ? (
            <ActivityIndicator color={T.green} style={{ marginVertical: 12 }} />
          ) : (
            rows.map((r) => (
              <View key={r.label} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: T.text, fontSize: 13, flex: 1 }}>{r.label}</Text>
                  <Text style={{ color: r.ok ? T.green : T.red, fontSize: 13, fontWeight: '800' }}>{r.ok ? `✓ ${r.status}` : `✗ ${r.status || '—'}`}</Text>
                </View>
                {r.detail ? <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>{r.detail}</Text> : null}
              </View>
            ))
          )}
        </Block>

        <Pressable onPress={() => void signOut()} style={{ marginTop: 4, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#3b1212', backgroundColor: '#160c0c', alignItems: 'center' }}>
          <Text style={{ color: T.red, fontWeight: '700', fontSize: 14 }}>Выйти и войти заново</Text>
        </Pressable>
        <Text style={{ color: T.textDim, fontSize: 10, textAlign: 'center' }}>API: {API_BASE}</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 14, gap: 8 }}>
      <Text style={{ color: T.text, fontSize: 14, fontWeight: '800' }}>{title}</Text>
      {children}
    </View>
  )
}

function KV({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ color: T.textDim, fontSize: 12 }}>{k}</Text>
      <Text style={{ color: bad ? T.red : T.textMut, fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'right' }} numberOfLines={1}>{v}</Text>
    </View>
  )
}
