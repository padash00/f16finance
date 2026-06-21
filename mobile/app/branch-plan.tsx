import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, BarRow, ErrorState, EmptyState } from '@/components/ui'

// ── Типы payload (зеркало веб-страницы /branch-plan) ───────────────────────
type PcComponent = { id: string; name: string; price: number }
type PcConfig = { id: string; name: string; quantity: number; components: PcComponent[] }
type CapexRow = { id: string; name: string; unit_price: number; quantity: number }
type Tariff = { id: string; name: string; paid_hours: number; bonus_hours: number; price: number }
type ZoneMix = { tariff_id: string; share_pct: number }
type Zone = { id: string; name: string; device_count: number; occupancy_hours: number; tariff_mix: ZoneMix[] }
type OpexRow = { id: string; name: string; amount: number; kind: 'fixed' | 'percent_of_revenue' }
type ScenarioCfg = { revenue_mult: number; opex_mult: number }
type RampUp = { enabled: boolean; months: number[] }

type Payload = {
  pc_configs?: PcConfig[]
  capex?: CapexRow[]
  tariffs?: Tariff[]
  zones?: Zone[]
  opex?: OpexRow[]
  scenarios?: { best: ScenarioCfg; expected: ScenarioCfg; worst: ScenarioCfg }
  ramp_up?: RampUp
}

type DraftListItem = { id: string; name: string; payload?: Payload; updated_at?: string | null }
type DraftFull = { id: string; name: string; payload?: Payload; updated_at?: string | null }

const num = (v: unknown) => {
  const x = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(x) && x >= 0 ? x : 0
}

function tariffRate(t: Tariff): number {
  const hours = num(t.paid_hours) + num(t.bonus_hours)
  return hours > 0 ? num(t.price) / hours : 0
}

function pcUnitPrice(c: PcConfig): number {
  return (c?.components || []).reduce((s, x) => s + num(x.price), 0)
}

