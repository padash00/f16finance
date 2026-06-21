import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { canDo } from '@/lib/access'
import { useAuth } from '@/lib/auth'
import { T, R, S, money, moneyShort } from '@/lib/theme'
import { Card, SectionTitle, Pill, GlowHero, ErrorState, EmptyState, PrimaryButton, GhostButton } from '@/components/ui'

const num = (v: string) => {
  const n = Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

type Component = {
  id?: string
  ingredient_id?: string | null
  component_recipe_id?: string | null
  name?: string | null
  qty?: number | null
  unit?: string | null
  waste_pct?: number | null
}

type Recipe = {
  id: string
  name: string
  category: string | null
  output_qty: number | null
  output_unit: string | null
  yield_factor: number | null
  sale_item_id: string | null
  is_semi_finished: boolean | null
  is_active: boolean | null
  notes: string | null
  components: Component[]
  recipe_cost: number
  portion_cost: number
}

type Ingredient = {
  id: string
  name: string
  unit: string | null
  purchase_price: number | null
  category: string | null
  stock_qty: number | null
}

type Resp = {
  ok: boolean
  recipes: Recipe[]
  ingredients: Ingredient[]
  saleItems: Array<{ id: string; name: string; sale_price: number | null }>
}

export default function ProductionScreen() {
  const router = useRouter()
  const { role } = useAuth()
  // Бэкенд POST /ingredients разрешает owner/manager (canManage). canDo даёт true
  // владельцу/суперадмину; менеджеру без явного capability добавляем по staffRole.
  const canCreate = canDo(role, 'production.create') || role?.staffRole === 'manager'

  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [tab, setTab] = useState<'recipes' | 'ingredients'>('recipes')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Модалка «Добавить ингредиент» (POST /api/admin/production/ingredients)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fName, setFName] = useState('')
  const [fUnit, setFUnit] = useState('')
  const [fPrice, setFPrice] = useState('')
  const [fCategory, setFCategory] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<Resp>('/api/admin/production/recipes')
      setRecipes(res?.recipes || [])
      setIngredients(res?.ingredients || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // средний food cost % по техкартам, у которых есть связанное блюдо в продаже не считаем —
  // здесь только себестоимость, считаем суммарную себестоимость порций
  const summary = useMemo(() => {
    let totalPortionCost = 0
    let withCost = 0
    let semiCount = 0
    for (const r of recipes) {
      const pc = Number(r.portion_cost || 0)
      totalPortionCost += pc
      if (pc > 0) withCost += 1
      if (r.is_semi_finished) semiCount += 1
    }
    const avgPortion = withCost > 0 ? Math.round(totalPortionCost / withCost) : 0
    return { count: recipes.length, avgPortion, semiCount }
  }, [recipes])

  const stockValue = useMemo(() => {
    let v = 0
    for (const g of ingredients) v += Number(g.stock_qty || 0) * Number(g.purchase_price || 0)
    return Math.round(v)
  }, [ingredients])

  const negativeStock = useMemo(
    () => ingredients.filter((g) => Number(g.stock_qty || 0) < 0).length,
    [ingredients],
  )

  const openCreate = () => {
    setFName(''); setFUnit(''); setFPrice(''); setFCategory('')
    setFormError(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setFormError(null)
  }

  const submit = async () => {
    const name = fName.trim()
    if (!name) { setFormError('Название обязательно'); return }
    setSaving(true)
    setFormError(null)
    try {
      await apiFetch('/api/admin/production/ingredients', {
        method: 'POST',
        body: JSON.stringify({
          name,
          unit: fUnit.trim() || 'г',
          purchase_price: num(fPrice),
          category: fCategory.trim() || null,
        }),
      })
      haptic.success()
      setModalOpen(false)
      setTab('ingredients')
      await load()
    } catch (e: any) {
      haptic.error()
      setFormError(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Производство</Text>
        {canCreate ? (
          <Pressable
            onPress={openCreate}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.green, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 7 }}
          >
            <Ionicons name="add" size={16} color="#04130d" />
            <Text style={{ color: '#04130d', fontSize: 13, fontWeight: '900' }}>Ингредиент</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Переключатель раздела */}
      <View style={{ flexDirection: 'row', gap: S.sm, paddingHorizontal: S.lg, paddingVertical: 6 }}>
        {([
          { key: 'recipes', label: `Техкарты (${recipes.length})` },
          { key: 'ingredients', label: `Ингредиенты (${ingredients.length})` },
        ] as const).map((o) => {
          const active = tab === o.key
          return (
            <Pressable
              key={o.key}
              onPress={() => setTab(o.key)}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: R.md,
                alignItems: 'center',
                backgroundColor: active ? T.card2 : 'transparent',
                borderWidth: 1,
                borderColor: active ? T.border : T.borderSoft,
              }}
            >
              <Text style={{ color: active ? T.text : T.textMut, fontSize: 13, fontWeight: '700' }}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }}
        refreshControl={<RefreshControl refreshing={loading && (recipes.length > 0 || ingredients.length > 0)} onRefresh={load} tintColor={T.green} />}
      >
        {loading && recipes.length === 0 && ingredients.length === 0 ? (
          <ActivityIndicator color={T.green} style={{ marginTop: 40 }} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : tab === 'recipes' ? (
          <>
            <GlowHero glow={T.green}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>ТЕХКАРТ ВСЕГО</Text>
              <Text style={{ color: T.text, fontSize: 38, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{summary.count}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                <Pill text={`ср. себест. ${moneyShort(summary.avgPortion)}`} tone="brand" />
                {summary.semiCount > 0 ? <Pill text={`полуфабрикаты ${summary.semiCount}`} tone="warn" /> : null}
              </View>
            </GlowHero>

            {recipes.length === 0 ? (
              <EmptyState icon="restaurant-outline" title="Техкарт нет" hint="Создайте первую на веб-портале" />
            ) : (
              <Card style={{ padding: 0 }}>
                {recipes.map((r, i) => {
                  const yieldLoss = Number(r.yield_factor || 1) < 1
                    ? Math.round((1 - Number(r.yield_factor || 1)) * 100)
                    : 0
                  const meta = [
                    r.category || null,
                    `выход ${Number(r.output_qty || 1)} ${r.output_unit || 'порц'}`,
                    `${(r.components || []).length} ингр.`,
                    yieldLoss > 0 ? `потери ${yieldLoss}%` : null,
                  ].filter(Boolean).join(' · ')
                  return (
                    <View key={r.id} style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < recipes.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text style={{ color: T.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>{r.name}</Text>
                          {r.is_semi_finished ? <Pill text="полуфабрикат" tone="warn" /> : null}
                        </View>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 3 }} numberOfLines={1}>{meta}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: T.textDim, fontSize: 10.5 }}>себест. порции</Text>
                        <Text style={{ color: T.greenBright, fontSize: 15, fontWeight: '900', marginTop: 1 }}>{money(r.portion_cost)}</Text>
                      </View>
                    </View>
                  )
                })}
              </Card>
            )}
          </>
        ) : (
          <>
            <GlowHero glow={T.teal}>
              <Text style={{ color: T.textMut, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>СТОИМОСТЬ ОСТАТКОВ</Text>
              <Text style={{ color: T.text, fontSize: 34, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 }}>{money(stockValue)}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: S.md, flexWrap: 'wrap' }}>
                <Pill text={`${ingredients.length} позиций`} tone="mut" />
                {negativeStock > 0 ? <Pill text={`в минусе ${negativeStock}`} tone="bad" /> : null}
              </View>
            </GlowHero>

            {ingredients.length === 0 ? (
              <EmptyState icon="cube-outline" title="Ингредиентов нет" hint="Добавьте сырьё на веб-портале" />
            ) : (
              <Card style={{ padding: 0 }}>
                {ingredients.map((g, i) => {
                  const stock = Number(g.stock_qty || 0)
                  const price = Number(g.purchase_price || 0)
                  return (
                    <View key={g.id} style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < ingredients.length - 1 ? 1 : 0, borderBottomColor: T.borderSoft }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: T.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                          {g.name} <Text style={{ color: T.textDim, fontSize: 12 }}>/ {g.unit || '—'}</Text>
                        </Text>
                        <Text style={{ color: T.textDim, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                          {money(price)} / {g.unit || 'ед.'}{g.category ? ` · ${g.category}` : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: T.textDim, fontSize: 10.5 }}>остаток</Text>
                        <Text style={{ color: stock < 0 ? T.red : T.text, fontSize: 14.5, fontWeight: '800', marginTop: 1 }}>
                          {stock} {g.unit || ''}
                        </Text>
                      </View>
                    </View>
                  )
                })}
              </Card>
            )}
          </>
        )}
      </ScrollView>

      {/* Модалка «Добавить ингредиент» */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: T.border, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>Новый ингредиент</Text>
              <Pressable onPress={closeModal} hitSlop={10}><Ionicons name="close" size={22} color={T.textMut} /></Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
              {/* Название */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Название *</Text>
                <TextInput
                  value={fName}
                  onChangeText={setFName}
                  placeholder="Например, Мука пшеничная"
                  placeholderTextColor={T.textDim}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              {/* Единица + цена закупа */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Единица</Text>
                  <TextInput
                    value={fUnit}
                    onChangeText={setFUnit}
                    placeholder="г"
                    placeholderTextColor={T.textDim}
                    autoCapitalize="none"
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                  />
                </View>
                <View style={{ flex: 1.4, gap: 6 }}>
                  <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Цена закупа / ед.</Text>
                  <TextInput
                    value={fPrice}
                    onChangeText={setFPrice}
                    placeholder="0"
                    placeholderTextColor={T.textDim}
                    keyboardType="numeric"
                    style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                  />
                </View>
              </View>

              {/* Категория */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700' }}>Категория</Text>
                <TextInput
                  value={fCategory}
                  onChangeText={setFCategory}
                  placeholder="Необязательно"
                  placeholderTextColor={T.textDim}
                  style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, color: T.text, fontSize: 15 }}
                />
              </View>

              <Text style={{ color: T.textDim, fontSize: 11.5 }}>
                Остаток задаётся отдельно через приход/инвентаризацию — новый ингредиент создаётся с нулевым остатком.
              </Text>
            </ScrollView>

            {formError ? <Text style={{ color: T.red, fontSize: 12 }}>{formError}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <GhostButton label="Отмена" onPress={closeModal} disabled={saving} style={{ flex: 1 }} />
              <PrimaryButton label="Добавить" loading={saving} disabled={saving} onPress={() => void submit()} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}
