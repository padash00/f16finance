import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { apiFetch } from '@/lib/api'
import { T, R, S, money } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero } from '@/components/ui'

type Overview = {
  week: { grossAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; paidAmount: number; remainingAmount: number; status: string }
  recentDebts: { id: string; amount: number; comment: string | null; companyName: string | null }[]
}

const STATUS: Record<string, { text: string; tone: 'good' | 'warn' | 'mut' }> = {
  paid: { text: 'Выплачено', tone: 'good' },
  partial: { text: 'Частично', tone: 'warn' },
  draft: { text: 'Не выплачено', tone: 'mut' },
}

export default function OperatorSalary() {
  const [d, setD] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setD(await apiFetch<{ ok: boolean } & Overview>('/api/operator/overview')) }
    catch (e: any) { setError(e?.message || 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const st = d ? STATUS[d.week.status] || STATUS.draft : STATUS.draft

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} tintColor={T.green} />}>
        <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>Зарплата</Text>

        {loading && !d ? <ActivityIndicator color={T.green} style={{ marginTop: 50 }} /> : error ? (
          <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>Не удалось загрузить</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : d ? (
          <>
            <GlowHero glow={st.tone === 'good' ? T.green : T.amber}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>К ВЫПЛАТЕ ЗА НЕДЕЛЮ</Text>
                <Pill text={st.text} tone={st.tone} />
              </View>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 8, letterSpacing: -0.5 }}>{money(d.week.netAmount)}</Text>
              {d.week.remainingAmount > 0 ? <Text style={{ color: T.amber, fontSize: 13, marginTop: 8, fontWeight: '800' }}>Остаток к выплате: {money(d.week.remainingAmount)}</Text> : null}
            </GlowHero>

            <SectionTitle>Из чего складывается</SectionTitle>
            <Card style={{ gap: 2, paddingVertical: 4 }}>
              <Row label="Начислено" value={money(d.week.grossAmount)} />
              <Row label="Бонус" value={`+ ${money(d.week.bonusAmount)}`} color={T.green} hide={!d.week.bonusAmount} />
              <Row label="Штраф" value={`− ${money(d.week.fineAmount)}`} color={T.red} hide={!d.week.fineAmount} />
              <Row label="Аванс" value={`− ${money(d.week.advanceAmount)}`} color={T.blue} hide={!d.week.advanceAmount} />
              <Row label="Удержание (долги)" value={`− ${money(d.week.debtAmount)}`} color={T.amber} hide={!d.week.debtAmount} />
              <Row label="Итого к выплате" value={money(d.week.netAmount)} bold />
              <Row label="Уже выплачено" value={money(d.week.paidAmount)} color={T.green} />
            </Card>

            {d.recentDebts.length > 0 ? (
              <>
                <SectionTitle>Мои долги</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 4 }}>
                  {d.recentDebts.map((db, i, arr) => (
                    <View key={db.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <Text style={{ color: T.text, fontSize: 14, flex: 1 }} numberOfLines={1}>{db.comment || db.companyName || 'Долг'}</Text>
                      <Text style={{ color: T.amber, fontSize: 14, fontWeight: '800' }}>{money(db.amount)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Row({ label, value, color = T.text, bold, hide }: { label: string; value: string; color?: string; bold?: boolean; hide?: boolean }) {
  if (hide) return null
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderTopWidth: bold ? 1 : 0, borderTopColor: T.borderSoft }}>
      <Text style={{ color: bold ? T.text : T.textMut, fontSize: 14, fontWeight: bold ? '800' : '500' }}>{label}</Text>
      <Text style={{ color, fontSize: 14.5, fontWeight: bold ? '900' : '700' }}>{value}</Text>
    </View>
  )
}
