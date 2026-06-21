import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { apiFetch } from '@/lib/api'
import { haptic } from '@/lib/haptics'
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

  // быстрое действие «взять в работу» по строке
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null)
  // модалка завершения
  const [completeTask, setCompleteTask] = useState<Task | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { const r = await apiFetch<{ tasks: Task[] }>('/api/operator/tasks'); setTasks(r.tasks || []) }
    catch (e: any) { setError(e?.message || 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const accept = useCallback(async (t: Task) => {
    setAcceptBusyId(t.id)
    setError(null)
    try {
      await apiFetch('/api/operator/tasks', { method: 'POST', body: JSON.stringify({ action: 'respondTask', taskId: t.id, response: 'accept' }) })
      haptic.success()
      await load()
    } catch (e: any) {
      haptic.error()
      setError(e?.message || 'Не удалось взять задачу')
    } finally {
      setAcceptBusyId(null)
    }
  }, [load])

  const openComplete = useCallback((t: Task) => { setCompleteTask(t); setNote(''); setModalError(null) }, [])
  const closeComplete = useCallback(() => { setCompleteTask(null); setNote(''); setModalError(null) }, [])

  const submitComplete = useCallback(async () => {
    if (!completeTask) return
    setSaving(true)
    setModalError(null)
    try {
      await apiFetch('/api/operator/tasks', {
        method: 'POST',
        body: JSON.stringify({ action: 'respondTask', taskId: completeTask.id, response: 'complete', note: note.trim() || null }),
      })
      haptic.success()
      closeComplete()
      await load()
    } catch (e: any) {
      haptic.error()
      setModalError(e?.message || 'Не удалось завершить задачу')
    } finally {
      setSaving(false)
    }
  }, [completeTask, note, closeComplete, load])

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
            {error ? <Card style={{ borderColor: '#3b1212' }}><Text style={{ color: T.red, fontSize: 13 }}>{error}</Text></Card> : null}
            {active.map((t) => (
              <TaskRow
                key={t.id}
                t={t}
                accepting={acceptBusyId === t.id}
                onAccept={() => void accept(t)}
                onComplete={() => openComplete(t)}
              />
            ))}
            {done.length > 0 ? (
              <>
                <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '700', marginTop: 8, letterSpacing: 0.4 }}>ВЫПОЛНЕНО ({done.length})</Text>
                {done.slice(0, 10).map((t) => <TaskRow key={t.id} t={t} dim />)}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Модалка завершения задачи */}
      <Modal visible={!!completeTask} transparent animationType="slide" onRequestClose={closeComplete}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: T.card, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderWidth: 1, borderColor: T.border, padding: S.xl, gap: S.md }}>
            <Text style={{ color: T.text, fontSize: 18, fontWeight: '900' }}>Завершить задачу</Text>
            {completeTask ? <Text style={{ color: T.textMut, fontSize: 13 }} numberOfLines={2}>{completeTask.title}</Text> : null}
            <Text style={{ color: T.textDim, fontSize: 12 }}>Комментарий — необязательно, его увидит постановщик задачи.</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Например: всё сделано, фото в чате"
              placeholderTextColor={T.textDim}
              multiline
              style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: R.md, padding: 14, color: T.text, fontSize: 15, minHeight: 80, textAlignVertical: 'top' }}
            />
            {modalError ? <Text style={{ color: T.red, fontSize: 12 }}>{modalError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <Pressable onPress={closeComplete} disabled={saving} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: R.md, borderWidth: 1, borderColor: T.border, opacity: saving ? 0.6 : 1 }}>
                <Text style={{ color: T.textMut, fontWeight: '700' }}>Отмена</Text>
              </Pressable>
              <Pressable onPress={() => void submitComplete()} disabled={saving} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: R.md, backgroundColor: T.green, opacity: saving ? 0.6 : 1 }}>
                {saving ? <ActivityIndicator color="#04130d" size="small" /> : <Text style={{ color: '#04130d', fontWeight: '900' }}>Завершить</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

function TaskRow({ t, dim, accepting, onAccept, onComplete }: { t: Task; dim?: boolean; accepting?: boolean; onAccept?: () => void; onComplete?: () => void }) {
  const st = STATUS[t.status] || STATUS.todo
  const due = fmtDue(t.due_date)
  const canAccept = t.status === 'todo' || t.status === 'backlog'
  const canComplete = t.status !== 'done'
  const showActions = !dim && (onAccept || onComplete) && (canAccept || canComplete)
  return (
    <Card style={{ gap: 8, opacity: dim ? 0.6 : 1, borderLeftWidth: 3, borderLeftColor: prColor(t.priority) }}>
      <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{t.title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={st.text} tone={st.tone} />
        {t.company_name ? <Text style={{ color: T.textDim, fontSize: 12 }}>{t.company_name}</Text> : null}
        {due ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Ionicons name="time-outline" size={12} color={T.textDim} /><Text style={{ color: T.textDim, fontSize: 12 }}>{due}</Text></View> : null}
      </View>

      {showActions ? (
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: 2 }}>
          {canAccept && onAccept ? (
            <Pressable
              onPress={onAccept}
              disabled={accepting}
              style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: '#0c3a2c', borderWidth: 1, borderColor: '#10b981', borderRadius: R.md, paddingVertical: 11, opacity: accepting ? 0.6 : 1 }}
            >
              {accepting ? <ActivityIndicator color={T.green} size="small" /> : <Ionicons name="play" size={16} color={T.green} />}
              <Text style={{ color: T.green, fontWeight: '800', fontSize: 14 }}>Взять в работу</Text>
            </Pressable>
          ) : null}
          {canComplete && onComplete ? (
            <Pressable
              onPress={onComplete}
              style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: T.green, borderRadius: R.md, paddingVertical: 11 }}
            >
              <Ionicons name="checkmark" size={16} color="#04130d" />
              <Text style={{ color: '#04130d', fontWeight: '900', fontSize: 14 }}>Выполнено</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  )
}
