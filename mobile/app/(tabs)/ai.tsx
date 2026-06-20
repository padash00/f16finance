import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { canSee } from '@/lib/access'
import { T, R, S, money } from '@/lib/theme'
import { Card, SectionTitle, Segmented, GlowHero, Pill } from '@/components/ui'
import { NoAccess } from '@/components/no-access'

type Summary = { where_losing?: string; where_earn?: string; main_risk?: string; main_opportunity?: string; extra_profit?: string; three_actions?: string[] }
type Cfo = { ok: boolean; revenue?: number; expense?: number; profit?: number; ai?: { summary?: Summary } }

const PERIODS = [{ d: 7, l: '7 дней' }, { d: 30, l: '30 дней' }, { d: 90, l: '90 дней' }]

export default function AiScreen() {
  const { role } = useAuth()
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

  if (role && !canSee(role, { path: '/ai-cfo' })) return <NoAccess title="AI Финдиректор" />

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(139,92,246,0.16)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="sparkles" size={19} color={T.violet} />
          </View>
          <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>AI Финдиректор</Text>
        </View>
        <Text style={{ color: T.textMut, fontSize: 13 }}>Аудит финансов: где теряешь, где заработать, что сделать.</Text>

        <Segmented value={String(days)} options={PERIODS.map((p) => ({ key: String(p.d), label: p.l }))} onChange={(k) => run(Number(k))} />

        {loading ? (
          <Card style={{ alignItems: 'center', paddingVertical: 36, gap: 12 }}>
            <ActivityIndicator color={T.violet} />
            <Text style={{ color: T.textMut }}>AI считает и анализирует… (15–30 сек)</Text>
          </Card>
        ) : error ? (
          <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>Не удалось</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : res ? (
          <>
            {(res.revenue != null || res.profit != null) ? (
              <GlowHero glow={(res.profit || 0) >= 0 ? T.green : T.red}>
                <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ПРИБЫЛЬ ЗА {days} ДН.</Text>
                <Text style={{ color: (res.profit || 0) >= 0 ? T.text : T.red, fontSize: 36, fontWeight: '900', marginTop: 8, letterSpacing: -0.5 }}>{money(res.profit)}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: S.lg }}>
                  <Stat label="Доход" v={res.revenue} tone={T.greenBright} />
                  <Stat label="Расход" v={res.expense} tone={T.amber} />
                </View>
              </GlowHero>
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
    <View style={{ flex: 1 }}>
      <Text style={{ color: T.textDim, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: tone, fontSize: 15, fontWeight: '900', marginTop: 3 }}>{money(v)}</Text>
    </View>
  )
}

function Insight({ icon, color, title, text }: { icon: any; color: string; title: string; text?: string }) {
  if (!text) return null
  return (
    <Card style={{ gap: 8, borderLeftWidth: 3, borderLeftColor: color }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={15} color={color} />
        </View>
        <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '800' }}>{title}</Text>
      </View>
      <Text style={{ color: T.textMut, fontSize: 13.5, lineHeight: 20 }}>{text}</Text>
    </Card>
  )
}
