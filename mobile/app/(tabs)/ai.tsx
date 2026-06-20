import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, money } from '@/lib/theme'
import { Card, SectionTitle } from '@/components/ui'

type Summary = { where_losing?: string; where_earn?: string; main_risk?: string; main_opportunity?: string; extra_profit?: string; three_actions?: string[] }
type Cfo = { ok: boolean; revenue?: number; expense?: number; profit?: number; ai?: { summary?: Summary } }

const PERIODS = [{ d: 7, l: '7 дней' }, { d: 30, l: '30 дней' }, { d: 90, l: '90 дней' }]

export default function AiScreen() {
  const [days, setDays] = useState(30)
  const [res, setRes] = useState<Cfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (d: number) => {
    setDays(d); setError(null); setLoading(true); setRes(null)
    try {
      const r = await apiFetch<Cfo>('/api/ai/cfo', { method: 'POST', body: JSON.stringify({ days: d }) })
      setRes(r)
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  const s = res?.ai?.summary

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="sparkles" size={22} color={T.green} />
          <Text style={{ color: T.text, fontSize: 24, fontWeight: '800' }}>AI Финдиректор</Text>
        </View>
        <Text style={{ color: T.textMut, fontSize: 13 }}>Аудит финансов: где теряешь, где заработать, что сделать.</Text>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {PERIODS.map((p) => (
            <Pressable key={p.d} onPress={() => run(p.d)} disabled={loading} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: days === p.d ? T.green : T.card, borderWidth: 1, borderColor: days === p.d ? T.green : T.border }}>
              <Text style={{ color: days === p.d ? '#04130d' : T.textMut, fontWeight: '700', fontSize: 13 }}>{p.l}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <Card style={{ alignItems: 'center', paddingVertical: 36, gap: 12 }}>
            <ActivityIndicator color={T.green} />
            <Text style={{ color: T.textMut }}>AI считает и анализирует… (15–30 сек)</Text>
          </Card>
        ) : error ? (
          <Card><Text style={{ color: T.red, fontWeight: '700' }}>Не удалось</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : res ? (
          <>
            {(res.revenue != null || res.profit != null) ? (
              <Card style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Stat label="Доход" v={res.revenue} />
                <Stat label="Расход" v={res.expense} />
                <Stat label="Прибыль" v={res.profit} tone={(res.profit || 0) >= 0 ? T.green : T.red} />
              </Card>
            ) : null}

            {s ? (
              <>
                <Insight icon="trending-down" color={T.red} title="Где теряем" text={s.where_losing} />
                <Insight icon="trending-up" color={T.green} title="Где заработать" text={s.where_earn} />
                <Insight icon="warning" color={T.amber} title="Главный риск" text={s.main_risk} />
                <Insight icon="bulb" color={T.blue} title="Возможность" text={s.main_opportunity ? `${s.main_opportunity}${s.extra_profit ? ` (+${s.extra_profit})` : ''}` : undefined} />
                {s.three_actions?.length ? (
                  <>
                    <SectionTitle>3 действия</SectionTitle>
                    <Card style={{ gap: 12 }}>
                      {s.three_actions.map((a, i) => (
                        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                          <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: '#10261f', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: T.green, fontWeight: '800', fontSize: 12 }}>{i + 1}</Text></View>
                          <Text style={{ color: T.text, fontSize: 14, flex: 1, lineHeight: 20 }}>{a}</Text>
                        </View>
                      ))}
                    </Card>
                  </>
                ) : null}
              </>
            ) : (
              <Card><Text style={{ color: T.textMut }}>AI вернул данные, но без текстового разбора.</Text></Card>
            )}
          </>
        ) : (
          <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Ionicons name="sparkles" size={32} color={T.textDim} />
            <Text style={{ color: T.textMut, marginTop: 10 }}>Выбери период — AI сделает разбор.</Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Stat({ label, v, tone = T.text }: { label: string; v?: number; tone?: string }) {
  return (
    <View>
      <Text style={{ color: T.textDim, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: tone, fontSize: 15, fontWeight: '800', marginTop: 3 }}>{money(v)}</Text>
    </View>
  )
}

function Insight({ icon, color, title, text }: { icon: any; color: string; title: string; text?: string }) {
  if (!text) return null
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={icon} size={16} color={color} />
        <Text style={{ color: T.text, fontSize: 14, fontWeight: '800' }}>{title}</Text>
      </View>
      <Text style={{ color: T.textMut, fontSize: 13, lineHeight: 19 }}>{text}</Text>
    </Card>
  )
}
