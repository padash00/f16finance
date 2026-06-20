import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, S, money, moneyShort } from '@/lib/theme'
import { Card, Pill, GlowHero, Segmented, BarRow } from '@/components/ui'

type Company = { id: string; name: string; code?: string | null }
type Tariff = { id: string; name: string; paid_hours: number; bonus_hours: number; price: number }
type ZoneMix = { tariff_id: string; share_pct: number }
type Zone = {
  id: string
  name: string
  device_type?: string | null
  device_count: number
  assumed_occupancy_hours: number
  tariff_mix: ZoneMix[]
}
type Fact = {
  window_days: number
  total_revenue: number
  revenue_per_day: number
  revenue_per_month: number
}
type SimData = {
  companies: Company[]
  company_id: string | null
  zones: any[]
  tariffs: any[]
  fact: Fact | null
}

const DEVICE_LABEL: Record<string, string> = {
  pc: 'ПК',
  ps: 'PlayStation',
  sim_racing: 'Sim Racing',
  vr: 'VR',
  other: 'Другое',
}

const num = (v: unknown) => {
  const x = Number(String(v ?? 0).replace(',', '.'))
  return Number.isFinite(x) && x >= 0 ? x : 0
}

/** ₸ за час сидения по тарифу: цена / (оплаченные + бонусные часы) */
function tariffRate(t: Tariff): number {
  const hours = num(t.paid_hours) + num(t.bonus_hours)
  return hours > 0 ? num(t.price) / hours : 0
}

