import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { T, R, S } from '@/lib/theme'
import { Card, Pill } from '@/components/ui'

type Task = { id: string; title: string; status: string; priority: string | null; due_date: string | null; company_name: string | null }

const STATUS: Record<string, { text: string; tone: 'good' | 'warn' | 'mut' | 'brand' }> = {
  todo: { text: 'К работе', tone: 'mut' },
  backlog: { text: 'Бэклог', tone: 'mut' },
  in_progress: { text: 'В работе', tone: 'brand' },
  review: { text: 'На проверке', tone: 'warn' },
  done: { text: 'Готово', tone: 'good' },
}
const prColor = (p: string | null) => (p === 'high' || p === 'urgent' ? T.red : p === 'medium' ? T.amber : T.textDim)
const fmtDue = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : null)

export default function OperatorTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { const r = await apiFetch<{ tasks: Task[] }>('/api/operator/tasks'); setTasks(r.tasks || []) }
    catch (e: any) { setError(e?.message || 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const active = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl, gap: S.md }} refreshControl={<RefreshControl refreshing={loading && tasks.length > 0} onRefresh={load} tintColor={T.green} />}>
        <Text style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: 0.2 }}>Задачи</Text>

        {loading && tasks.length === 0 ? <ActivityIndicator color={T.green} style={{ marginTop: 50 }} /> : error ? (
          <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontWeight: '800' }}>Не удалось загрузить</Text><Text style={{ color: T.textMut, marginTop: 6 }}>{error}</Text></Card>
        ) : tasks.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 36, gap: 8 }}>
            <Ionicons name="checkmark-done-circle" size={40} color={T.green} />
            <Text style={{ color: T.text, fontSize: 16, fontWeight: '800' }}>Задач нет</Text>
            <Text style={{ color: T.textDim, fontSize: 13 }}>Новые задачи появятся здесь.</Text>
          </Card>
        ) : (
          <>
            {active.map((t) => <TaskRow key={t.id} t={t} />)}
            {done.length > 0 ? (
              <>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700', marginTop: 8, letterSpacing: 0.4 }}>ВЫПОЛНЕНО ({done.length})</Text>
                {done.slice(0, 10).map((t) => <TaskRow key={t.id} t={t} dim />)}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function TaskRow({ t, dim }: { t: Task; dim?: boolean }) {
  const st = STATUS[t.status] || STATUS.todo
  const due = fmtDue(t.due_date)
  return (
    <Card style={{ gap: 8, opacity: dim ? 0.6 : 1, borderLeftWidth: 3, borderLeftColor: prColor(t.priority) }}>
      <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{t.title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={st.text} tone={st.tone} />
        {t.company_name ? <Text style={{ color: T.textDim, fontSize: 12 }}>{t.company_name}</Text> : null}
        {due ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Ionicons name="time-outline" size={12} color={T.textDim} /><Text style={{ color: T.textDim, fontSize: 12 }}>{due}</Text></View> : null}
      </View>
    </Card>
  )
}
