import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, ErrorState, EmptyState, SkeletonList } from '@/components/ui'

type Operator = { id: string; name: string; short_name: string | null; is_active: boolean }
type Profile = {
  operator_id: string
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
}
type DocRow = { operator_id: string; expiry_date: string | null }
type Resp = {
  data?: {
    operators?: Operator[]
    profiles?: Profile[]
    documents?: DocRow[]
  }
}

// Стаж: «N лет M мес» из даты найма
const tenure = (hire: string | null): string | null => {
  if (!hire) return null
  const start = new Date(hire)
  if (Number.isNaN(start.getTime())) return null
  const now = new Date()
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (months < 0) months = 0
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y > 0 && m > 0) return `${y} г ${m} мес`
  if (y > 0) return `${y} г`
  return `${m} мес`
}

export default function OperatorAnalyticsScreen() {
  const router = useRouter()
  const [d, setD] = useState<Resp['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Resp>('/api/admin/operator-analytics')
      setD(res.data || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // карта профилей и количества документов / истекающих (окно 30 дней)
  const { rows, activeCount, expiringTotal } = useMemo(() => {
    const profileById = new Map<string, Profile>()
    for (const p of d?.profiles || []) profileById.set(p.operator_id, p)

    const now = new Date()
    const limit = new Date()
    limit.setDate(limit.getDate() + 30)

    const docsCount = new Map<string, number>()
    const expiringCount = new Map<string, number>()
    for (const doc of d?.documents || []) {
      const id = doc.operator_id
      docsCount.set(id, (docsCount.get(id) || 0) + 1)
      if (doc.expiry_date) {
        const exp = new Date(doc.expiry_date)
        if (!Number.isNaN(exp.getTime()) && exp >= now && exp <= limit) {
          expiringCount.set(id, (expiringCount.get(id) || 0) + 1)
        }
      }
    }

    const ops = (d?.operators || []).slice().sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
      return (a.name || '').localeCompare(b.name || '', 'ru')
    })

    let activeCount = 0
    let expiringTotal = 0
    const rows = ops.map((o) => {
      const profile = profileById.get(o.id)
      const docs = docsCount.get(o.id) || 0
      const expiring = expiringCount.get(o.id) || 0
      if (o.is_active) activeCount += 1
      expiringTotal += expiring
      return {
        id: o.id,
        name: o.short_name || o.name || 'Без имени',
        isActive: o.is_active,
        position: profile?.position || null,
        phone: profile?.phone || null,
        email: profile?.email || null,
        tenureLabel: tenure(profile?.hire_date || null),
        docs,
        expiring,
      }
    })

    return { rows, activeCount, expiringTotal }
  }, [d])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Аналитика операторов</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={() => load()} tintColor={T.green} />}
      >
        {loading && !d ? (
          <SkeletonList rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => load()} />
        ) : d ? (
          <>
            <GlowHero glow={T.green}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>АКТИВНЫХ ОПЕРАТОРОВ</Text>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{activeCount}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                <Pill text={`всего ${rows.length}`} tone="mut" />
                {expiringTotal > 0 ? <Pill text={`истекают док-ты ${expiringTotal}`} tone="warn" /> : null}
              </View>
            </GlowHero>

            {rows.length === 0 ? (
              <EmptyState icon="people-outline" title="Операторов нет" />
            ) : (
              <>
                <SectionTitle hint={`${rows.length}`}>Операторы</SectionTitle>
                <Card style={{ padding: 0 }}>
                  {rows.map((r, i) => (
                    <View
                      key={r.id}
                      style={{
                        flexDirection: 'row',
                        gap: 12,
                        alignItems: 'center',
                        padding: 14,
                        borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                        borderBottomColor: T.borderSoft,
                        opacity: r.isActive ? 1 : 0.55,
                      }}
                    >
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: R.md,
                          backgroundColor: T.card2,
                          borderWidth: 1,
                          borderColor: T.border,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: T.textMut, fontSize: 16, fontWeight: '900' }}>
                          {(r.name || '?').charAt(0).toUpperCase()}
                        </Text>
                      </View>

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                            {r.name}
                          </Text>
                          {!r.isActive ? <Pill text="неактивен" tone="mut" /> : null}
                        </View>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                          {[r.position, r.tenureLabel ? `стаж ${r.tenureLabel}` : null, r.phone].filter(Boolean).join(' · ') || 'Нет данных профиля'}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                          <Pill text={`док-тов ${r.docs}`} tone={r.docs > 0 ? 'brand' : 'mut'} />
                          {r.expiring > 0 ? <Pill text={`истекают ${r.expiring}`} tone="warn" /> : null}
                        </View>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
