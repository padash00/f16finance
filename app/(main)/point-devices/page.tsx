'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Building2,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'

type Company = {
  id: string
  name: string
  code: string | null
}

type PointFeatureFlags = {
  shift_report: boolean
  income_report: boolean
  debt_report: boolean
  kaspi_daily_split: boolean
}

type PointProject = {
  id: string
  name: string
  project_token: string
  point_mode: string
  feature_flags: PointFeatureFlags
  shift_report_chat_id: string | null
  is_active: boolean
  notes: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
  companies: Company[]
}

type ProjectsResponse = {
  ok: boolean
  data?: {
    companies: Company[]
    projects: PointProject[]
  }
  error?: string
}

type ProjectForm = {
  name: string
  point_mode: string
  company_ids: string[]
  shift_report_chat_id: string
  notes: string
  feature_flags: PointFeatureFlags
}

const DEFAULT_FORM: ProjectForm = {
  name: '',
  point_mode: 'shift-report',
  company_ids: [],
  shift_report_chat_id: '',
  notes: '',
  feature_flags: {
    shift_report: true,
    income_report: true,
    debt_report: false,
    kaspi_daily_split: false,
  },
}

const MODE_LABELS: Record<string, string> = {
  'shift-report': 'Сменный отчёт',
  'cash-desk': 'Кассовое место',
  universal: 'Универсальный режим',
  debts: 'Долги и доп. операции',
}

