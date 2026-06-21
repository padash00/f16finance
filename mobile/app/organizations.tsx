import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, SectionTitle, ErrorState, EmptyState, SkeletonList } from '@/components/ui'
import { haptic } from '@/lib/haptics'

type Subscription = {
  status: string
  billingPeriod?: string | null
  startsAt: string | null
  endsAt: string | null
  plan: { name: string; code: string } | null
} | null

type Org = {
  id: string
  name: string
  slug: string
  status: string
  primaryDomain: string
  appUrl: string
  companyCount: number
  memberCount: number
  createdAt: string | null
  subscription: Subscription
}

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

type Resp = { overview?: Overview; organizations?: Org[] }

const STATUS: Record<string, { text: string; tone: 'good' | 'warn' | 'bad' | 'mut' | 'brand' }> = {
  active: { text: 'Активна', tone: 'good' },
  trialing: { text: 'Пробный', tone: 'brand' },
  trial: { text: 'Пробный', tone: 'brand' },
  past_due: { text: 'Просрочена', tone: 'bad' },
  suspended: { text: 'Заморожена', tone: 'mut' },
  canceled: { text: 'Отменена', tone: 'mut' },
}

const statusOf = (org: Org) => org.subscription?.status || org.status || ''
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—')

const initials = (name: string) => (name || '').trim().slice(0, 2).toUpperCase() || '?'

