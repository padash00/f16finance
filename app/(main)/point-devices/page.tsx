'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { useCapabilities } from '@/lib/client/use-capabilities'
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
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
  start_cash_prompt: boolean
  arena_enabled: boolean
  arena_shift_auto_totals: boolean
  arena_defer_income_to_shift: boolean
}

type CompanyAssignment = {
  company_id: string
  point_mode: string    // '' = inherit from project
  feature_flags: Record<keyof PointFeatureFlags, boolean | null>
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
  start_cash_prompt: false,
  arena_enabled: false,
  arena_shift_auto_totals: false,
  arena_defer_income_to_shift: false,
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

const PROJECT_FLAG_OPTIONS: Array<{
  key: keyof PointFeatureFlags
  label: string
  hint: string
}> = [
  {
    key: 'shift_report',
    label: 'Сменные отчёты',
    hint: 'Форма смены: наличные, Безналичный, итоги → Telegram и зарплата.',
  },
  {
    key: 'income_report',
    label: 'Доходы',
    hint: 'Отдельная форма доходов в операторке.',
  },
  {
    key: 'debt_report',
    label: 'Долги и сканер',
    hint: 'Сканер долгов и товарные операции для подходящих режимов.',
  },
  {
    key: 'kaspi_daily_split',
    label: 'Суточная сверка Безналичный',
    hint: 'Для ночной смены: Безналичный до 00:00 и после 00:00.',
  },
  {
    key: 'start_cash_prompt',
    label: 'Старт кассы',
    hint: 'При входе оператор указывает мелочь на начало смены.',
  },
  {
    key: 'arena_enabled',
    label: 'Арена / станции',
    hint: 'Открывает экран станций, тарифов и игровых сессий.',
  },
  {
    key: 'arena_shift_auto_totals',
    label: 'Автоитоги арены',
    hint: 'Резерв под автоматическую сводку смены из сессий арены.',
  },
  {
    key: 'arena_defer_income_to_shift',
    label: 'Арена без авто-доходов',
    hint: 'Не пишет доход при старте тарифа, учёт идёт через сменный отчёт.',
  },
]

const POINT_OVERRIDE_OPTIONS = PROJECT_FLAG_OPTIONS.filter((option) => option.key !== 'shift_report' && option.key !== 'income_report')

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
      shift_report: null,
      income_report: null,
      debt_report: null,
      kaspi_daily_split: null,
      start_cash_prompt: null,
      arena_enabled: null,
      arena_shift_auto_totals: null,
      arena_defer_income_to_shift: null,
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
    key: keyof PointFeatureFlags,
    value: boolean | null,
  ) {
    onChange(assignments.map((a) =>
      a.company_id === companyId
        ? { ...a, feature_flags: { ...a.feature_flags, [key]: value } }
        : a
    ))
  }

  const selectedCompanies = allCompanies.filter((company) => selectedIds.has(company.id))
  const availableCompanies = allCompanies.filter((company) => !selectedIds.has(company.id))
  const orderedCompanies = [...selectedCompanies, ...availableCompanies]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-slate-50 dark:bg-black/20 px-3 py-2 text-xs text-muted-foreground">
        <span>
          В проекте: <b className="text-amber-700 dark:text-amber-200">{assignments.length}</b> из {allCompanies.length} точек
        </span>
        <span>Нажми «Добавить» или «Убрать», а «Настройки» откроют режимы конкретной точки.</span>
      </div>

      {orderedCompanies.map((c) => {
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
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-border bg-slate-50 dark:bg-black/20'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => toggle(c.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 text-sm text-left ${
                  selected ? 'text-amber-700 dark:text-amber-200' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-medium">{c.name}{c.code ? ` (${c.code})` : ''}</span>
                {hasOverride && (
                  <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                    своя настройка
                  </span>
                )}
              </button>
              {selected ? (
                <>
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Настройки
                  </button>
                  <button type="button" onClick={() => toggle(c.id)}>
                    <X className="h-3.5 w-3.5 text-amber-400 hover:text-red-400" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/15"
                >
                  + Добавить
                </button>
              )}
            </div>

            {selected && isExpanded && assignment && (
              <div className="border-t border-border px-3 pb-3 pt-2 space-y-3">
                <div className="text-[11px] text-muted-foreground">
                  Оставь «Наследовать» чтобы использовать настройки проекта
                </div>

                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Режим точки</span>
                  <select
                    value={assignment.point_mode}
                    onChange={(e) => updateAssignment(c.id, { point_mode: e.target.value })}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Наследовать от проекта ({MODE_LABELS[projectMode] || projectMode})</option>
                    <option value="shift-report">Сменный отчёт</option>
                    <option value="cash-desk">Кассовое место (магазин)</option>
                    <option value="universal">Универсальный режим</option>
                    <option value="debts">Долги и доп. операции</option>
                  </select>
                </label>

                <div className="space-y-1.5">
                  <span className="text-sm text-muted-foreground">Что включено на этой точке</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {POINT_OVERRIDE_OPTIONS.map(({ key, label, hint }) => {
                      const projectDefault = projectFlags[key] === true
                      const val = assignment.feature_flags[key]
                      return (
                        <div key={key} className="rounded-xl border border-border bg-slate-50 dark:bg-black/20 p-2 text-xs">
                          <div className="mb-1.5 font-medium text-foreground">{label}</div>
                          <p className="mb-2 min-h-8 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
                          <div className="flex flex-wrap gap-2">
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
                                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200'
                                    : 'border-border text-muted-foreground hover:border-slate-300 dark:hover:border-white/20 hover:text-foreground'
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
            className="w-full rounded-xl border border-border bg-background px-3 py-2"
            placeholder="F16, Arena, Восток..."
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">Режим по умолчанию</span>
          <select
            value={form.point_mode}
            onChange={(e) => onChange({ ...form, point_mode: e.target.value })}
            className="w-full rounded-xl border border-border bg-background px-3 py-2"
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
            className="w-full rounded-xl border border-border bg-background px-3 py-2"
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

      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium text-foreground">Функции проекта по умолчанию</p>
          <p className="text-xs text-muted-foreground">
            Эти настройки наследуют все точки проекта. Внутри конкретной точки можно сделать исключение.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PROJECT_FLAG_OPTIONS.map(({ key, label, hint }) => (
          <label
            key={key}
            className="flex flex-col gap-1.5 cursor-pointer rounded-xl border border-border bg-slate-50 dark:bg-black/20 px-3 py-3 text-sm"
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
                className="rounded border-border bg-background"
              />
              <span className="font-medium">{label}</span>
            </div>
            <p className="pl-6 text-xs leading-relaxed text-muted-foreground">{hint}</p>
          </label>
          ))}
        </div>
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
  const { can } = useCapabilities()
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
      const featureFlags = Object.fromEntries(
        Object.entries(a.feature_flags).filter(([, value]) => value !== null),
      )
      return {
        company_id: a.company_id,
        point_mode: hasMode ? a.point_mode : null,
        feature_flags: Object.keys(featureFlags).length > 0 ? featureFlags : null,
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
          shift_report: (c.feature_flags as any)?.shift_report ?? null,
          income_report: (c.feature_flags as any)?.income_report ?? null,
          debt_report: c.feature_flags?.debt_report ?? null,
          kaspi_daily_split: c.feature_flags?.kaspi_daily_split ?? null,
          start_cash_prompt: (c.feature_flags as any)?.start_cash_prompt ?? null,
          arena_enabled: (c.feature_flags as any)?.arena_enabled ?? null,
          arena_shift_auto_totals: (c.feature_flags as any)?.arena_shift_auto_totals ?? null,
          arena_defer_income_to_shift: (c.feature_flags as any)?.arena_defer_income_to_shift ?? null,
        },
      })),
      shift_report_chat_id: project.shift_report_chat_id || '',
      notes: project.notes || '',
      feature_flags: {
        shift_report: project.feature_flags.shift_report !== false,
        income_report: project.feature_flags.income_report !== false,
        debt_report: project.feature_flags.debt_report === true,
        kaspi_daily_split: project.feature_flags.kaspi_daily_split === true,
        start_cash_prompt: project.feature_flags.start_cash_prompt === true,
        arena_enabled: project.feature_flags.arena_enabled === true,
        arena_shift_auto_totals: project.feature_flags.arena_shift_auto_totals === true,
        arena_defer_income_to_shift: project.feature_flags.arena_defer_income_to_shift === true,
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
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Проекты точек"
        description="Один токен — несколько точек. Каждой точке можно задать свой режим."
        icon={<FolderOpen className="h-5 w-5" />}
        accent="blue"
        backHref="/"
        actions={
          <Button variant="outline" onClick={loadData} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Обновить
          </Button>
        }
      />

      {/* Операторская программа — скачивание + инструкция */}
      <Card className="border-border bg-gradient-to-br from-blue-50 to-white dark:from-blue-500/[0.07] dark:to-transparent p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-blue-400/30 bg-blue-500/15">
              <Monitor className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            </span>
            <div>
              <div className="text-base font-semibold text-foreground">Операторская программа</div>
              <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
                Касса для операторов: смены, продажи, долги, чеки. Установите на компьютер точки и введите токен проекта (ниже).
              </p>
              <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-slate-500">
                <li>Скачайте и установите программу на ПК точки.</li>
                <li>При первом запуске введите <b className="text-body">токен проекта</b> (кнопка «глаз» у проекта ниже).</li>
                <li>Выберите точку — и можно работать.</li>
              </ol>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <a
              href={process.env.NEXT_PUBLIC_OPERATOR_DOWNLOAD_URL || 'https://github.com/padash00/f16finance/releases/latest'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              <Download className="h-4 w-4" /> Операторская (касса)
            </a>
            <a
              href={process.env.NEXT_PUBLIC_KIOSK_DOWNLOAD_URL || 'https://github.com/padash00/f16finance/releases/latest'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-4 py-2.5 text-sm font-medium text-body transition hover:bg-slate-200 dark:hover:bg-white/10"
            >
              <Monitor className="h-4 w-4" /> Киоск (станции)
            </a>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">{error}</Card>
      ) : null}
      {success ? (
        <Card className="border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-200">{success}</Card>
      ) : null}

      {/* Create form */}
      {can('point-devices.create') && (
        <Card className="border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Plus className="h-4 w-4 text-amber-300" />
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
      )}

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
                          <span className="rounded-full border border-border bg-slate-100 dark:bg-white/5 px-2 py-1 text-[11px] text-muted-foreground">
                            {MODE_LABELS[project.point_mode] || project.point_mode}
                          </span>
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] ${
                              project.is_active
                                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
                            }`}
                          >
                            {project.is_active ? 'Активен' : 'Выключен'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded-lg border border-border bg-background/70 px-2 py-1 text-muted-foreground">
                            Последняя связь: {formatDateTime(project.last_seen_at)}
                          </span>
                          <span className="rounded-lg border border-border bg-background/70 px-2 py-1 text-muted-foreground">
                            Создан: {formatDateTime(project.created_at)}
                          </span>
                        </div>
                        {project.notes ? (
                          <p className="text-sm text-muted-foreground">{project.notes}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {can('point-devices.edit') && (
                          <Button size="sm" variant="outline" onClick={() => startEdit(project)} className="gap-2">
                            <Pencil className="h-4 w-4" />
                            Изменить
                          </Button>
                        )}
                        {project.companies.some((c) => (c.feature_flags as any)?.arena_enabled === true) ? (
                          <Button size="sm" variant="outline" asChild className="gap-2">
                            <Link href={`/stations/${project.id}`}>
                              <Monitor className="h-4 w-4" />
                              Станции
                            </Link>
                          </Button>
                        ) : null}
                        {can('point-devices.rotate_token') && (
                          <Button size="sm" variant="outline" onClick={() => handleRotate(project.id)} className="gap-2">
                            <RefreshCw className="h-4 w-4" />
                            Новый token
                          </Button>
                        )}
                        {can('point-devices.toggle_active') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggle(project.id, !project.is_active)}
                            className="gap-2"
                          >
                            <Power className="h-4 w-4" />
                            {project.is_active ? 'Выключить' : 'Включить'}
                          </Button>
                        )}
                        {can('point-devices.delete') && (
                          <Button size="sm" variant="destructive" onClick={() => handleDelete(project.id)} className="gap-2">
                            <Trash2 className="h-4 w-4" />
                            Удалить
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_1fr]">
                      {/* Companies */}
                      <div className="rounded-xl border border-border bg-background/70 p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Точки ({project.companies.length})
                        </p>
                        <div className="space-y-1.5">
                          {project.companies.map((c) => (
                            <div key={c.id} className="space-y-0.5">
                              <div className="flex items-center gap-2 text-sm text-foreground">
                                <Building2 className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                <span className="truncate">{c.name}{c.code ? ` (${c.code})` : ''}</span>
                              </div>
                              {c.point_mode && (
                                <div className="pl-5 text-[11px] text-amber-700 dark:text-amber-300">
                                  режим: {MODE_LABELS[c.point_mode] || c.point_mode}
                                </div>
                              )}
                              {c.feature_flags && (
                                <div className="pl-5 text-[11px] text-amber-700 dark:text-amber-300">
                                  {[
                                    c.feature_flags.shift_report === true && 'смены',
                                    c.feature_flags.income_report === true && 'доходы',
                                    c.feature_flags.debt_report === true && 'долги',
                                    c.feature_flags.kaspi_daily_split === true && 'kaspi-split',
                                    (c.feature_flags as any)?.start_cash_prompt === true && 'старт кассы',
                                    (c.feature_flags as any)?.arena_enabled === true && 'арена',
                                    (c.feature_flags as any)?.arena_shift_auto_totals === true && 'смена-арена-авто',
                                    (c.feature_flags as any)?.arena_defer_income_to_shift === true && 'арена без авто-доходов',
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
                      <div className="rounded-xl border border-border bg-background/70 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Project token
                          </span>
                          <div className="flex gap-2">
                            {can('point-devices.reveal_token') && (
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
                            )}
                            {can('point-devices.copy_token') && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => copyToken(project.project_token)}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <code className="block break-all rounded-lg bg-slate-100 dark:bg-black/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                          {tokenVisible
                            ? project.project_token
                            : `${project.project_token.slice(0, 6)}••••••••••${project.project_token.slice(-6)}`}
                        </code>
                      </div>

                      {/* Feature flags */}
                      <div className="grid gap-2 content-start">
                        {PROJECT_FLAG_OPTIONS.map(({ key, label }) => (
                          <div
                            key={key}
                            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                              project.feature_flags[key as keyof PointFeatureFlags]
                                ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                                : 'border-border bg-surface-muted text-muted-foreground line-through opacity-40'
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
