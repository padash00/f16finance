import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { T, money } from '@/lib/theme'
import { Card, Pill, ErrorState, EmptyState, PrimaryButton, GhostButton } from '@/components/ui'

type Expense = {
  id: string
  date: string | null
  company_id: string | null
  operator_id: string | null
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
  document_kind: string | null
  one_off_payee: string | null
  one_off_reason: string | null
  created_at: string | null
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—')
const amountOf = (e: Expense) => (Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0))

export default function ApprovalsScreen() {
  const router = useRouter()
  const [items, setItems] = useState<Expense[]>([])
  const [companyName, setCompanyName] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // модалка отклонения
  const [declineId, setDeclineId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const [pend, comp] = await Promise.all([
        apiFetch<{ data: Expense[] }>('/api/admin/expenses/pending'),
        apiFetch<{ data: Array<{ id: string; name?: string }> }>('/api/admin/companies').catch(() => ({ data: [] })),
      ])
      setItems(pend.data || [])
      const map: Record<string, string> = {}
      for (const c of comp.data || []) if (c?.id) map[String(c.id)] = c.name || ''
      setCompanyName(map)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const approve = async (e: Expense) => {
    setBusyId(e.id)
    try {
      await apiFetch(`/api/admin/expenses/${e.id}/approve`, { method: 'POST' })
      haptic.success()
      setItems((p) => p.filter((x) => x.id !== e.id))
    } catch (err: any) {
      haptic.error()
      setError(err?.message || 'Не удалось одобрить')
    } finally {
      setBusyId(null)
    }
  }

  const submitDecline = async () => {
    if (!declineId) return
    if (reason.trim().length < 10) { setError('Причина — минимум 10 символов'); return }
    const id = declineId
    setBusyId(id)
    try {
      await apiFetch(`/api/admin/expenses/${id}/decline`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) })
      haptic.success()
      setItems((p) => p.filter((x) => x.id !== id))
      setDeclineId(null); setReason('')
    } catch (err: any) {
      haptic.error()
      setError(err?.message || 'Не удалось отклонить')
    } finally {
      setBusyId(null)
    }
  }

  const total = items.reduce((a, e) => a + amountOf(e), 0)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: T.text, fontSize: 22, fontWeight: '800' }}>Согласования</Text>
          <Text style={{ color: T.textDim, fontSize: 12 }}>{items.length ? `${items.length} на сумму ${money(total)}` : 'расходы на одобрение'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 18, paddingTop: 10, paddingBottom: 28, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={load} tintColor={T.green} />}
      >
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : null}

        {loading && items.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 50 }} />
        ) : items.length === 0 ? (
          <EmptyState icon="checkmark-done-circle-outline" title="Всё согласовано" />
        ) : (
          items.map((e) => {
            const title = e.one_off_payee || e.category || 'Расход'
            const sub = e.one_off_reason || e.comment || null
            const cmp = e.company_id ? companyName[e.company_id] : null
            const busy = busyId === e.id
            return (
              <Card key={e.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{title}</Text>
                    <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }}>
                      {cmp ? `${cmp} · ` : ''}{fmtDate(e.date || e.created_at)}{e.category && e.one_off_payee ? ` · ${e.category}` : ''}
                    </Text>
                  </View>
                  <Text style={{ color: T.text, fontSize: 17, fontWeight: '800' }}>{money(amountOf(e))}</Text>
                </View>

                {sub ? <Text style={{ color: T.textMut, fontSize: 13 }} numberOfLines={3}>{sub}</Text> : null}

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {Number(e.cash_amount) > 0 ? <Pill text={`нал ${money(Number(e.cash_amount))}`} tone="mut" /> : null}
                  {Number(e.kaspi_amount) > 0 ? <Pill text={`Kaspi ${money(Number(e.kaspi_amount))}`} tone="mut" /> : null}
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
                  <Pressable
                    onPress={() => void approve(e)}
                    disabled={busy}
                    style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: '#0c3a2c', borderWidth: 1, borderColor: '#10b981', borderRadius: 14, paddingVertical: 12, opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? <ActivityIndicator color={T.green} size="small" /> : <Ionicons name="checkmark" size={18} color={T.green} />}
                    <Text style={{ color: T.green, fontWeight: '800', fontSize: 14 }}>Одобрить</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { haptic.warning(); setDeclineId(e.id); setReason(''); setError(null) }}
                    disabled={busy}
                    style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#3b1212', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 18, opacity: busy ? 0.6 : 1 }}
                  >
                    <Ionicons name="close" size={18} color={T.red} />
                    <Text style={{ color: T.red, fontWeight: '700', fontSize: 14 }}>Отклонить</Text>
                  </Pressable>
                </View>
              </Card>
            )
          })
        )}
      </ScrollView>

      {/* Модалка причины отклонения */}
      <Modal visible={!!declineId} transparent animationType="fade" onRequestClose={() => setDeclineId(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 14 }}>
            <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>Причина отклонения</Text>
            <Text style={{ color: T.textDim, fontSize: 12 }}>Минимум 10 символов — её увидит тот, кто создал расход.</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Например: нет чека, оплатите из подотчёта"
              placeholderTextColor={T.textDim}
              multiline
              style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, color: T.text, fontSize: 15, minHeight: 88, textAlignVertical: 'top' }}
            />
            {error ? <Text style={{ color: T.red, fontSize: 12 }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <GhostButton label="Отмена" onPress={() => { setDeclineId(null); setReason('') }} disabled={busyId === declineId} style={{ flex: 1 }} />
              <PrimaryButton label="Отклонить" tone="red" loading={busyId === declineId} disabled={busyId === declineId} onPress={() => void submitDecline()} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
