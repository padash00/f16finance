'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  BellOff,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  X,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Task = {
  id: string
  title: string
  notes: string | null
  recurrence: 'once' | 'daily'
  task_date: string | null
  task_time: string | null
  remind: boolean
  remind_minutes_before: number
  sort_order: number
  created_at: string
  done: boolean
}

type FormState = {
  id: string | null
  title: string
  notes: string
  recurrence: 'once' | 'daily'
  task_time: string
  remind: boolean
  remind_minutes_before: number
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtHuman(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}

const emptyForm: FormState = {
  id: null,
  title: '',
  notes: '',
  recurrence: 'daily',
  task_time: '',
  remind: false,
  remind_minutes_before: 10,
}

export default function PlannerPage() {
  const [date, setDate] = useState(todayISO())
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/planner?date=${d}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Ошибка загрузки')
      setTasks((data.data?.items || []) as Task[])
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  const progress = useMemo(() => {
    const total = tasks.length
    const done = tasks.filter((t) => t.done).length
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
  }, [tasks])

  const isToday = date === todayISO()

  async function toggleDone(task: Task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)))
    try {
      await fetch('/api/admin/planner', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, toggle: { date, done: !task.done } }),
      })
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: task.done } : t)))
    }
  }

  async function removeTask(task: Task) {
    if (!confirm(`Удалить «${task.title}»?`)) return
    const prev = tasks
    setTasks((p) => p.filter((t) => t.id !== task.id))
    try {
      const res = await fetch(`/api/admin/planner?id=${task.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setTasks(prev)
      setError('Не удалось удалить')
    }
  }

  function openCreate() {
    setForm({ ...emptyForm })
  }

  function openEdit(task: Task) {
    setForm({
      id: task.id,
      title: task.title,
      notes: task.notes || '',
      recurrence: task.recurrence,
      task_time: task.task_time ? task.task_time.slice(0, 5) : '',
      remind: task.remind,
      remind_minutes_before: task.remind_minutes_before || 10,
    })
  }

  async function saveForm() {
    if (!form || !form.title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const payload: any = {
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        task_time: form.task_time || null,
        remind: form.remind,
        remind_minutes_before: form.remind_minutes_before,
      }
      let res: Response
      if (form.id) {
        res = await fetch('/api/admin/planner', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: form.id, ...payload }),
        })
      } else {
        payload.recurrence = form.recurrence
        if (form.recurrence === 'once') payload.task_date = date
        res = await fetch('/api/admin/planner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Ошибка сохранения')
      setForm(null)
      await load(date)
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <AdminPageHeader
        title="Распорядок дня"
        description="Личные задачи и напоминания — видишь только ты"
        icon={<CalendarClock className="h-5 w-5" />}
        accent="violet"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Задача
          </Button>
        }
      />

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</Card>
      )}

      {/* Навигация по датам + прогресс */}
      <Card className="border-white/10 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setDate((d) => shiftDate(d, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDate((d) => shiftDate(d, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div>
            <div className="text-lg font-semibold capitalize text-white">{fmtHuman(date)}</div>
            {!isToday && (
              <button
                onClick={() => setDate(todayISO())}
                className="text-xs text-fuchsia-300 hover:text-fuchsia-200"
              >
                ← вернуться к сегодня
              </button>
            )}
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="ml-auto h-9 rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-fuchsia-500/40"
          />
        </div>

        {progress.total > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>Выполнено {progress.done} из {progress.total}</span>
              <span>{progress.pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-500 transition-all"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Список задач */}
      {loading ? (
        <Card className="border-white/10 p-8 text-center text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </Card>
      ) : tasks.length === 0 ? (
        <Card className="border-dashed border-white/15 p-10 text-center">
          <CalendarClock className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-400">На этот день задач нет</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Добавить задачу
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <Card
              key={task.id}
              className={`flex items-center gap-3 border-white/10 p-3 transition ${
                task.done ? 'opacity-60' : ''
              }`}
            >
              <button
                onClick={() => toggleDone(task)}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition ${
                  task.done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-white/20 text-transparent hover:border-emerald-400'
                }`}
              >
                <Check className="h-4 w-4" />
              </button>

              {task.task_time && (
                <span className="shrink-0 font-mono text-sm tabular-nums text-slate-300">
                  {task.task_time.slice(0, 5)}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm ${task.done ? 'text-slate-500 line-through' : 'text-white'}`}>
                  {task.title}
                </div>
                {task.notes && (
                  <div className="truncate text-xs text-slate-500">{task.notes}</div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5 text-slate-500">
                {task.recurrence === 'daily' ? (
                  <span title="Ежедневная" className="flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] text-purple-300">
                    <Repeat className="h-3 w-3" /> кажд. день
                  </span>
                ) : (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">разовая</span>
                )}
                {task.remind ? (
                  <Bell className="h-3.5 w-3.5 text-amber-400" />
                ) : (
                  <BellOff className="h-3.5 w-3.5 text-slate-600" />
                )}
                <button onClick={() => openEdit(task)} className="rounded p-1 hover:bg-white/5 hover:text-white">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => removeTask(task)} className="rounded p-1 text-rose-300 hover:bg-rose-500/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Модалка создания/редактирования */}
      {form && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-4"
          onClick={() => !saving && setForm(null)}
        >
          <Card onClick={(e) => e.stopPropagation()} className="w-full max-w-md border-white/10 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                {form.id ? 'Редактировать задачу' : 'Новая задача'}
              </h3>
              <button onClick={() => setForm(null)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Название</label>
                <input
                  autoFocus
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Что нужно сделать"
                  className="h-10 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-fuchsia-500/40"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Заметка (необязательно)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 outline-none focus:border-fuchsia-500/40"
                />
              </div>

              {!form.id && (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Тип</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setForm({ ...form, recurrence: 'daily' })}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                        form.recurrence === 'daily'
                          ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-200'
                          : 'border-white/10 text-slate-400'
                      }`}
                    >
                      Каждый день
                    </button>
                    <button
                      onClick={() => setForm({ ...form, recurrence: 'once' })}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                        form.recurrence === 'once'
                          ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-200'
                          : 'border-white/10 text-slate-400'
                      }`}
                    >
                      Только {fmtHuman(date).replace(/^\w+,?\s*/, '')}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-slate-400">Время</label>
                <input
                  type="time"
                  value={form.task_time}
                  onChange={(e) => setForm({ ...form, task_time: e.target.value })}
                  className="h-10 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-fuchsia-500/40"
                />
              </div>

              <div className="rounded-md border border-white/10 p-3">
                <label className="flex cursor-pointer items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-slate-300">
                    <Bell className="h-4 w-4 text-amber-400" /> Напоминание в Telegram
                  </span>
                  <input
                    type="checkbox"
                    checked={form.remind}
                    onChange={(e) => setForm({ ...form, remind: e.target.checked })}
                    className="h-4 w-4 accent-fuchsia-500"
                  />
                </label>
                {form.remind && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
                    За
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={form.remind_minutes_before}
                      onChange={(e) =>
                        setForm({ ...form, remind_minutes_before: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="h-8 w-20 rounded border border-white/10 bg-white/[0.03] px-2 text-sm text-slate-200 outline-none focus:border-fuchsia-500/40"
                    />
                    мин до времени
                  </div>
                )}
                {form.remind && !form.task_time && (
                  <p className="mt-2 text-[11px] text-amber-300/80">
                    Укажи время — без него напоминание не сработает.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setForm(null)} disabled={saving}>
                Отмена
              </Button>
              <Button onClick={saveForm} disabled={saving || !form.title.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
