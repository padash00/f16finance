import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero } from '@/components/ui'

type Overview = {
  organizationCount: number
  activeOrganizationCount: number
  activeSubscriptions: number
  trialingSubscriptions: number
  pastDueSubscriptions: number
  totalCompanies: number
  totalMembers: number
  liveMrr: number
  trialMrr: number
  overdueInvoices: number
  overdueInvoicesSum: number
  paidThisMonth: number
  trialsEndingSoon: number
}

type AttentionItem = { id: string; name: string; slug: string; reasons: string[] }

type OrgRow = {
  id: string
  name: string
  slug: string
  status: string
  companyCount: number
  memberCount: number
  subscription: { status: string; plan: { name: string } | null } | null
  createdAt: string | null
}

type Resp = {
  overview: Overview | null
  organizations: OrgRow[]
  attention: AttentionItem[]
}

const STATUS: Record<string, { text: string; tone: 'good' | 'warn' | 'bad' | 'mut' | 'brand' }> = {
  active: { text: 'Активна', tone: 'good' },
  trialing: { text: 'Пробный', tone: 'brand' },
  trial: { text: 'Пробный', tone: 'brand' },
  past_due: { text: 'Просрочена', tone: 'bad' },
  suspended: { text: 'Приостановлена', tone: 'mut' },
  canceled: { text: 'Отменена', tone: 'mut' },
}

const initials = (name: string) => (name || '?').slice(0, 2).toUpperCase()
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

function StatCell({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: T.card2, borderRadius: 14, padding: 12 }}>
      <Text style={{ color: T.textMut, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>{label}</Text>
      <Text style={{ color, fontSize: 22, fontWeight: '900', marginTop: 4 }} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={{ color: T.textDim, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{sub}</Text> : null}
    </View>
  )
}

export default function PlatformScreen() {
  const router = useRouter()
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Resp>('/api/admin/organizations')
      setData({
        overview: res?.overview || null,
        organizations: res?.organizations || [],
        attention: Array.isArray(res?.attention) ? res.attention : [],
      })
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const ov = data?.overview || null
  const orgs = data?.organizations || []
  const attention = data?.attention || []

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Платформа</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => load()} tintColor={T.green} />}
      >
        {loading && !data ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : (
          <>
            <GlowHero glow={T.violet}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ОРГАНИЗАЦИЙ НА ПЛАТФОРМЕ</Text>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{ov?.organizationCount ?? 0}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                <Pill text={`активных ${ov?.activeOrganizationCount ?? 0}`} tone="good" />
                {(ov?.trialingSubscriptions ?? 0) > 0 ? <Pill text={`триал ${ov?.trialingSubscriptions}`} tone="brand" /> : null}
                {(ov?.pastDueSubscriptions ?? 0) > 0 ? <Pill text={`просрочено ${ov?.pastDueSubscriptions}`} tone="bad" /> : null}
              </View>
              {ov?.liveMrr ? (
                <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Live MRR: {moneyShort(ov.liveMrr)}</Text>
              ) : null}
            </GlowHero>

            {/* Финансы */}
            <SectionTitle>Деньги</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              <StatCell label="Live MRR" value={ov?.liveMrr ? moneyShort(ov.liveMrr) : '—'} color={T.amber} />
              <StatCell label="Trial MRR" value={ov?.trialMrr ? moneyShort(ov.trialMrr) : '—'} color={T.blue} />
              <StatCell label="Оплачено в этом месяце" value={ov?.paidThisMonth ? moneyShort(ov.paidThisMonth) : '—'} color={T.greenBright} />
              <StatCell
                label="Просрочено счетов"
                value={ov?.overdueInvoices ?? 0}
                sub={ov?.overdueInvoicesSum ? moneyShort(ov.overdueInvoicesSum) : undefined}
                color={(ov?.overdueInvoices ?? 0) > 0 ? T.red : T.text}
              />
            </View>

            {/* Масштаб */}
            <SectionTitle>Масштаб</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              <StatCell label="Точек всего" value={ov?.totalCompanies ?? 0} color={T.text} />
              <StatCell label="Участников" value={ov?.totalMembers ?? 0} color={T.text} />
              <StatCell label="Активных подписок" value={ov?.activeSubscriptions ?? 0} color={T.greenBright} />
              <StatCell label="Триал истекает (≤7 дн)" value={ov?.trialsEndingSoon ?? 0} color={(ov?.trialsEndingSoon ?? 0) > 0 ? T.amber : T.text} />
            </View>

            {/* Требуют внимания */}
            {attention.length > 0 ? (
              <>
                <SectionTitle hint={String(attention.length)}>Требуют внимания</SectionTitle>
                <Card style={{ padding: 0 }}>
                  {attention.map((a, i) => (
                    <View
                      key={a.id}
                      style={{ padding: 14, borderBottomWidth: i < attention.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Ionicons name="alert-circle" size={16} color={T.amber} />
                        <Text style={{ color: T.text, fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>{a.name}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {(a.reasons || []).map((r) => (
                          <Pill key={r} text={r} tone="warn" />
                        ))}
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Последние организации */}
            <SectionTitle>Последние организации</SectionTitle>
            {orgs.length === 0 ? (
              <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
                <Ionicons name="business-outline" size={38} color={T.textDim} />
                <Text style={{ color: T.textMut, fontSize: 14 }}>Организаций пока нет</Text>
              </Card>
            ) : (
              <Card style={{ padding: 0 }}>
                {orgs.slice(0, 12).map((org, i, arr) => {
                  const statusKey = org.subscription?.status || org.status
                  const st = STATUS[statusKey] || { text: statusKey || '—', tone: 'mut' as const }
                  const planName = org.subscription?.plan?.name || null
                  return (
                    <View
                      key={org.id}
                      style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}
                    >
                      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.violet + '22', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: T.violet, fontSize: 14, fontWeight: '900' }}>{initials(org.name)}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{org.name || 'Без названия'}</Text>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{org.slug ? `${org.slug}.ordaops.kz` : '—'}</Text>
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                          <Text style={{ color: T.textMut, fontSize: 11 }}>Точек: {org.companyCount ?? 0}</Text>
                          <Text style={{ color: T.textMut, fontSize: 11 }}>Людей: {org.memberCount ?? 0}</Text>
                          {planName ? <Text style={{ color: T.textMut, fontSize: 11 }}>{planName}</Text> : null}
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 6 }}>
                        <Pill text={st.text} tone={st.tone} />
                        <Text style={{ color: T.textDim, fontSize: 10 }}>{fmtDate(org.createdAt)}</Text>
                      </View>
                    </View>
                  )
                })}
              </Card>
            )}

            {orgs.length > 0 ? (
              <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
                Показано {Math.min(orgs.length, 12)} из {orgs.length}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
