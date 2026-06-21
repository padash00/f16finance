import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, Pill, ErrorState, EmptyState } from '@/components/ui'

type Project = { id: string; name: string; companies: { id: string; name: string }[] }

export default function ArenaScreen() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const r = await apiFetch<{ data: { projects: Project[] } }>('/api/admin/arena'); setProjects(r.data?.projects || []) }
    catch (e: any) { setError(e?.message || 'Не удалось загрузить') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.lg, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={T.text} /></Pressable>
        <Text style={{ color: T.text, fontSize: 22, fontWeight: '900', flex: 1 }}>Арена</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: 6, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && projects.length > 0} onRefresh={load} tintColor={T.green} />}>
        {loading && projects.length === 0 ? <ActivityIndicator color={T.green} style={{ marginTop: 40 }} /> : error ? (
          <ErrorState message={error} onRetry={() => load()} />
        ) : projects.length === 0 ? (
          <EmptyState icon="game-controller-outline" title="Арена не подключена" hint="Точки с игровой зоной появятся здесь." />
        ) : (
          projects.map((p) => (
            <Card key={p.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(139,92,246,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="game-controller" size={21} color={T.violet} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: T.text, fontSize: 16, fontWeight: '800' }}>{p.name}</Text>
                  <Text style={{ color: T.textDim, fontSize: 12 }}>{p.companies.length} {p.companies.length === 1 ? 'компания' : 'компаний'} с ареной</Text>
                </View>
              </View>
              {p.companies.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {p.companies.map((c) => <Pill key={c.id} text={c.name} tone="brand" />)}
                </View>
              ) : null}
            </Card>
          ))
        )}
        <Text style={{ color: T.textDim, fontSize: 11, textAlign: 'center', marginTop: 4 }}>Управление станциями и тарифами — в десктопной программе.</Text>
      </ScrollView>
    </SafeAreaView>
  )
}