export default function SimulationScreen() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<string>('')
  const [zones, setZones] = useState<Zone[]>([])
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [fact, setFact] = useState<Fact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (cid?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = cid ? `/api/admin/simulation?company_id=${encodeURIComponent(cid)}` : '/api/admin/simulation'
      const res = await apiFetch<{ data: SimData }>(url)
      const d = res.data || ({} as SimData)
      setCompanies(d.companies || [])
      setCompanyId(d.company_id || '')
      setTariffs(
        (d.tariffs || []).map((t: any) => ({
          id: String(t.id),
          name: t.name || '',
          paid_hours: Number(t.paid_hours || 0),
          bonus_hours: Number(t.bonus_hours || 0),
          price: Number(t.price || 0),
        })),
      )
      setZones(
        (d.zones || []).map((z: any) => ({
          id: String(z.id || `${z.name}-${Math.random()}`),
          name: z.name || '',
          device_type: z.device_type || 'pc',
          device_count: Number(z.device_count || 0),
          assumed_occupancy_hours: Number(z.assumed_occupancy_hours || 0),
          tariff_mix: Array.isArray(z.tariff_mix)
            ? z.tariff_mix.map((m: any) => ({ tariff_id: String(m.tariff_id), share_pct: Number(m.share_pct || 0) }))
            : [],
        })),
      )
      setFact(d.fact || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ── Расчёты (зеркало веб-страницы) ────────────────────────────────────────
  const tariffById = useMemo(() => {
    const m = new Map<string, Tariff>()
    for (const t of tariffs) m.set(t.id, t)
    return m
  }, [tariffs])

  const calc = useMemo(() => {
    const perZone = (zones || []).map((z) => {
      let blendedRate = 0
      let shareSum = 0
      for (const m of z.tariff_mix || []) {
        const t = tariffById.get(m.tariff_id)
        if (!t) continue
        blendedRate += (num(m.share_pct) / 100) * tariffRate(t)
        shareSum += num(m.share_pct)
      }
      const perDevicePerDay = num(z.assumed_occupancy_hours) * blendedRate
      const potentialPerDay = num(z.device_count) * perDevicePerDay
      return {
        zone: z,
        blendedRate,
        shareSum,
        perDevicePerDay,
        potentialPerDay,
        potentialPerMonth: potentialPerDay * 30,
      }
    })
    const totalPotentialPerDay = perZone.reduce((s, r) => s + r.potentialPerDay, 0)
    const totalDevices = (zones || []).reduce((s, z) => s + num(z.device_count), 0)
    const capacityRatePerHour = perZone.reduce((s, r) => s + num(r.zone.device_count) * r.blendedRate, 0)
    const factPerDay = fact?.revenue_per_day || 0
    const impliedOccupancy = capacityRatePerHour > 0 ? factPerDay / capacityRatePerHour : null
    const assumedAvg =
      totalDevices > 0
        ? (zones || []).reduce((s, z) => s + num(z.device_count) * num(z.assumed_occupancy_hours), 0) / totalDevices
        : 0
    return {
      perZone,
      totalPotentialPerDay,
      totalPotentialPerMonth: totalPotentialPerDay * 30,
      totalDevices,
      capacityRatePerHour,
      impliedOccupancy,
      assumedAvg,
    }
  }, [zones, tariffById, fact])

  const totalPotentialMonth = calc.totalPotentialPerMonth
  const factMonth = fact?.revenue_per_month || 0
  const gapMonth = totalPotentialMonth - factMonth
  const maxZoneMonth = Math.max(1, ...calc.perZone.map((r) => r.potentialPerMonth))

  const companyOptions = useMemo(
    () => (companies || []).slice(0, 4).map((c) => ({ key: c.id, label: c.name || c.code || '—' })),
    [companies],
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={T.text} />
        </Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Симуляция</Text>
      </View>

      {companyOptions.length > 1 ? (
        <View style={{ paddingHorizontal: S.lg, paddingBottom: 6 }}>
          <Segmented
            value={companyId}
            onChange={(v) => {
              setCompanyId(v)
              void load(v)
            }}
            options={companyOptions}
          />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={
          <RefreshControl refreshing={loading && (zones.length > 0 || tariffs.length > 0)} onRefresh={() => load(companyId || undefined)} tintColor={T.green} />
        }
      >
        <GlowHero glow={T.blue}>
          <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ПОТЕНЦИАЛ КЛУБА / МЕС</Text>
          <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(Math.round(totalPotentialMonth))}</Text>
          <Text style={{ color: T.textDim, fontSize: 12, marginTop: 4 }}>
            {money(Math.round(calc.totalPotentialPerDay))} / день · только время устройств
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
            <Pill text={`факт ${moneyShort(factMonth)}`} tone="good" />
            {gapMonth > 0 ? (
              <Pill text={`разрыв ${moneyShort(gapMonth)}`} tone="warn" />
            ) : (
              <Pill text={`факт выше на ${moneyShort(-gapMonth)}`} tone="good" />
            )}
          </View>
          {fact ? (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>
              Факт: {money(fact.revenue_per_day)} / день · за {fact.window_days} дн (вся выручка)
            </Text>
          ) : (
            <Text style={{ color: T.textDim, fontSize: 12, marginTop: 10 }}>Факт по выручке недоступен</Text>
          )}
        </GlowHero>

        {error ? (
          <Card style={{ borderColor: '#3b1212' }}>
            <Text style={{ color: T.red, fontWeight: '800' }}>Ошибка</Text>
            <Text style={{ color: T.textMut, marginTop: 6, fontSize: 13 }}>{error}</Text>
          </Card>
        ) : null}

        {loading && zones.length === 0 && tariffs.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : !loading && zones.length === 0 && tariffs.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <Ionicons name="flask-outline" size={38} color={T.textDim} />
            <Text style={{ color: T.textMut, fontSize: 14 }}>Конфигурация симуляции не задана</Text>
            <Text style={{ color: T.textDim, fontSize: 12, textAlign: 'center' }}>Зоны и тарифы настраиваются в веб-портале</Text>
          </Card>
        ) : (
          <>
            {/* Обратный расчёт загрузки */}
            {calc.impliedOccupancy != null && calc.capacityRatePerHour > 0 ? (
              <Card>
                <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>ОБРАТНЫЙ РАСЧЁТ ЗАГРУЗКИ</Text>
                <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', marginTop: 6 }}>
                  {calc.impliedOccupancy.toFixed(1)} ч/устройство в сутки
                </Text>
                <Text style={{ color: T.textDim, fontSize: 12.5, marginTop: 6, lineHeight: 18 }}>
                  Столько нужно, чтобы выйти на текущую выручку.
                  {calc.assumedAvg > 0
                    ? ` Заложено в среднем ${calc.assumedAvg.toFixed(1)} ч — ${
                        Math.abs(calc.impliedOccupancy - calc.assumedAvg) < 0.5
                          ? 'расчёт сходится с реальностью.'
                          : calc.impliedOccupancy - calc.assumedAvg < 0
                          ? `по факту загрузка ниже на ${Math.abs(calc.impliedOccupancy - calc.assumedAvg).toFixed(1)} ч — зоны простаивают.`
                          : `факт выше расчёта на ${(calc.impliedOccupancy - calc.assumedAvg).toFixed(1)} ч (вероятно, выручка включает бар/допуслуги).`
                      }`
                    : ''}
                </Text>
              </Card>
            ) : null}

            {/* Потенциал по зонам */}
            {calc.perZone.length > 0 ? (
              <Card>
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '800', marginBottom: S.md }}>Потенциал по зонам</Text>
                <View style={{ gap: S.md }}>
                  {calc.perZone.map((r) => (
                    <BarRow
                      key={r.zone.id}
                      label={r.zone.name || '—'}
                      value={r.potentialPerMonth}
                      max={maxZoneMonth}
                      color={T.blue}
                      valueLabel={moneyShort(r.potentialPerMonth)}
                    />
                  ))}
                </View>
              </Card>
            ) : null}

            {/* Детализация зон */}
            {zones.length > 0 ? (
              <Card style={{ padding: 0 }}>
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '800', padding: 14, paddingBottom: 8 }}>Зоны</Text>
                {calc.perZone.map((r, i) => {
                  const z = r.zone
                  return (
                    <View
                      key={z.id}
                      style={{
                        padding: 14,
                        paddingTop: 12,
                        borderTopWidth: 1,
                        borderTopColor: T.borderSoft,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                          {z.name || '—'}
                        </Text>
                        <Pill text={DEVICE_LABEL[z.device_type || 'pc'] || z.device_type || '—'} tone="mut" />
                        {r.shareSum > 0 && Math.abs(r.shareSum - 100) > 1 ? (
                          <Pill text={`микс ${Math.round(r.shareSum)}%`} tone="warn" />
                        ) : null}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                        <Text style={{ color: T.textMut, fontSize: 12 }}>Устройств: {z.device_count}</Text>
                        <Text style={{ color: T.textMut, fontSize: 12 }}>Загрузка: {z.assumed_occupancy_hours} ч</Text>
                        <Text style={{ color: T.textMut, fontSize: 12 }}>{money(Math.round(r.blendedRate))}/час</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                        <Text style={{ color: T.textDim, fontSize: 12 }}>
                          {money(Math.round(r.potentialPerDay))} / день
                        </Text>
                        <Text style={{ color: T.blue, fontSize: 14, fontWeight: '800' }}>
                          {money(Math.round(r.potentialPerMonth))} / мес
                        </Text>
                      </View>
                    </View>
                  )
                })}
              </Card>
            ) : null}

            {/* Тарифы */}
            {tariffs.length > 0 ? (
              <Card style={{ padding: 0 }}>
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '800', padding: 14, paddingBottom: 4 }}>Тарифы</Text>
                <Text style={{ color: T.textDim, fontSize: 11.5, paddingHorizontal: 14, paddingBottom: 8 }}>
                  ₸/час = цена ÷ (оплаченные + бонусные часы)
                </Text>
                {tariffs.map((t, i) => (
                  <View
                    key={t.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: 14,
                      borderTopWidth: 1,
                      borderTopColor: T.borderSoft,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
                        {t.name || 'Тариф'}
                      </Text>
                      <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }}>
                        {t.paid_hours} опл. + {t.bonus_hours} бонус ч · {money(t.price)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: T.greenBright, fontSize: 14, fontWeight: '800' }}>{money(Math.round(tariffRate(t)))}</Text>
                      <Text style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>в час</Text>
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}

            <Card>
              <Text style={{ color: T.text, fontSize: 13, fontWeight: '700' }}>Как это работает</Text>
              <Text style={{ color: T.textDim, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
                «Потенциал» — выручка только за время устройств по заданным зонам и тарифам, без бара и допуслуг.
                «Факт» берётся из системы автоматически (вся выручка точки за {fact?.window_days || 90} дней), поэтому может быть выше.
                Конфигурация задаётся в веб-портале.
              </Text>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