export default function OrganizationsScreen() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Org | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Resp>('/api/admin/organizations')
      setOrgs(res.organizations || [])
      setOverview(res.overview || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orgs
    return orgs.filter(
      (o) => (o.name || '').toLowerCase().includes(q) || (o.slug || '').toLowerCase().includes(q),
    )
  }, [orgs, search])

  // Действие над подпиской/статусом организации (реальные actions PATCH /api/admin/organizations).
  const runAction = useCallback(
    async (org: Org, body: Record<string, unknown>, key: string) => {
      setBusy(key)
      try {
        await apiFetch('/api/admin/organizations', {
          method: 'PATCH',
          body: JSON.stringify({ organizationId: org.id, ...body }),
        })
        haptic.success()
        setPicked(null)
        await load()
      } catch (e: any) {
        haptic.error()
        Alert.alert('Не удалось', e?.message || 'Ошибка сервера')
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  const confirmDestructive = useCallback(
    (title: string, message: string, onYes: () => void) => {
      haptic.warning()
      Alert.alert(title, message, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Подтвердить', style: 'destructive', onPress: onYes },
      ])
    },
    [],
  )

  const ov = overview
  const mrr = ov ? Number(ov.liveMrr || 0) : 0

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Организации</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && orgs.length > 0} onRefresh={() => load()} tintColor={T.green} />}
      >
        <GlowHero glow={T.violet}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ОРГАНИЗАЦИЙ НА ПЛАТФОРМЕ</Text>
          <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>
            {ov ? ov.organizationCount : orgs.length}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            {ov ? <Pill text={`активных ${ov.activeOrganizationCount}`} tone="good" /> : null}
            {ov && ov.trialingSubscriptions > 0 ? <Pill text={`пробных ${ov.trialingSubscriptions}`} tone="brand" /> : null}
            {ov && ov.pastDueSubscriptions > 0 ? <Pill text={`просрочено ${ov.pastDueSubscriptions}`} tone="bad" /> : null}
          </View>
          {mrr > 0 ? (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>MRR (активные): {moneyShort(mrr)}</Text>
          ) : null}
        </GlowHero>

        {error ? <ErrorState message={error} onRetry={() => load()} /> : null}

        {ov ? (
          <Card style={{ gap: 0 }}>
            <SectionTitle hint="по всем тенантам">Сводка платформы</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[
                { label: 'Точек', value: String(ov.totalCompanies || 0), color: T.text },
                { label: 'Людей', value: String(ov.totalMembers || 0), color: T.text },
                { label: 'Активных подписок', value: String(ov.activeSubscriptions || 0), color: T.greenBright },
                { label: 'Пробных', value: String(ov.trialingSubscriptions || 0), color: T.violet },
                { label: 'Оплачено за месяц', value: moneyShort(ov.paidThisMonth || 0), color: T.greenBright },
                { label: 'Просрочено счетов', value: String(ov.overdueInvoices || 0), color: ov.overdueInvoices > 0 ? T.red : T.text },
              ].map((m) => (
                <View key={m.label} style={{ width: '50%', paddingVertical: 8 }}>
                  <Text style={{ color: m.color, fontSize: 19, fontWeight: '900' }}>{m.value}</Text>
                  <Text style={{ color: T.textDim, fontSize: 11.5, marginTop: 2 }}>{m.label}</Text>
                </View>
              ))}
            </View>
            {ov.trialsEndingSoon > 0 || ov.overdueInvoicesSum > 0 ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                {ov.trialsEndingSoon > 0 ? <Pill text={`триал истекает: ${ov.trialsEndingSoon}`} tone="warn" /> : null}
                {ov.overdueInvoicesSum > 0 ? <Pill text={`долг по счетам ${moneyShort(ov.overdueInvoicesSum)}`} tone="bad" /> : null}
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* Поиск */}
        {orgs.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: T.card,
              borderWidth: 1,
              borderColor: T.border,
              borderRadius: R.md,
              paddingHorizontal: 12,
            }}
          >
            <Ionicons name="search" size={16} color={T.textDim} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск по названию или slug"
              placeholderTextColor={T.textDim}
              style={{ flex: 1, color: T.text, fontSize: 14, paddingVertical: 11 }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={T.textDim} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {loading && orgs.length === 0 ? (
          <SkeletonList rows={6} />
        ) : !loading && filtered.length === 0 ? (
          <EmptyState icon="business-outline" title={search ? 'Ничего не найдено' : 'Нет организаций'} />
        ) : (
          <Card style={{ padding: 0 }}>
            {filtered.map((org, i) => {
              const st = STATUS[statusOf(org)] || { text: statusOf(org) || '—', tone: 'mut' as const }
              const planName = org.subscription?.plan?.name || null
              return (
                <Pressable
                  key={org.id}
                  onPress={() => { haptic.tap(); setPicked(org) }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    gap: 12,
                    padding: 14,
                    borderBottomWidth: i < filtered.length - 1 ? 1 : 0,
                    borderBottomColor: T.borderSoft,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: T.violet + '22',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: T.violet, fontSize: 14, fontWeight: '900' }}>{initials(org.name)}</Text>
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                        {org.name || 'Без названия'}
                      </Text>
                      <Pill text={st.text} tone={st.tone} />
                    </View>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {org.primaryDomain || `${org.slug}.ordaops.kz`}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: T.textMut, fontSize: 11 }}>Точек: {org.companyCount ?? 0}</Text>
                      <Text style={{ color: T.textMut, fontSize: 11 }}>Людей: {org.memberCount ?? 0}</Text>
                      {planName ? <Text style={{ color: T.cyan, fontSize: 11 }}>{planName}</Text> : null}
                    </View>
                  </View>

                  <View style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 4 }}>
                    <Text style={{ color: T.textDim, fontSize: 11 }}>{fmtDate(org.createdAt)}</Text>
                    <Ionicons name="ellipsis-horizontal-circle-outline" size={18} color={T.textDim} />
                  </View>
                </Pressable>
              )
            })}
          </Card>
        )}

        {!loading && orgs.length > 0 ? (
          <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
            Показано {filtered.length} из {orgs.length}
          </Text>
        ) : null}
      </ScrollView>

      {/* Действия над организацией (суперадмин) */}
      <Modal visible={!!picked} transparent animationType="slide" onRequestClose={() => setPicked(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}
          onPress={() => (busy ? null : setPicked(null))}
        >
          <Pressable
            style={{
              backgroundColor: T.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: T.border,
              paddingHorizontal: S.lg,
              paddingTop: S.md,
              paddingBottom: S.xxl,
              gap: S.sm,
            }}
            onPress={() => {}}
          >
            <View style={{ alignItems: 'center', marginBottom: 4 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: T.border }} />
            </View>

            {picked ? (
              <>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: '900' }} numberOfLines={1}>
                  {picked.name || 'Без названия'}
                </Text>
                <Text style={{ color: T.textDim, fontSize: 12, marginBottom: 4 }}>
                  Подписка: {(STATUS[picked.subscription?.status || ''] || { text: picked.subscription?.status || '—' }).text}
                  {'   '}Статус орг.: {(STATUS[picked.status] || { text: picked.status || '—' }).text}
                </Text>

                {(() => {
                  const subSt = picked.subscription?.status || ''
                  const hasSub = !!picked.subscription
                  const orgSuspended = picked.status === 'suspended'
                  const org = picked

                  const Btn = ({
                    label,
                    icon,
                    color,
                    actKey,
                    onPress,
                  }: {
                    label: string
                    icon: keyof typeof Ionicons.glyphMap
                    color: string
                    actKey: string
                    onPress: () => void
                  }) => (
                    <Pressable
                      onPress={onPress}
                      disabled={!!busy}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        backgroundColor: T.card,
                        borderWidth: 1,
                        borderColor: T.border,
                        borderRadius: R.md,
                        paddingVertical: 14,
                        paddingHorizontal: 14,
                        opacity: busy && busy !== actKey ? 0.5 : 1,
                      }}
                    >
                      <Ionicons name={icon} size={18} color={color} />
                      <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', flex: 1 }}>{label}</Text>
                      {busy === actKey ? <ActivityIndicator color={color} /> : null}
                    </Pressable>
                  )

                  return (
                    <View style={{ gap: S.sm }}>
                      {!hasSub ? (
                        <Card style={{ borderColor: T.border }}>
                          <Text style={{ color: T.textMut, fontSize: 13 }}>
                            У организации нет подписки — действия над подпиской недоступны.
                          </Text>
                        </Card>
                      ) : null}

                      {hasSub && subSt !== 'active' ? (
                        <Btn
                          label="Активировать подписку"
                          icon="play-circle-outline"
                          color={T.greenBright}
                          actKey="activate"
                          onPress={() => runAction(org, { subscriptionAction: 'activate' }, 'activate')}
                        />
                      ) : null}

                      {hasSub ? (
                        <Btn
                          label="Пробный период (14 дней)"
                          icon="hourglass-outline"
                          color={T.violet}
                          actKey="startTrial"
                          onPress={() => runAction(org, { subscriptionAction: 'startTrial', trialDays: 14 }, 'startTrial')}
                        />
                      ) : null}

                      {hasSub ? (
                        <Btn
                          label="Продлить цикл (+30 дней)"
                          icon="refresh-outline"
                          color={T.cyan}
                          actKey="renewCycle"
                          onPress={() => runAction(org, { subscriptionAction: 'renewCycle' }, 'renewCycle')}
                        />
                      ) : null}

                      {hasSub ? (
                        <Btn
                          label="Отметить оплату"
                          icon="cash-outline"
                          color={T.greenBright}
                          actKey="recordPayment"
                          onPress={() => runAction(org, { subscriptionAction: 'recordPayment' }, 'recordPayment')}
                        />
                      ) : null}

                      {hasSub && subSt !== 'past_due' ? (
                        <Btn
                          label="Пометить просроченной"
                          icon="alert-circle-outline"
                          color={T.red}
                          actKey="markPastDue"
                          onPress={() =>
                            confirmDestructive(
                              'Просрочить подписку?',
                              `Подписка «${org.name}» будет помечена как просроченная.`,
                              () => runAction(org, { subscriptionAction: 'markPastDue' }, 'markPastDue'),
                            )
                          }
                        />
                      ) : null}

                      {hasSub && subSt !== 'canceled' ? (
                        <Btn
                          label="Отменить подписку"
                          icon="close-circle-outline"
                          color={T.red}
                          actKey="cancelNow"
                          onPress={() =>
                            confirmDestructive(
                              'Отменить подписку?',
                              `Подписка «${org.name}» будет немедленно отменена.`,
                              () => runAction(org, { subscriptionAction: 'cancelNow' }, 'cancelNow'),
                            )
                          }
                        />
                      ) : null}

                      {/* Статус самой организации */}
                      {orgSuspended ? (
                        <Btn
                          label="Разморозить организацию"
                          icon="lock-open-outline"
                          color={T.greenBright}
                          actKey="orgActive"
                          onPress={() => runAction(org, { organizationStatus: 'active' }, 'orgActive')}
                        />
                      ) : (
                        <Btn
                          label="Заморозить организацию"
                          icon="snow-outline"
                          color={T.red}
                          actKey="orgSuspend"
                          onPress={() =>
                            confirmDestructive(
                              'Заморозить организацию?',
                              `Доступ организации «${org.name}» будет приостановлен.`,
                              () => runAction(org, { organizationStatus: 'suspended' }, 'orgSuspend'),
                            )
                          }
                        />
                      )}

                      <Pressable
                        onPress={() => (busy ? null : setPicked(null))}
                        disabled={!!busy}
                        style={{ paddingVertical: 14, alignItems: 'center', marginTop: 2 }}
                      >
                        <Text style={{ color: T.textMut, fontSize: 15, fontWeight: '700' }}>Закрыть</Text>
                      </Pressable>
                    </View>
                  )
                })()}
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}