function formatDateTime(value: string | null) {
  if (!value) return 'Ещё не выходило в сеть'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CompanySelect({
  allCompanies,
  selectedIds,
  onChange,
}: {
  allCompanies: Company[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {allCompanies.map((c) => {
          const selected = selectedIds.includes(c.id)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-left transition ${
                selected
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                  : 'border-white/10 bg-black/20 text-muted-foreground hover:border-white/20 hover:text-foreground'
              }`}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{c.name}{c.code ? ` (${c.code})` : ''}</span>
              {selected && <X className="ml-auto h-3.5 w-3.5 shrink-0 text-cyan-400" />}
            </button>
          )
        })}
      </div>
      {selectedIds.length === 0 && (
        <p className="text-xs text-amber-400">Выберите хотя бы одну точку</p>
      )}
    </div>
  )
}

function ProjectFormPanel({
  title,
  form,
  allCompanies,
  saving,
  onSave,
  onCancel,
  onChange,
}: {
  title: string
  form: ProjectForm
  allCompanies: Company[]
  saving: boolean
  onSave: () => void
  onCancel?: () => void
  onChange: (form: ProjectForm) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-foreground">{title}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">Название проекта</span>
          <input
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
            placeholder="F16, Arena, Восток..."
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">Режим</span>
          <select
            value={form.point_mode}
            onChange={(e) => onChange({ ...form, point_mode: e.target.value })}
            className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
          >
            <option value="shift-report">Сменный отчёт</option>
            <option value="cash-desk">Кассовое место</option>
            <option value="universal">Универсальный режим</option>
            <option value="debts">Долги и доп. операции</option>
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">Заметка</span>
          <input
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
            className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
            placeholder="Необязательно"
          />
        </label>
      </div>

      <div className="space-y-2 text-sm">
        <span className="text-muted-foreground">Точки в проекте</span>
        <CompanySelect
          allCompanies={allCompanies}
          selectedIds={form.company_ids}
          onChange={(ids) => onChange({ ...form, company_ids: ids })}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {([
          ['shift_report', 'Сменные отчёты', 'Форма смены: наличные, Kaspi, итоги → Telegram и salary.'],
          ['income_report', 'Доходы', 'Отдельная форма доходов. Зарезервировано.'],
          ['debt_report', 'Долги и сканер', 'Включает страницу сканера: запись долгов и штрихкодов.'],
        ] as [string, string, string][]).map(([key, label, hint]) => (
          <label
            key={key}
            className="flex flex-col gap-1.5 cursor-pointer rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.feature_flags[key as keyof PointFeatureFlags]}
                onChange={(e) =>
                  onChange({
                    ...form,
                    feature_flags: { ...form.feature_flags, [key]: e.target.checked },
                  })
                }
                className="rounded border-white/10 bg-background"
              />
              <span className="font-medium">{label}</span>
            </div>
            <p className="pl-6 text-xs leading-relaxed text-muted-foreground">{hint}</p>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
        )}
        <Button onClick={onSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить
        </Button>
      </div>
    </div>
  )
}

export default function PointDevicesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [projects, setProjects] = useState<PointProject[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [newProject, setNewProject] = useState<ProjectForm>(DEFAULT_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState<ProjectForm>(DEFAULT_FORM)
  const [revealedTokens, setRevealedTokens] = useState<Record<string, boolean>>({})

  async function loadData() {
    setLoading(true)
    setError(null)
    const response = await fetch('/api/admin/point-devices', { cache: 'no-store' })
    const data = (await response.json().catch(() => null)) as ProjectsResponse | null

    if (!response.ok || !data?.ok || !data.data) {
      setError(data?.error || 'Не удалось загрузить проекты')
      setLoading(false)
      return
    }

    setCompanies(data.data.companies || [])
    setProjects(data.data.projects || [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  async function mutate(payload: unknown) {
    const response = await fetch('/api/admin/point-devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error || `Ошибка (${response.status})`)
    return data
  }

  async function handleCreate() {
    if (!newProject.name.trim()) { setError('Укажите название проекта'); return }
    if (newProject.company_ids.length === 0) { setError('Добавьте хотя бы одну точку'); return }

    setSaving(true); setError(null); setSuccess(null)
    try {
      await mutate({
        action: 'createProject',
        payload: {
          ...newProject,
          shift_report_chat_id: newProject.shift_report_chat_id || null,
          notes: newProject.notes || null,
        },
      })
      setNewProject(DEFAULT_FORM)
      await loadData()
      setSuccess('Проект создан')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(project: PointProject) {
    setEditingId(project.id)
    setEditingForm({
      name: project.name,
      point_mode: project.point_mode,
      company_ids: project.companies.map((c) => c.id),
      shift_report_chat_id: project.shift_report_chat_id || '',
      notes: project.notes || '',
      feature_flags: {
        shift_report: project.feature_flags.shift_report !== false,
        income_report: project.feature_flags.income_report !== false,
        debt_report: project.feature_flags.debt_report === true,
        kaspi_daily_split: project.feature_flags.kaspi_daily_split === true,
      },
    })
  }

  async function handleUpdate(projectId: string) {
    if (!editingForm.name.trim()) { setError('Укажите название проекта'); return }
    if (editingForm.company_ids.length === 0) { setError('Добавьте хотя бы одну точку'); return }

    setSaving(true); setError(null); setSuccess(null)
    try {
      await mutate({
        action: 'updateProject',
        projectId,
        payload: {
          ...editingForm,
          shift_report_chat_id: editingForm.shift_report_chat_id || null,
          notes: editingForm.notes || null,
        },
      })
      setEditingId(null)
      await loadData()
      setSuccess('Проект обновлён')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRotate(projectId: string) {
    setSaving(true); setError(null); setSuccess(null)
    try {
      const data = await mutate({ action: 'rotateProjectToken', projectId })
      await loadData()
      setRevealedTokens((prev) => ({ ...prev, [projectId]: true }))
      setSuccess(`Новый token: ${data?.data?.project_token || 'обновлён'}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(projectId: string, nextActive: boolean) {
    setSaving(true); setError(null); setSuccess(null)
    try {
      await mutate({ action: 'toggleProjectActive', projectId, is_active: nextActive })
      await loadData()
      setSuccess(nextActive ? 'Проект активирован' : 'Проект выключен')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(projectId: string) {
    if (!confirm('Удалить проект? Токен перестанет работать.')) return
    setSaving(true); setError(null); setSuccess(null)
    try {
      await mutate({ action: 'deleteProject', projectId })
      await loadData()
      setSuccess('Проект удалён')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token)
      setSuccess('Token скопирован')
    } catch {
      setError('Не удалось скопировать token')
    }
  }

  return (
    <div className="app-page max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3">
            <FolderOpen className="h-7 w-7 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Проекты точек</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Один токен — несколько точек. Оператор выбирает точку при входе.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Обновить
        </Button>
      </div>

      {error ? (
        <Card className="border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card>
      ) : null}
      {success ? (
        <Card className="border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">{success}</Card>
      ) : null}

      {/* Create form */}
      <Card className="border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="h-4 w-4 text-cyan-300" />
          <h2 className="text-lg font-semibold text-foreground">Новый проект</h2>
        </div>
        <ProjectFormPanel
          title=""
          form={newProject}
          allCompanies={companies}
          saving={saving}
          onSave={handleCreate}
          onChange={setNewProject}
        />
      </Card>

      {/* Projects list */}
      <div className="space-y-4">
        {loading ? (
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">Загрузка...</Card>
        ) : projects.length === 0 ? (
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
            Проектов пока нет.
          </Card>
        ) : (
          projects.map((project) => {
            const isEditing = editingId === project.id
            const tokenVisible = revealedTokens[project.id] === true

            return (
              <Card key={project.id} className="border-border bg-card p-5">
                {isEditing ? (
                  <ProjectFormPanel
                    title={`Редактировать: ${project.name}`}
                    form={editingForm}
                    allCompanies={companies}
                    saving={saving}
                    onSave={() => handleUpdate(project.id)}
                    onCancel={() => setEditingId(null)}
                    onChange={setEditingForm}
                  />
                ) : (
                  <>
                    {/* Header */}
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-foreground">{project.name}</h2>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-muted-foreground">
                            {MODE_LABELS[project.point_mode] || project.point_mode}
                          </span>
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] ${
                              project.is_active
                                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                : 'border border-red-500/20 bg-red-500/10 text-red-300'
                            }`}
                          >
                            {project.is_active ? 'Активен' : 'Выключен'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded-lg border border-white/10 bg-background/70 px-2 py-1 text-muted-foreground">
                            Последняя связь: {formatDateTime(project.last_seen_at)}
                          </span>
                          <span className="rounded-lg border border-white/10 bg-background/70 px-2 py-1 text-muted-foreground">
                            Создан: {formatDateTime(project.created_at)}
                          </span>
                        </div>
                        {project.notes ? (
                          <p className="text-sm text-muted-foreground">{project.notes}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => startEdit(project)} className="gap-2">
                          <Pencil className="h-4 w-4" />
                          Изменить
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleRotate(project.id)} className="gap-2">
                          <RefreshCw className="h-4 w-4" />
                          Новый token
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToggle(project.id, !project.is_active)}
                          className="gap-2"
                        >
                          <Power className="h-4 w-4" />
                          {project.is_active ? 'Выключить' : 'Включить'}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(project.id)} className="gap-2">
                          <Trash2 className="h-4 w-4" />
                          Удалить
                        </Button>
                      </div>
                    </div>

                    {/* Companies + token + features */}
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_1fr]">
                      {/* Companies */}
                      <div className="rounded-xl border border-white/10 bg-background/70 p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Точки ({project.companies.length})
                        </p>
                        <div className="space-y-1">
                          {project.companies.map((c) => (
                            <div key={c.id} className="flex items-center gap-2 text-sm text-foreground">
                              <Building2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                              <span className="truncate">{c.name}{c.code ? ` (${c.code})` : ''}</span>
                            </div>
                          ))}
                          {project.companies.length === 0 && (
                            <p className="text-xs text-amber-400">Нет точек</p>
                          )}
                        </div>
                      </div>

                      {/* Token */}
                      <div className="rounded-xl border border-white/10 bg-background/70 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Project token
                          </span>
                          <div className="flex gap-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() =>
                                setRevealedTokens((prev) => ({
                                  ...prev,
                                  [project.id]: !prev[project.id],
                                }))
                              }
                            >
                              {tokenVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => copyToken(project.project_token)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <code className="block break-all rounded-lg bg-black/40 px-3 py-2 text-xs text-cyan-200">
                          {tokenVisible
                            ? project.project_token
                            : `${project.project_token.slice(0, 6)}••••••••••${project.project_token.slice(-6)}`}
                        </code>
                      </div>

                      {/* Feature flags */}
                      <div className="grid gap-2 content-start">
                        {([
                          ['shift_report', 'Сменные отчёты'],
                          ['income_report', 'Доходы'],
                          ['debt_report', 'Долги и сканер'],
                        ] as [string, string][]).map(([key, label]) => (
                          <div
                            key={key}
                            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                              project.feature_flags[key as keyof PointFeatureFlags]
                                ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200'
                                : 'border-white/10 bg-white/5 text-muted-foreground line-through opacity-40'
                            }`}
                          >
                            <span>{label}</span>
                            <ShieldCheck className="h-4 w-4" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