// ── Расчёт модели (точная копия web calc) ──────────────────────────────────
function computeModel(p: Payload) {
  const pcConfigs = p?.pc_configs || []
  const capex = p?.capex || []
  const tariffs = p?.tariffs || []
  const zones = p?.zones || []
  const opex = p?.opex || []
  const scenarios = p?.scenarios || {
    best: { revenue_mult: 1.3, opex_mult: 1 },
    expected: { revenue_mult: 1, opex_mult: 1 },
    worst: { revenue_mult: 0.7, opex_mult: 1.15 },
  }
  const ramp: RampUp = p?.ramp_up || { enabled: false, months: [1] }

  const tariffById = new Map<string, Tariff>()
  for (const t of tariffs) tariffById.set(t.id, t)

  const pcCapex = pcConfigs.reduce((s, c) => s + num(c.quantity) * pcUnitPrice(c), 0)
  const otherCapex = capex.reduce((s, r) => s + num(r.unit_price) * num(r.quantity), 0)
  const totalCapex = pcCapex + otherCapex

  let baseRevenue = 0
  const zoneBreakdown = zones.map((z) => {
    let blendedRate = 0
    for (const m of z.tariff_mix || []) {
      const t = tariffById.get(m.tariff_id)
      if (!t) continue
      blendedRate += (num(m.share_pct) / 100) * tariffRate(t)
    }
    const perMonth = num(z.device_count) * num(z.occupancy_hours) * blendedRate * 30
    baseRevenue += perMonth
    return { zone: z, perMonth }
  })

  const computeOpex = (revenue: number, opexMult = 1) => {
    let fixed = 0
    let percent = 0
    for (const o of opex) {
      if (o.kind === 'fixed') fixed += num(o.amount) * opexMult
      else percent += (num(o.amount) / 100) * revenue
    }
    return { fixed, percent, total: fixed + percent }
  }

  const expectedRev = baseRevenue * num(scenarios.expected?.revenue_mult)
  const expectedOpex = computeOpex(expectedRev, num(scenarios.expected?.opex_mult))
  const baseScenario = {
    revenue: expectedRev,
    opexFixed: expectedOpex.fixed,
    opexPercent: expectedOpex.percent,
    opex: expectedOpex.total,
    profit: expectedRev - expectedOpex.total,
  }
  const paybackMonths = baseScenario.profit > 0 ? totalCapex / baseScenario.profit : null

  const buildScenario = (cfg: ScenarioCfg) => {
    const rev = baseRevenue * num(cfg?.revenue_mult)
    const op = computeOpex(rev, num(cfg?.opex_mult))
    const profit = rev - op.total
    return { revenue: rev, opex: op.total, profit, payback: profit > 0 ? totalCapex / profit : null }
  }
  const scenarioBest = buildScenario(scenarios.best)
  const scenarioExpected = buildScenario(scenarios.expected)
  const scenarioWorst = buildScenario(scenarios.worst)

  // Точка безубыточности (ч/устройство в сутки)
  const totalDevices = zones.reduce((s, z) => s + num(z.device_count), 0)
  const weightedRate = totalDevices > 0
    ? zoneBreakdown.reduce((s, z) => {
        const rate = num(z.zone.device_count) > 0 && num(z.zone.occupancy_hours) > 0
          ? z.perMonth / (num(z.zone.device_count) * num(z.zone.occupancy_hours) * 30)
          : 0
        return s + num(z.zone.device_count) * rate
      }, 0) / totalDevices
    : 0
  const percentShare = opex
    .filter((o) => o.kind === 'percent_of_revenue')
    .reduce((s, o) => s + num(o.amount) / 100, 0)
  const denom = totalDevices * 30 * weightedRate * (1 - percentShare)
  const breakEvenHours = denom > 0 ? baseScenario.opexFixed / denom : null

  return {
    pcCapex,
    otherCapex,
    totalCapex,
    baseRevenue,
    baseScenario,
    paybackMonths,
    scenarioBest,
    scenarioExpected,
    scenarioWorst,
    zoneBreakdown,
    breakEvenHours,
    totalDevices,
    pcConfigs,
    capex,
    opex,
    rampEnabled: !!ramp.enabled,
  }
}

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function BranchPlanScreen() {
  const router = useRouter()
  const [drafts, setDrafts] = useState<DraftListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDraft = useCallback(async (id: string) => {
    setLoadingDraft(true)
    setError(null)
    try {
      const res = await apiFetch<{ data: { draft: DraftFull } }>(`/api/admin/branch-plan?id=${encodeURIComponent(id)}`)
      setDraft(res?.data?.draft || null)
      setSelectedId(id)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить модель')
    } finally {
      setLoadingDraft(false)
    }
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ data: { drafts: DraftListItem[] } }>('/api/admin/branch-plan')
      const list = res?.data?.drafts || []
      setDrafts(list)
      if (list.length > 0 && list[0]?.id) {
        await loadDraft(list[0].id)
      } else {
        setDraft(null)
        setSelectedId(null)
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [loadDraft])

  useEffect(() => { void loadList() }, [loadList])

  const calc = useMemo(() => (draft?.payload ? computeModel(draft.payload) : null), [draft])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Финмодель точки</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && drafts.length > 0} onRefresh={loadList} tintColor={T.green} />}
      >
        {loading && drafts.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => loadList()} />
        ) : drafts.length === 0 ? (
          <EmptyState icon="calculator-outline" title="Сохранённых моделей нет" hint="Создайте финмодель в веб-портале" />
        ) : (
          <>
            {/* Выбор модели */}
            {drafts.length > 1 ? (
              <Card style={{ padding: 0, gap: 0 }}>
                {drafts.map((dft, i) => {
                  const active = dft.id === selectedId
                  return (
                    <Pressable
                      key={dft.id}
                      onPress={() => loadDraft(dft.id)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        padding: 14, borderBottomWidth: i < drafts.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: active ? T.greenBright : T.text, fontSize: 14, fontWeight: active ? '900' : '700' }} numberOfLines={1}>{dft.name || 'Без названия'}</Text>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }}>обновлено {fmtDate(dft.updated_at)}</Text>
                      </View>
                      {active ? <Ionicons name="checkmark-circle" size={20} color={T.green} /> : <Ionicons name="chevron-forward" size={18} color={T.textDim} />}
                    </Pressable>
                  )
                })}
              </Card>
            ) : null}

            {loadingDraft && !calc ? (
              <ActivityIndicator color={T.green} style={{ marginTop: 30 }} />
            ) : calc ? (
              <>
                {/* Герой: ключевые цифры (Expected) */}
                <GlowHero glow={T.violet}>
                  <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }} numberOfLines={1}>
                    {(draft?.name || 'Финмодель').toUpperCase()}
                  </Text>
                  <Text style={{ color: T.textDim, fontSize: 11, marginTop: 4 }}>СТАРТОВЫЕ ВЛОЖЕНИЯ (CAPEX)</Text>
                  <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 4, letterSpacing: -0.5 }}>{money(calc.totalCapex)}</Text>
                  <Text style={{ color: T.textDim, fontSize: 12, marginTop: 4 }}>
                    ПК: {moneyShort(calc.pcCapex)} · прочее: {moneyShort(calc.otherCapex)}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                    {calc.paybackMonths != null
                      ? <Pill text={`окупаемость ${calc.paybackMonths.toFixed(1)} мес`} tone="good" />
                      : <Pill text="окупаемость не наступит" tone="bad" />}
                    <Pill text={`${calc.totalDevices} устройств`} tone="brand" />
                  </View>
                </GlowHero>

                {/* Юнит-экономика (Expected) */}
                <Card style={{ gap: 0, padding: 0 }}>
                  {[
                    { label: 'Выручка / мес', value: money(calc.baseScenario.revenue), color: T.greenBright },
                    { label: 'Расходы / мес', value: money(calc.baseScenario.opex), color: T.red },
                    { label: 'Прибыль / мес', value: money(calc.baseScenario.profit), color: calc.baseScenario.profit > 0 ? T.amber : T.red },
                  ].map((row, i) => (
                    <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: i < 2 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <Text style={{ color: T.textMut, fontSize: 14 }}>{row.label}</Text>
                      <Text style={{ color: row.color, fontSize: 16, fontWeight: '900' }}>{row.value}</Text>
                    </View>
                  ))}
                </Card>

                <Text style={{ color: T.textDim, fontSize: 11, paddingHorizontal: 4 }}>
                  Расходы: фикс {moneyShort(calc.baseScenario.opexFixed)} · % от выручки {moneyShort(calc.baseScenario.opexPercent)}
                </Text>

                {calc.breakEvenHours != null ? (
                  <Card style={{ borderColor: 'rgba(139,92,246,0.32)' }}>
                    <Text style={{ color: T.textMut, fontSize: 13 }}>Точка безубыточности</Text>
                    <Text style={{ color: T.violet, fontSize: 20, fontWeight: '900', marginTop: 4 }}>{calc.breakEvenHours.toFixed(1)} ч/устройство в сутки</Text>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 4 }}>чтобы выйти в ноль при текущих тарифах и OPEX</Text>
                  </Card>
                ) : null}

                {/* Сценарии */}
                <SectionTitle hint="множители к базе">Сценарии</SectionTitle>
                <Card style={{ gap: S.md }}>
                  {([
                    { key: 'best', label: 'Best', tone: 'good' as const, color: T.greenBright, s: calc.scenarioBest },
                    { key: 'expected', label: 'Expected', tone: 'warn' as const, color: T.amber, s: calc.scenarioExpected },
                    { key: 'worst', label: 'Worst', tone: 'bad' as const, color: T.red, s: calc.scenarioWorst },
                  ]).map((row, i) => (
                    <View key={row.key} style={{ gap: 6, paddingBottom: i < 2 ? S.md : 0, borderBottomWidth: i < 2 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Pill text={row.label} tone={row.tone} />
                        <Text style={{ color: row.color, fontSize: 16, fontWeight: '900' }}>{money(row.s.profit)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: T.textDim, fontSize: 12 }}>выручка {moneyShort(row.s.revenue)} · расходы {moneyShort(row.s.opex)}</Text>
                        <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700' }}>{row.s.payback != null ? `${row.s.payback.toFixed(1)} мес` : '—'}</Text>
                      </View>
                    </View>
                  ))}
                </Card>

                {/* Зоны: вклад в выручку */}
                {calc.zoneBreakdown.length > 0 ? (
                  <>
                    <SectionTitle hint={moneyShort(calc.baseRevenue)}>Зоны (выручка/мес)</SectionTitle>
                    <Card style={{ gap: S.md }}>
                      {calc.zoneBreakdown.map((z) => (
                        <BarRow
                          key={z.zone.id}
                          label={`${z.zone.name || 'Зона'} · ${num(z.zone.device_count)} ПК · ${num(z.zone.occupancy_hours)} ч/сут`}
                          value={z.perMonth}
                          max={Math.max(...calc.zoneBreakdown.map((x) => x.perMonth), 1)}
                          color={T.teal}
                          valueLabel={moneyShort(z.perMonth)}
                        />
                      ))}
                    </Card>
                  </>
                ) : null}

                {/* Расходы (OPEX) */}
                {calc.opex.length > 0 ? (
                  <>
                    <SectionTitle>Расходы (OPEX)</SectionTitle>
                    <Card style={{ padding: 0 }}>
                      {calc.opex.map((o, i) => (
                        <View key={o.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 13, borderBottomWidth: i < calc.opex.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                          <Text style={{ color: T.text, fontSize: 13.5, flex: 1 }} numberOfLines={1}>{o.name || 'Расход'}</Text>
                          <Text style={{ color: T.textMut, fontSize: 13.5, fontWeight: '800' }}>
                            {o.kind === 'percent_of_revenue' ? `${num(o.amount)}% от выручки` : money(num(o.amount))}
                          </Text>
                        </View>
                      ))}
                    </Card>
                  </>
                ) : null}

                {/* Конфигурации ПК */}
                {calc.pcConfigs.length > 0 ? (
                  <>
                    <SectionTitle hint={moneyShort(calc.pcCapex)}>Конфигурации ПК</SectionTitle>
                    <Card style={{ padding: 0 }}>
                      {calc.pcConfigs.map((c, i) => {
                        const unit = pcUnitPrice(c)
                        const total = unit * num(c.quantity)
                        return (
                          <View key={c.id} style={{ padding: 14, borderBottomWidth: i < calc.pcConfigs.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                              <Text style={{ color: T.text, fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>{c.name || 'ПК'}</Text>
                              <Text style={{ color: T.violet, fontSize: 14.5, fontWeight: '900' }}>{moneyShort(total)}</Text>
                            </View>
                            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }}>
                              {num(c.quantity)} шт × {money(unit)}
                            </Text>
                          </View>
                        )
                      })}
                    </Card>
                  </>
                ) : null}

                {/* Прочий CAPEX */}
                {calc.capex.length > 0 ? (
                  <>
                    <SectionTitle hint={moneyShort(calc.otherCapex)}>Прочие вложения</SectionTitle>
                    <Card style={{ padding: 0 }}>
                      {calc.capex.map((r, i) => (
                        <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 13, borderBottomWidth: i < calc.capex.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: T.text, fontSize: 13.5 }} numberOfLines={1}>{r.name || 'Позиция'}</Text>
                            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 1 }}>{num(r.quantity)} × {money(num(r.unit_price))}</Text>
                          </View>
                          <Text style={{ color: T.textMut, fontSize: 13.5, fontWeight: '800' }}>{moneyShort(num(r.unit_price) * num(r.quantity))}</Text>
                        </View>
                      ))}
                    </Card>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
