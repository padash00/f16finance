import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, ErrorState, EmptyState, PrimaryButton, GhostButton } from '@/components/ui'

type Item = { id: string; company_name: string; debtor_name: string; item_name: string; quantity: number; total_amount: number; created_by_name: string; comment: string | null; created_at: string }
type Resp = { weekStart: string; weekEnd: string; items: Item[]; totals: { count: number; amount: number } }

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const mondayOf = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x }

export default function DebtsScreen() {
  const router = useRouter()
  const { role } = useAuth()
  const canManage = canDo(role, 'point-debts.manage')

  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const [d, setD] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // режим выбора + отметка оплаченными
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [settling, setSettling] = useState(false)
  const [settleError, setSettleError] = useState<string | null>(null)

  const load = useCallback(async (ws: Date) => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<{ data: Resp }>(`/api/admin/point-debts?weekStart=${iso(ws)}`)
      setD(res.data)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(week) }, [week, load])

  // при смене недели сбрасываем выбор
  useEffect(() => { setSelected(new Set()); setSelectMode(false) }, [week])

  const shiftWeek = (delta: number) => setWeek((w) => { const x = new Date(w); x.setDate(x.getDate() + delta * 7); return x })
  const isThisWeek = useMemo(() => iso(week) === iso(mondayOf(new Date())), [week])

  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const exitSelect = () => { setSelectMode(false); setSelected(new Set()) }

  const selectedItems = useMemo(
    () => (d?.items || []).filter((it) => selected.has(it.id)),
    [d, selected],
  )
  const selectedAmount = useMemo(
    () => selectedItems.reduce((s, it) => s + Number(it.total_amount || 0), 0),
    [selectedItems],
  )

  const markPaid = async () => {
    const ids = [...selected]
    if (!ids.length) return
    setSettling(true); setSettleError(null)
    try {
      await apiFetch('/api/admin/point-debts', {
        method: 'POST',
        body: JSON.stringify({ action: 'markPaid', itemIds: ids }),
      })
      haptic.success()
      setConfirmOpen(false)
      setSelected(new Set())
      setSelectMode(false)
      await load(week)
    } catch (e: any) {
      haptic.error()
      setSettleError(e?.message || 'Не удалось списать')
    } finally {
      setSettling(false)
    }
  }

  // группировка по компании
  const byCompany = useMemo(() => {
    const m = new Map<string, { name: string; items: Item[]; amount: number }>()
    for (const it of d?.items || []) {
      const e = m.get(it.company_name) || { name: it.company_name, items: [], amount: 0 }
      e.items.push(it); e.amount += Number(it.total_amount || 0)
      m.set(it.company_name, e)
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount)
  }, [d])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Долги с точки</Text>
        {canManage && d && d.items.length > 0 ? (
          selectMode ? (
            <Pressable onPress={exitSelect} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 7 }}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '800' }}>Отмена</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setSelectMode(true)}
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.green, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 7 }}
            >
              <Ionicons name="checkmark-done" size={16} color="#04130d" />
              <Text style={{ color: '#04130d', fontSize: 13, fontWeight: '900' }}>Списать</Text>
            </Pressable>
          )
        ) : null}
      </View>

      {/* неделя */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: 6 }}>
        <Pressable onPress={() => shiftWeek(-1)} hitSlop={10} style={{ padding: 6 }}><Ionicons name="chevron-back" size={20} color={T.textMut} /></Pressable>
        <Text style={{ color: T.text, fontSize: 14, fontWeight: '700' }}>{d ? `${new Date(d.weekStart).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })} — ${new Date(d.weekEnd).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}` : '…'}</Text>
        <Pressable onPress={() => !isThisWeek && shiftWeek(1)} hitSlop={10} disabled={isThisWeek} style={{ padding: 6, opacity: isThisWeek ? 0.3 : 1 }}><Ionicons name="chevron-forward" size={20} color={T.textMut} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={() => load(week)} tintColor={T.green} />}>
        {loading && !d ? <ActivityIndicator color={T.green} style={{ marginTop: 40 }} /> : error ? (
          <ErrorState message={error} onRetry={() => load(week)} />
        ) : d ? (
          <>
            <GlowHero glow={T.amber}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ДОЛГОВ ЗА НЕДЕЛЮ</Text>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(d.totals.amount)}</Text>
              <Text style={{ color: T.textMut, fontSize: 13, marginTop: 3 }}>{d.totals.count} позиций</Text>
            </GlowHero>

            {byCompany.length === 0 ? (
              <EmptyState icon="checkmark-done-circle-outline" title="Долгов на этой неделе нет" />
            ) : byCompany.map((g) => (
              <View key={g.name} style={{ gap: S.sm }}>
                <SectionTitle hint={moneyShort(g.amount)}>{g.name}</SectionTitle>
                <Card style={{ gap: 2, paddingVertical: 4 }}>
                  {g.items.map((it, i, arr) => {
                    const isSel = selected.has(it.id)
                    const row = (
                      <>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <Text style={{ color: T.text, fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>{it.debtor_name}</Text>
                          <Text style={{ color: T.amber, fontSize: 14.5, fontWeight: '800' }}>{money(it.total_amount)}</Text>
                        </View>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                          {it.item_name}{it.quantity > 1 ? ` × ${it.quantity}` : ''}{it.comment ? ` · ${it.comment}` : ''}
                        </Text>
                      </>
                    )
                    if (selectMode) {
                      return (
                        <Pressable
                          key={it.id}
                          onPress={() => toggleSelect(it.id)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}
                        >
                          <Ionicons
                            name={isSel ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={isSel ? T.green : T.textDim}
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>{row}</View>
                        </Pressable>
                      )
                    }
                    return (
                      <View key={it.id} style={{ paddingVertical: 11, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                        {row}
                      </View>
                    )
                  })}
                </Card>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      {/* нижняя панель действия в режиме выбора */}
      {selectMode ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1, borderTopColor: T.border, backgroundColor: T.card }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: T.textMut, fontSize: 12, fontWeight: '700' }}>Выбрано {selected.size}</Text>
            <Text style={{ color: T.text, fontSize: 16, fontWeight: '900' }}>{money(selectedAmount)}</Text>
          </View>
          <Pressable
            onPress={() => { haptic.warning(); setSettleError(null); setConfirmOpen(true) }}
            disabled={selected.size === 0}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.green, borderRadius: R.md, paddingHorizontal: 18, paddingVertical: 13, opacity: selected.size === 0 ? 0.4 : 1 }}
          >
            <Ionicons name="checkmark-done" size={18} color="#04130d" />
            <Text style={{ color: '#04130d', fontSize: 14, fontWeight: '900' }}>Отметить оплаченными</Text>
          </Pressable>
        </View>
      ) : null}

      {/* подтверждение списания */}
      <Modal visible={confirmOpen} transparent animationType="slide" onRequestClose={() => !settling && setConfirmOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>Списать долги?</Text>
              <Pressable onPress={() => !settling && setConfirmOpen(false)} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            <Text style={{ color: T.textMut, fontSize: 14, lineHeight: 20 }}>
              {selected.size} {selected.size === 1 ? 'позиция будет отмечена' : 'позиций будет отмечено'} оплаченными на сумму{' '}
              <Text style={{ color: T.text, fontWeight: '900' }}>{money(selectedAmount)}</Text>. Это действие нельзя отменить.
            </Text>

            <Card style={{ gap: 2, paddingVertical: 4, maxHeight: 200 }}>
              <ScrollView>
                {selectedItems.map((it, i, arr) => (
                  <View key={it.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 9, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                    <Text style={{ color: T.text, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>{it.debtor_name} · {it.item_name}</Text>
                    <Text style={{ color: T.amber, fontSize: 13, fontWeight: '800' }}>{money(it.total_amount)}</Text>
                  </View>
                ))}
              </ScrollView>
            </Card>

            {settleError ? <Text style={{ color: T.red, fontSize: 12 }}>{settleError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <GhostButton label="Отмена" onPress={() => !settling && setConfirmOpen(false)} disabled={settling} style={{ flex: 1 }} />
              <PrimaryButton label="Списать" loading={settling} disabled={settling} onPress={() => void markPaid()} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
