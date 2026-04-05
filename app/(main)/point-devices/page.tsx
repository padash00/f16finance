'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Monitor,
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

type CompanyAssignment = {
  company_id: string
  point_mode: string    // '' = inherit from project
  feature_flags: {
    debt_report: boolean | null       // null = inherit
    kaspi_daily_split: boolean | null // null = inherit
    arena_enabled: boolean | null     // null = inherit
    arena_shift_auto_totals: boolean | null // null = inherit — сводка смены из сессий арены
  }
}

type ProjectCompany = Company & {
  point_mode: string | null
  feature_flags: Partial<PointFeatureFlags> | null
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
  companies: ProjectCompany[]
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
  company_assignments: CompanyAssignment[]
  shift_report_chat_id: string
  notes: string
  feature_flags: PointFeatureFlags
}

const DEFAULT_FLAGS: PointFeatureFlags = {
  shift_report: true,
  income_report: true,
  debt_report: false,
  kaspi_daily_split: false,
}

const DEFAULT_FORM: ProjectForm = {
  name: '',
  point_mode: 'shift-report',
  company_assignments: [],
  shift_report_chat_id: '',
  notes: '',
  feature_flags: { ...DEFAULT_FLAGS },
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

function emptyAssignment(company_id: string): CompanyAssignment {
  return {
    company_id,
    point_mode: '',
    feature_flags: {
      debt_report: null,
      kaspi_daily_split: null,
      arena_enabled: null,
      arena_shift_auto_totals: null,
    },
  }
}

function CompanyAssignmentEditor({
  allCompanies,
  assignments,
  projectMode,
  projectFlags,
  onChange,
}: {
  allCompanies: Company[]
  assignments: CompanyAssignment[]
  projectMode: string
  projectFlags: PointFeatureFlags
  onChange: (assignments: CompanyAssignment[]) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const selectedIds = new Set(assignments.map((a) => a.company_id))

  function toggle(companyId: string) {
    if (selectedIds.has(companyId)) {
      onChange(assignments.filter((a) => a.company_id !== companyId))
    } else {
      onChange([...assignments, emptyAssignment(companyId)])
    }
  }

  function updateAssignment(companyId: string, patch: Partial<CompanyAssignment>) {
    onChange(assignments.map((a) => a.company_id === companyId ? { ...a, ...patch } : a))
  }

  function updateFlag(
    companyId: string,
    key: 'debt_report' | 'kaspi_daily_split' | 'arena_enabled' | 'arena_shift_auto_totals',
    value: boolean | null,
  ) {
    onChange(assignments.map((a) =>
      a.company_id === companyId
        ? { ...a, feature_flags: { ...a.feature_flags, [key]: value } }
        : a
    ))
  }

  return (
    <div className="space-y-2">
      {allCompanies.map((c) => {
        const selected = selectedIds.has(c.id)
        const assignment = assignments.find((a) => a.company_id === c.id)
        const isExpanded = expanded[c.id] === true
        const hasOverride = assignment && (
          (assignment.point_mode && assignment.point_mode !== '') ||
          assignment.feature_flags.debt_report !== null ||
          assignment.feature_flags.kaspi_daily_split !== null ||
          assignment.feature_flags.arena_enabled !== null ||
          assignment.feature_flags.arena_shift_auto_totals !== null
        )

        return (
          <div
            key={c.id}
            className={`rounded-xl border transition ${
              selected
                ? 'border-cyan-500/30 bg-cyan-500/5'
                : 'border-white/10 bg-black/20'
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => toggle(c.id)}
                className={`flex flex-1 items-center gap-2 text-sm text-left ${
                  selected ? 'text-cyan-200' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-medium">{c.name}{c.code ? ` (${c.code})` : ''}</span>
                {hasOverride && (
                  <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                    своя настройка
                  </span>
                )}
              </button>
              {selected && (
                <>
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                    className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Настройки
                  </button>
                  <button type="button" onClick={() => toggle(c.id)}>
                    <X className="h-3.5 w-3.5 text-cyan-400 hover:text-red-400" />
                  </button>
                </>
              )}
            </div>

            {selected && isExpanded && assignment && (
              <div className="border-t border-white/10 px-3 pb-3 pt-2 space-y-3">
                <div className="text-[11px] text-muted-foreground">
                  Оставь «Наследовать» чтобы использовать настройки проекта
                </div>

                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Режим точки</span>
                  <select
                    value={assignment.point_mode}
                    onChange={(e) => updateAssignment(c.id, { point_mode: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Наследовать от проекта ({MODE_LABELS[projectMode] || projectMode})</option>
                    <option value="shift-report">Сменный отчёт</option>
                    <option value="cash-desk">Кассовое место (магазин)</option>
                    <option value="universal">Универсальный режим</option>
                    <option value="debts">Долги и доп. операции</option>
                  </select>
                </label>

                <div className="space-y-1.5">
                  <span className="text-sm text-muted-foreground">Флаги (null = наследовать)</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      ['debt_report', 'Долги и сканер', projectFlags.debt_report],
                      ['kaspi_daily_split', 'Суточная сверка Kaspi', projectFlags.kaspi_daily_split],
                      ['arena_enabled', 'Арена / Станции', false],
                      ['arena_shift_auto_totals', 'Смена: авто из сессий арены', false],
                    ] as [keyof typeof assignment.feature_flags, string, boolean][]).map(([key, label, projectDefault]) => {
                      const val = assignment.feature_flags[key]
                      return (
                        <div key={key} className="rounded-xl border border-white/10 bg-black/20 p-2 text-xs">
                          <div className="mb-1.5 font-medium text-foreground">{label}</div>
                          <div className="flex gap-2">
                            {([
                              [null, `Проект (${projectDefault ? 'вкл' : 'выкл'})`],
                              [true, 'Включить'],
                              [false, 'Выключить'],
                            ] as [boolean | null, string][]).map(([v, lbl]) => (
                              <button
                                key={String(v)}
                                type="button"
                                onClick={() => updateFlag(c.id, key, v)}
                                className={`rounded-lg border px-2 py-1 transition ${
                                  val === v
                                    ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                                    : 'border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground'
                                }`}
                              >
                                {lbl}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
      {assignments.length === 0 && (
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
          <span className="text-muted-foreground">Режим по умолчанию</span>
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
        <CompanyAssignmentEditor
          allCompanies={allCompanies}
          assignments={form.company_assignments}
          projectMode={form.point_mode}
          projectFlags={form.feature_flags}
          onChange={(assignments) => onChange({ ...form, company_assignments: assignments })}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {([
          ['shift_report', 'Сменные отчёты', 'Форма смены: наличные, Kaspi, итоги → Telegram и salary.'],
          ['income_report', 'Доходы', 'Отдельная форма доходов. Зарезервировано.'],
          ['debt_report', 'Долги и сканер', 'По умолчанию для точек без своей настройки.'],
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

  useEffect(() => { loadData() }, [])

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

  function buildApiAssignments(assignments: CompanyAssignment[]) {
    return assignments.map((a) => {
      const hasMode = a.point_mode && a.point_mode !== ''
      const hasFlagDebt = a.feature_flags.debt_report !== null
      const hasFlagKaspi = a.feature_flags.kaspi_daily_split !== null
      const hasFlagArena = a.feature_flags.arena_enabled !== null
      const hasFlagArenaShiftAuto = a.feature_flags.arena_shift_auto_totals !== null
      return {
        company_id: a.company_id,
        point_mode: hasMode ? a.point_mode : null,
        feature_flags: (hasFlagDebt || hasFlagKaspi || hasFlagArena || hasFlagArenaShiftAuto)
          ? {
              shift_report: true,
              income_report: true,
              debt_report: a.feature_flags.debt_report ?? false,
              kaspi_daily_split: a.feature_flags.kaspi_daily_split ?? false,
              arena_enabled: a.feature_flags.arena_enabled ?? false,
              arena_shift_auto_totals: a.feature_flags.arena_shift_auto_totals ?? false,
            }
          : null,
      }
    })
  }

  async function handleCreate() {
    if (!newProject.name.trim()) { setError('Укажите название проекта'); return }
    if (newProject.company_assignments.length === 0) { setError('Добавьте хотя бы одну точку'); return }

    setSaving(true); setError(null); setSuccess(null)
    try {
      await mutate({
        action: 'createProject',
        payload: {
          name: newProject.name,
          point_mode: newProject.point_mode,
          company_assignments: buildApiAssignments(newProject.company_assignments),
          shift_report_chat_id: newProject.shift_report_chat_id || null,
          notes: newProject.notes || null,
          feature_flags: newProject.feature_flags,
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
      company_assignments: project.companies.map((c) => ({
        company_id: c.id,
        point_mode: c.point_mode || '',
        feature_flags: {
          debt_report: c.feature_flags?.debt_report ?? null,
          kaspi_daily_split: c.feature_flags?.kaspi_daily_split ?? null,
          arena_enabled: (c.feature_flags as any)?.arena_enabled ?? null,
          arena_shift_auto_totals: (c.feature_flags as any)?.arena_shift_auto_totals ?? null,
        },
      })),
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
    if (editingForm.company_assignments.length === 0) { setError('Добавьте хотя бы одну точку'); return }

    setSaving(true); setError(null); setSuccess(null)
    try {
      await mutate({
        action: 'updateProject',
        projectId,
        payload: {
          name: editingForm.name,
          point_mode: editingForm.point_mode,
          company_assignments: buildApiAssignments(editingForm.company_assignments),
          shift_report_chat_id: editingForm.shift_report_chat_id || null,
          notes: editingForm.notes || null,
          feature_flags: editingForm.feature_flags,
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
              Один токен — несколько точек. Каждой точке можно задать свой режим.
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
                        {project.companies.some((c) => (c.feature_flags as any)?.arena_enabled === true) ? (
                          <Button size="sm" variant="outline" asChild className="gap-2">
                            <a href={`/stations/${project.id}`}>
                              <Monitor className="h-4 w-4" />
                              Станции
                            </a>
                          </Button>
                        ) : null}
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

                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_1fr]">
                      {/* Companies */}
                      <div className="rounded-xl border border-white/10 bg-background/70 p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Точки ({project.companies.length})
                        </p>
                        <div className="space-y-1.5">
                          {project.companies.map((c) => (
                            <div key={c.id} className="space-y-0.5">
                              <div className="flex items-center gap-2 text-sm text-foreground">
                                <Building2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                                <span className="truncate">{c.name}{c.code ? ` (${c.code})` : ''}</span>
                              </div>
                              {c.point_mode && (
                                <div className="pl-5 text-[11px] text-amber-300">
                                  режим: {MODE_LABELS[c.point_mode] || c.point_mode}
                                </div>
                              )}
                              {c.feature_flags && (
                                <div className="pl-5 text-[11px] text-amber-300">
                                  {[
                                    c.feature_flags.debt_report === true && 'долги',
                                    c.feature_flags.kaspi_daily_split === true && 'kaspi-split',
                                    (c.feature_flags as any)?.arena_enabled === true && 'арена',
                                    (c.feature_flags as any)?.arena_shift_auto_totals === true && 'смена-арена-авто',
                                  ].filter(Boolean).join(', ') || null}
                                </div>
                              )}
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
