'use client'

import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import dynamic from 'next/dynamic'
import {
  AlertTriangle,
  BookOpen,
  ClipboardList,
  FileText,
  History,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'

import {
  emptyArticleValue,
  emptyCategoryValue,
  emptyChecklistItemValue,
  emptyChecklistTemplateValue,
  type ArticleEditorValue,
  type CategoryEditorValue,
  type ChecklistItemEditorValue,
  type ChecklistTemplateEditorValue,
} from '@/components/admin/knowledge-editor-types'
import { useCapabilities } from '@/lib/client/use-capabilities'

const ArticleEditorDialog = dynamic(
  () => import('@/components/admin/article-editor-dialog').then((mod) => ({ default: mod.ArticleEditorDialog })),
  { ssr: false },
)
const CategoryEditorDialog = dynamic(
  () => import('@/components/admin/category-editor-dialog').then((mod) => ({ default: mod.CategoryEditorDialog })),
  { ssr: false },
)
const ChecklistEditorDialog = dynamic(
  () => import('@/components/admin/checklist-editor-dialog').then((mod) => ({ default: mod.ChecklistEditorDialog })),
  { ssr: false },
)

type CategoryKind = 'rules' | 'faq' | 'salary' | 'problem' | 'checklist'

type KnowledgeCategory = {
  id: string
  company_id: string | null
  title: string
  slug: string
  description: string | null
  kind: CategoryKind
  sort_order: number
  is_active: boolean
}

type KnowledgeArticle = {
  id: string
  company_id: string | null
  category_id: string | null
  title: string
  slug: string
  summary: string | null
  content?: string
  tags: string[] | null
  audience: string[] | null
  severity: 'info' | 'normal' | 'warning' | 'critical'
  related_fine_amount: number | null
  related_bonus_amount: number | null
  is_published: boolean
  sort_order: number
  requires_confirmation: boolean | null
  version: number | null
}

type ChecklistTemplate = {
  id: string
  company_id: string | null
  title: string
  description: string | null
  role_scope: string
  shift_scope: string
  schedule_type: 'opening' | 'periodic' | 'closing' | 'onboarding' | 'handover'
  recurrence_minutes: number | null
  blocks_shift: boolean
  is_active: boolean
  sort_order: number
}

type ChecklistItem = {
  id: string
  template_id: string
  category_id: string | null
  knowledge_article_id: string | null
  title: string
  description: string | null
  answer_type: 'boolean' | 'text' | 'number' | 'photo' | 'choice'
  is_required: boolean
  requires_photo: boolean
  severity: 'info' | 'normal' | 'warning' | 'critical'
  fine_amount: number | null
  bonus_amount: number | null
  sort_order: number
}

type Company = {
  id: string
  name: string
}

type ChecklistRun = {
  id: string
  template_id: string
  shift_id: string | null
  run_by: string | null
  status: 'in_progress' | 'completed' | 'skipped' | 'failed'
  started_at: string | null
  completed_at: string | null
  fines_total: number | null
  bonuses_total: number | null
  template_title?: string
  company_id?: string | null
  company_name?: string | null
  shift_type?: string | null
  shift_status?: string | null
  shift_opened_at?: string | null
  run_by_name?: string | null
  co_signed_by_name?: string | null
  item_count?: number
  answered_count?: number
  failed_count?: number
  response_items?: ChecklistRunResponseItem[]
}

type ChecklistRunResponseItem = {
  id: string
  title: string
  is_required: boolean
  requires_photo: boolean
  severity: 'info' | 'normal' | 'warning' | 'critical'
  fine_amount: number | null
  bonus_amount: number | null
  answer_type: 'boolean' | 'text' | 'number' | 'photo' | 'choice'
  passed: boolean | null
  failed: boolean
  value: unknown
  note: string | null
  photo_data_url?: string | null
  photo_name?: string | null
  photo_captured_at?: string | null
}

type KnowledgeResponse = {
  categories: KnowledgeCategory[]
  articles: KnowledgeArticle[]
  templates: ChecklistTemplate[]
  items: ChecklistItem[]
  companies: Company[]
  runs: ChecklistRun[]
}

type Tab = 'articles' | 'checklists' | 'runs' | 'categories'

const KIND_LABELS: Record<CategoryKind, string> = {
  rules: 'Правила',
  faq: 'FAQ',
  salary: 'Зарплата',
  problem: 'Проблемы',
  checklist: 'Чек-лист',
}

const SEVERITY_LABELS = {
  info: 'Информация',
  normal: 'Обычно',
  warning: 'Важно',
  critical: 'Критично',
}

const AUDIENCE_OPTIONS = [
  { value: 'operator', label: 'Оператор' },
  { value: 'cashier', label: 'Кассир' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'owner', label: 'Owner' },
  { value: 'client', label: 'Клиент (киоск)' },
  { value: 'public', label: 'Публично' },
  { value: 'kiosk', label: 'Киоск' },
] as const

const SCHEDULE_TYPE_LABELS: Record<string, string> = {
  opening: 'Открытие',
  periodic: 'Обход (по расписанию)',
  closing: 'Закрытие',
  onboarding: 'Онбординг',
  handover: 'Передача',
}

const RUN_STATUS_LABELS: Record<ChecklistRun['status'], string> = {
  in_progress: 'В работе',
  completed: 'Завершён',
  skipped: 'Пропущен',
  failed: 'Провален',
}

const CHECKLIST_PRESETS = [
  {
    title: 'Открытие смены',
    description: 'Оператор подтверждает готовность точки: касса, чистота, техника, товар, Telegram-отчёт.',
    schedule_type: 'opening' as const,
    shift_scope: 'opening',
    role_scope: 'operator',
    recurrence_minutes: '',
    blocks_shift: true,
  },
  {
    title: 'Обход зала',
    description: 'Повторная проверка клуба или магазина по расписанию: порядок, клиенты, техника, склад.',
    schedule_type: 'periodic' as const,
    shift_scope: 'any',
    role_scope: 'operator',
    recurrence_minutes: 120,
    blocks_shift: false,
  },
  {
    title: 'Закрытие смены',
    description: 'Контроль закрытия: касса, отчёт, долг/сканер, уборка, выключение оборудования.',
    schedule_type: 'closing' as const,
    shift_scope: 'closing',
    role_scope: 'operator',
    recurrence_minutes: '',
    blocks_shift: true,
  },
  {
    title: 'Онбординг нового оператора',
    description: 'Первый проход по правилам, штрафам, бонусам, FAQ и технике безопасности.',
    schedule_type: 'onboarding' as const,
    shift_scope: 'any',
    role_scope: 'operator',
    recurrence_minutes: '',
    blocks_shift: true,
  },
] as const

function normalizeKnowledgeResponse(payload: Partial<KnowledgeResponse> | null | undefined): KnowledgeResponse {
  return {
    categories: Array.isArray(payload?.categories) ? payload.categories : [],
    articles: Array.isArray(payload?.articles) ? payload.articles : [],
    templates: Array.isArray(payload?.templates) ? payload.templates : [],
    items: Array.isArray(payload?.items) ? payload.items : [],
    companies: Array.isArray(payload?.companies) ? payload.companies : [],
    runs: Array.isArray(payload?.runs) ? payload.runs : [],
  }
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function moneyOrNull(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric) : null
}

function normalizeId(value: string | null | undefined) {
  return value && value.trim() ? value : null
}

function formatMoney(value: number | null | undefined) {
  if (!value) return null
  return `${new Intl.NumberFormat('ru-KZ').format(value)} ₸`
}

function formatMoneyText(value: number | null | undefined) {
  return formatMoney(value) || '0 ₸'
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((existing) => existing.id === item.id)
  if (index === -1) return [...list, item]
  const next = list.slice()
  next[index] = item
  return next
}

function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id)
}

function sortBySortOrderTitle<T extends { sort_order: number; title: string }>(list: T[]): T[] {
  return list.slice().sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-400/80 focus:ring-2 focus:ring-amber-400/15 ${props.className ?? ''}`}
    />
  )
}

export default function KnowledgeAdminPage() {
  const { can } = useCapabilities()
  const [data, setData] = useState<KnowledgeResponse>({
    categories: [],
    articles: [],
    templates: [],
    items: [],
    companies: [],
    runs: [],
  })
  const [tab, setTab] = useState<Tab>('articles')
  const [query, setQuery] = useState('')
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'info' | 'normal' | 'warning' | 'critical'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'published' | 'draft' | 'confirmation'>('all')
  const [filterCompany, setFilterCompany] = useState<string>('all')
  const [checklistScheduleFilter, setChecklistScheduleFilter] = useState<'all' | ChecklistTemplate['schedule_type']>('all')
  const [runStatusFilter, setRunStatusFilter] = useState<'all' | ChecklistRun['status']>('all')
  const [runEvidenceFilter, setRunEvidenceFilter] = useState<'all' | 'missing-photo' | 'with-problems'>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [categoryDialogValue, setCategoryDialogValue] = useState<CategoryEditorValue | undefined>(undefined)
  const [checklistDialogOpen, setChecklistDialogOpen] = useState(false)
  const [checklistDialogMode, setChecklistDialogMode] = useState<'template' | 'item'>('template')
  const [checklistTemplateValue, setChecklistTemplateValue] = useState<ChecklistTemplateEditorValue | undefined>(undefined)
  const [checklistItemValue, setChecklistItemValue] = useState<ChecklistItemEditorValue | undefined>(undefined)
  const [articleDialogOpen, setArticleDialogOpen] = useState(false)
  const [articleDialogValue, setArticleDialogValue] = useState<ArticleEditorValue | undefined>(undefined)

  const categoryById = useMemo(() => {
    return new Map(data.categories.map((category) => [category.id, category]))
  }, [data.categories])

  const companyById = useMemo(() => {
    return new Map(data.companies.map((company) => [company.id, company]))
  }, [data.companies])

  const articleById = useMemo(() => {
    return new Map(data.articles.map((article) => [article.id, article]))
  }, [data.articles])

  const itemsByTemplate = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>()
    for (const item of data.items) {
      const list = map.get(item.template_id) ?? []
      list.push(item)
      map.set(item.template_id, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order)
    }
    return map
  }, [data.items])

  const filteredArticles = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.articles.filter((article) => {
      if (filterSeverity !== 'all' && article.severity !== filterSeverity) return false
      if (filterStatus === 'published' && !article.is_published) return false
      if (filterStatus === 'draft' && article.is_published) return false
      if (filterStatus === 'confirmation' && !article.requires_confirmation) return false
      if (filterCompany === 'global' && article.company_id) return false
      if (filterCompany !== 'all' && filterCompany !== 'global' && article.company_id !== filterCompany) return false
      if (!needle) return true
      return [article.title, article.summary, article.tags?.join(' ')]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    })
  }, [data.articles, query, filterSeverity, filterStatus, filterCompany])

  const articlesByCategory = useMemo(() => {
    const groups = new Map<string, KnowledgeArticle[]>()
    for (const article of filteredArticles) {
      const key = article.category_id || '__none__'
      const list = groups.get(key) ?? []
      list.push(article)
      groups.set(key, list)
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
    }
    const ordered: { id: string | null; title: string; articles: KnowledgeArticle[] }[] = []
    for (const category of data.categories) {
      const list = groups.get(category.id)
      if (list && list.length) {
        ordered.push({ id: category.id, title: category.title, articles: list })
      }
    }
    const orphans = groups.get('__none__')
    if (orphans && orphans.length) {
      ordered.push({ id: null, title: 'Без категории', articles: orphans })
    }
    return ordered
  }, [filteredArticles, data.categories])

  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.templates
      .filter((template) => {
        if (checklistScheduleFilter !== 'all' && template.schedule_type !== checklistScheduleFilter) return false
        if (filterCompany === 'global' && template.company_id) return false
        if (filterCompany !== 'all' && filterCompany !== 'global' && template.company_id !== filterCompany) return false
        if (!needle) return true
        const itemsText = (itemsByTemplate.get(template.id) ?? [])
          .map((item) => [item.title, item.description].filter(Boolean).join(' '))
          .join(' ')
        return [template.title, template.description, itemsText]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
      })
      .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
  }, [data.templates, query, checklistScheduleFilter, filterCompany, itemsByTemplate])

  const templatesBySchedule = useMemo(() => {
    const groups = new Map<string, ChecklistTemplate[]>()
    for (const template of filteredTemplates) {
      const list = groups.get(template.schedule_type) ?? []
      list.push(template)
      groups.set(template.schedule_type, list)
    }
    return Object.entries(SCHEDULE_TYPE_LABELS)
      .map(([id, title]) => ({ id, title, templates: groups.get(id) ?? [] }))
      .filter((group) => group.templates.length > 0)
  }, [filteredTemplates])

  const filteredRuns = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.runs.filter((run) => {
      if (filterCompany === 'global' && run.company_id) return false
      if (filterCompany !== 'all' && filterCompany !== 'global' && run.company_id !== filterCompany) return false
      if (runStatusFilter !== 'all' && run.status !== runStatusFilter) return false
      if (runEvidenceFilter === 'with-problems' && Number(run.failed_count || 0) <= 0) return false
      if (
        runEvidenceFilter === 'missing-photo' &&
        !(run.response_items || []).some((item) => item.requires_photo && !item.photo_data_url)
      ) {
        return false
      }
      if (!needle) return true
      return [run.template_title, run.company_name, run.run_by_name, run.co_signed_by_name, run.status, run.shift_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    })
  }, [data.runs, query, filterCompany, runStatusFilter, runEvidenceFilter])

  const runStats = useMemo(() => {
    const responseItems = filteredRuns.flatMap((run) => run.response_items || [])
    return {
      total: filteredRuns.length,
      completed: filteredRuns.filter((run) => run.status === 'completed').length,
      inProgress: filteredRuns.filter((run) => run.status === 'in_progress').length,
      failedItems: filteredRuns.reduce((sum, run) => sum + Number(run.failed_count || 0), 0),
      withPhotos: responseItems.filter((item) => item.photo_data_url).length,
      missingPhotos: responseItems.filter((item) => item.requires_photo && !item.photo_data_url).length,
      finesTotal: filteredRuns.reduce((sum, run) => sum + Number(run.fines_total || 0), 0),
      bonusesTotal: filteredRuns.reduce((sum, run) => sum + Number(run.bonuses_total || 0), 0),
    }
  }, [filteredRuns])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/knowledge', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить базу знаний')
      const normalized = normalizeKnowledgeResponse(payload?.data ?? payload)
      setData(normalized)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function confirmDelete(label: string) {
    if (typeof window === 'undefined') return true
    return window.confirm(`Удалить «${label}»? Это действие необратимо.`)
  }

  async function send(
    action: string,
    payload?: unknown,
    id?: string,
    onSuccess?: (result: any) => void,
  ) {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/admin/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload, id }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Действие не выполнено')
      setNotice('Изменения сохранены')
      if (onSuccess) {
        onSuccess(result)
      } else {
        await load()
      }
      return result
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Неизвестная ошибка')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function submitCategoryDialog(value: CategoryEditorValue) {
    const result = await send(
      'upsertCategory',
      {
        ...value,
        company_id: normalizeId(value.company_id),
        sort_order: Number(value.sort_order || 100),
      },
      undefined,
      (response) => {
        if (response?.data) {
          setData((prev) => ({
            ...prev,
            categories: sortBySortOrderTitle(upsertById(prev.categories, response.data as KnowledgeCategory)),
          }))
        }
      },
    )
    if (result) setCategoryDialogOpen(false)
  }

  function openCategoryDialogNew() {
    setCategoryDialogValue({ ...emptyCategoryValue })
    setCategoryDialogOpen(true)
  }

  function openCategoryDialogEdit(category: KnowledgeCategory) {
    setCategoryDialogValue({
      id: category.id,
      company_id: category.company_id || '',
      title: category.title,
      description: category.description || '',
      kind: category.kind,
      sort_order: category.sort_order ?? 100,
      is_active: category.is_active,
    })
    setCategoryDialogOpen(true)
  }

  async function submitArticleDialog(value: ArticleEditorValue) {
    const result = await send(
      'upsertArticle',
      {
        ...value,
        company_id: normalizeId(value.company_id),
        category_id: normalizeId(value.category_id),
        tags: splitList(value.tags || ''),
        audience: value.audience,
        related_fine_amount: moneyOrNull(value.related_fine_amount),
        related_bonus_amount: moneyOrNull(value.related_bonus_amount),
        sort_order: Number(value.sort_order || 100),
        requires_confirmation: value.requires_confirmation === true,
      },
      undefined,
      (response) => {
        if (response?.data) {
          setData((prev) => ({
            ...prev,
            articles: upsertById(prev.articles, response.data as KnowledgeArticle),
          }))
        }
      },
    )
    if (result) {
      setArticleDialogOpen(false)
    }
  }

  function openArticleDialogNew() {
    setArticleDialogValue({ ...emptyArticleValue })
    setArticleDialogOpen(true)
  }

  async function openArticleDialogEdit(article: KnowledgeArticle) {
    setArticleDialogValue({
      id: article.id,
      company_id: article.company_id || '',
      category_id: article.category_id || '',
      title: article.title,
      summary: article.summary || '',
      content: article.content || '',
      tags: article.tags?.join(', ') || '',
      audience: article.audience || [],
      severity: article.severity,
      related_fine_amount: article.related_fine_amount ?? '',
      related_bonus_amount: article.related_bonus_amount ?? '',
      sort_order: article.sort_order ?? 100,
      is_published: article.is_published,
      requires_confirmation: article.requires_confirmation === true,
    })
    setArticleDialogOpen(true)
    if (article.content !== undefined) return
    try {
      const response = await fetch(`/api/admin/knowledge?article=${encodeURIComponent(article.id)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить статью')
      const full = payload.data as KnowledgeArticle
      setData((prev) => ({ ...prev, articles: upsertById(prev.articles, full) }))
      setArticleDialogValue((prev) => (prev?.id === full.id ? { ...prev, content: full.content || '' } : prev))
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Не удалось загрузить статью')
    }
  }

  async function submitChecklistTemplateDialog(value: ChecklistTemplateEditorValue) {
    const result = await send(
      'upsertTemplate',
      {
        ...value,
        company_id: normalizeId(value.company_id),
        sort_order: Number(value.sort_order || 100),
      },
      undefined,
      (response) => {
        if (response?.data) {
          const saved = response.data as ChecklistTemplate
          setData((prev) => ({
            ...prev,
            templates: upsertById(prev.templates, saved),
          }))
          setChecklistTemplateValue({
            ...saved,
            company_id: saved.company_id || '',
            description: saved.description || '',
            schedule_type: saved.schedule_type || 'opening',
            recurrence_minutes: saved.recurrence_minutes ?? '',
            blocks_shift: !!saved.blocks_shift,
          })
        }
      },
    )
    if (result) {
      setChecklistDialogOpen(false)
    }
  }

  async function submitChecklistItemDialog(value: ChecklistItemEditorValue) {
    const result = await send(
      'upsertItem',
      {
        ...value,
        template_id: normalizeId(value.template_id),
        category_id: normalizeId(value.category_id),
        knowledge_article_id: normalizeId(value.knowledge_article_id),
        fine_amount: moneyOrNull(value.fine_amount),
        bonus_amount: moneyOrNull(value.bonus_amount),
        sort_order: Number(value.sort_order || 100),
      },
      undefined,
      (response) => {
        if (response?.data) {
          setData((prev) => ({
            ...prev,
            items: upsertById(prev.items, response.data as ChecklistItem),
          }))
        }
      },
    )
    if (result) {
      setChecklistItemValue({
        ...emptyChecklistItemValue,
        template_id: value.template_id,
      })
    }
  }

  function editTemplate(template: ChecklistTemplate) {
    setChecklistDialogMode('template')
    setChecklistItemValue(undefined)
    setChecklistTemplateValue({
      ...template,
      company_id: template.company_id || '',
      description: template.description || '',
      schedule_type: template.schedule_type || 'opening',
      recurrence_minutes: template.recurrence_minutes ?? '',
      blocks_shift: !!template.blocks_shift,
    })
    setChecklistDialogOpen(true)
  }

  function editItem(item: ChecklistItem) {
    const template = data.templates.find((entry) => entry.id === item.template_id)
    setChecklistDialogMode('item')
    setChecklistTemplateValue(
      template
        ? {
            ...template,
            company_id: template.company_id || '',
            description: template.description || '',
            schedule_type: template.schedule_type || 'opening',
            recurrence_minutes: template.recurrence_minutes ?? '',
            blocks_shift: !!template.blocks_shift,
          }
        : undefined,
    )
    setChecklistItemValue({
      ...item,
      category_id: item.category_id || '',
      knowledge_article_id: item.knowledge_article_id || '',
      description: item.description || '',
      fine_amount: item.fine_amount ?? '',
      bonus_amount: item.bonus_amount ?? '',
    })
    setChecklistDialogOpen(true)
  }

  function applyChecklistPreset(preset: (typeof CHECKLIST_PRESETS)[number]) {
    setChecklistDialogMode('template')
    setChecklistItemValue(undefined)
    setChecklistTemplateValue({
      ...emptyChecklistTemplateValue,
      title: preset.title,
      description: preset.description,
      schedule_type: preset.schedule_type,
      shift_scope: preset.shift_scope,
      role_scope: preset.role_scope,
      recurrence_minutes: preset.recurrence_minutes,
      blocks_shift: preset.blocks_shift,
    })
    setChecklistDialogOpen(true)
  }

  function addItemToTemplate(templateId: string) {
    const template = data.templates.find((entry) => entry.id === templateId)
    setChecklistDialogMode('item')
    setChecklistTemplateValue(
      template
        ? {
            ...template,
            company_id: template.company_id || '',
            description: template.description || '',
            schedule_type: template.schedule_type || 'opening',
            recurrence_minutes: template.recurrence_minutes ?? '',
            blocks_shift: !!template.blocks_shift,
          }
        : undefined,
    )
    setChecklistItemValue({
      ...emptyChecklistItemValue,
      template_id: templateId,
      sort_order: (itemsByTemplate.get(templateId)?.length ?? 0) * 10 + 100,
    })
    setChecklistDialogOpen(true)
  }

  function openChecklistTemplateNew() {
    setChecklistDialogMode('template')
    setChecklistTemplateValue(emptyChecklistTemplateValue)
    setChecklistItemValue(undefined)
    setChecklistDialogOpen(true)
  }

  const tabs = [
    { id: 'articles' as const, label: 'Статьи и FAQ', icon: FileText, count: data.articles.length },
    { id: 'checklists' as const, label: 'Чек-листы', icon: ClipboardList, count: data.templates.length },
    { id: 'runs' as const, label: 'Журнал и дисциплина', icon: History, count: data.runs.length },
    { id: 'categories' as const, label: 'Категории', icon: Layers3, count: data.categories.length },
  ]

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#07111c] px-4 py-8 text-slate-100 sm:px-6">
      <section className="app-page-wide flex flex-col gap-6">
        <div className="overflow-hidden rounded-[2rem] border border-amber-400/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.24),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] p-8 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] text-amber-200">
                <BookOpen className="h-4 w-4" />
                База знаний операторов
              </div>
              <h1 className="text-4xl font-black tracking-tight md:text-5xl">Админка правил, FAQ и чек-листов</h1>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Здесь можно обновлять инструкции для операторов, правила зарплаты, штрафы, бонусы, решения проблем и обязательные чек-листы смены.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[520px]">
              <StatCard label="Категорий" value={data.categories.length} />
              <StatCard label="Статей" value={data.articles.length} />
              <StatCard label="Чек-листов" value={data.templates.length} />
              <StatCard label="Прохождений" value={data.runs.length} />
            </div>
          </div>
        </div>

        <WorkflowGuide />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                    active
                      ? 'border-amber-300/70 bg-amber-300/15 text-amber-100 shadow-lg shadow-amber-950/40'
                      : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-600 hover:text-slate-100'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  <span className="rounded-full bg-slate-950/80 px-2 py-0.5 text-xs">{item.count}</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => load()}
              disabled={loading || saving}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </button>
            <button
              onClick={() =>
                send('seedDefaults', undefined, undefined, (response) => {
                  if (response?.data) setData(normalizeKnowledgeResponse(response.data))
                })
              }
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-orange-950/30 transition hover:brightness-110 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Создать базу F16
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="rounded-[2rem] border border-slate-800 bg-slate-900/50 p-10 text-center text-slate-400">
            Загружаю базу знаний...
          </div>
        ) : (
          <>
            {tab === 'articles' && (
              <div className="min-w-0">
                <Panel title="Материалы для операторов" icon={FileText}>
                  <TabHint
                    title="Что здесь создавать?"
                    text="Это сами правила и ответы: как открыть смену, что делать если не работает Kaspi, когда штраф, когда премия, как разговаривать с клиентом."
                  />
                  <div className="mb-4 flex flex-col gap-2">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                      <div className="flex flex-1 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                        <Search className="h-4 w-4 text-slate-500" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Поиск по FAQ, правилам, проблемам..."
                          className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                        />
                      </div>
                      {can('knowledge-admin.create') && (
                        <button
                          type="button"
                          onClick={openArticleDialogNew}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-orange-950/30 transition hover:brightness-110"
                        >
                          <Plus className="h-4 w-4" />
                          Новый материал
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SelectInput
                        value={filterSeverity}
                        onChange={(event) => setFilterSeverity(event.target.value as typeof filterSeverity)}
                        className="!w-auto !py-2 !text-xs"
                      >
                        <option value="all">Любая важность</option>
                        {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </SelectInput>
                      <SelectInput
                        value={filterStatus}
                        onChange={(event) => setFilterStatus(event.target.value as typeof filterStatus)}
                        className="!w-auto !py-2 !text-xs"
                      >
                        <option value="all">Все статьи</option>
                        <option value="published">Только опубликованные</option>
                        <option value="draft">Только черновики</option>
                        <option value="confirmation">Требуют подтверждения</option>
                      </SelectInput>
                      <SelectInput
                        value={filterCompany}
                        onChange={(event) => setFilterCompany(event.target.value)}
                        className="!w-auto !py-2 !text-xs"
                      >
                        <option value="all">Все точки</option>
                        <option value="global">Только глобальные</option>
                        {data.companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </SelectInput>
                      <span className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-400">
                        Показано {filteredArticles.length} из {data.articles.length}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-5">
                    {articlesByCategory.map((group) => (
                      <div key={group.id ?? 'none'} className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                          <span>{group.title}</span>
                          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-slate-400">{group.articles.length}</span>
                        </div>
                        <div className="grid gap-3">
                          {group.articles.map((article) => (
                            <ArticleCard
                              key={article.id}
                              article={article}
                              category={article.category_id ? categoryById.get(article.category_id) : undefined}
                              companyName={article.company_id ? companyById.get(article.company_id)?.name : undefined}
                              onEdit={() => openArticleDialogEdit(article)}
                              onDelete={() => {
                                if (!confirmDelete(article.title)) return
                                void send('deleteArticle', undefined, article.id, () => {
                                  setData((prev) => ({ ...prev, articles: removeById(prev.articles, article.id) }))
                                })
                              }}
                              canEdit={can('knowledge-admin.edit')}
                              canDelete={can('knowledge-admin.delete')}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                    {!articlesByCategory.length && <EmptyState text="Материалов пока нет. Создайте первую инструкцию или нажмите «Создать базу F16»." />}
                  </div>
                </Panel>
              </div>
            )}

            {tab === 'checklists' && (
              <div className="min-w-0">
                <Panel title="Чек-листы для операторов" icon={ClipboardList}>
                  <p className="mb-5 text-sm leading-6 text-slate-400">
                    Чек-лист — это шаги, которые оператор должен пройти за смену. Например: проверить кассу, чистоту, технику. Создайте чек-лист, потом добавьте в него пункты.
                  </p>

                  {!data.templates.length ? (
                    <div className="space-y-5">
                      <div className="rounded-3xl border border-amber-300/30 bg-amber-300/5 p-6 text-center">
                        <h3 className="text-xl font-black text-amber-100">Начните с готового чек-листа</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-300">Один клик — и шаблон создан. Потом останется только добавить свои пункты.</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {can('knowledge-admin.manage_checklists') && CHECKLIST_PRESETS.map((preset) => (
                          <button
                            key={preset.title}
                            type="button"
                            onClick={() => applyChecklistPreset(preset)}
                            className="group flex flex-col gap-2 rounded-3xl border border-slate-800 bg-slate-950/60 p-5 text-left transition hover:border-amber-300/60 hover:bg-amber-300/5"
                          >
                            <div className="flex items-center gap-3">
                              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-300/15 text-amber-200">
                                <ClipboardList className="h-5 w-5" />
                              </div>
                              <h4 className="text-lg font-black text-slate-100 group-hover:text-amber-100">{preset.title}</h4>
                            </div>
                            <p className="text-sm leading-6 text-slate-400">{preset.description}</p>
                            <span className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-amber-200 opacity-0 transition group-hover:opacity-100">
                              <Plus className="h-3 w-3" /> Создать
                            </span>
                          </button>
                        ))}
                      </div>
                      {can('knowledge-admin.manage_checklists') && (
                        <div className="text-center">
                          <button
                            type="button"
                            onClick={openChecklistTemplateNew}
                            className="text-sm font-semibold text-slate-400 underline-offset-4 hover:text-amber-200 hover:underline"
                          >
                            Или создать чек-лист с нуля
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                        <div className="flex flex-1 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                          <Search className="h-4 w-4 text-slate-500" />
                          <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Поиск по чек-листам и пунктам…"
                            className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                          />
                        </div>
                        <SelectInput
                          value={checklistScheduleFilter}
                          onChange={(event) => setChecklistScheduleFilter(event.target.value as 'all' | ChecklistTemplate['schedule_type'])}
                          className="!w-auto !py-3 !text-sm"
                        >
                          <option value="all">Все сценарии</option>
                          {Object.entries(SCHEDULE_TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </SelectInput>
                        {can('knowledge-admin.manage_checklists') && (
                          <button
                            type="button"
                            onClick={openChecklistTemplateNew}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-orange-950/30 transition hover:brightness-110"
                          >
                            <Plus className="h-4 w-4" />
                            Создать чек-лист
                          </button>
                        )}
                      </div>

                      <div className="grid gap-4">
                        {templatesBySchedule.map((group) => (
                          <div key={group.id} className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                              <span>{group.title}</span>
                              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-slate-400">{group.templates.length}</span>
                            </div>
                            <div className="grid gap-3">
                              {group.templates.map((template) => (
                                <ChecklistTemplateCard
                                  key={template.id}
                                  template={template}
                                  items={itemsByTemplate.get(template.id) ?? []}
                                  companyName={template.company_id ? companyById.get(template.company_id)?.name : undefined}
                                  articleById={articleById}
                                  onEdit={() => editTemplate(template)}
                                  onDelete={() => {
                                    if (!confirmDelete(template.title)) return
                                    void send('deleteTemplate', undefined, template.id, () => {
                                      setData((prev) => ({
                                        ...prev,
                                        templates: removeById(prev.templates, template.id),
                                        items: prev.items.filter((entry) => entry.template_id !== template.id),
                                      }))
                                    })
                                  }}
                                  onAddItem={() => addItemToTemplate(template.id)}
                                  onEditItem={editItem}
                                  onDeleteItem={(item) => {
                                    if (!confirmDelete(item.title)) return
                                    void send('deleteItem', undefined, item.id, () => {
                                      setData((prev) => ({ ...prev, items: removeById(prev.items, item.id) }))
                                    })
                                  }}
                                  canManage={can('knowledge-admin.manage_checklists')}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                        {!templatesBySchedule.length && (
                          <EmptyState text="Под фильтр ничего не попало. Очистите поиск или поменяйте сценарий." />
                        )}
                      </div>
                    </>
                  )}
                </Panel>
              </div>
            )}

            {tab === 'runs' && (
              <div className="min-w-0">
                <Panel title="Журнал и дисциплина чек-листов" icon={History}>
                  <TabHint
                    title="Что здесь контролировать?"
                    text="Это история прохождения чек-листов операторами: кто начал, кто завершил, по какой точке, сколько пунктов выполнено и где были проблемы, штрафы или бонусы."
                  />

                  <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                    <div className="flex flex-1 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                      <Search className="h-4 w-4 text-slate-500" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Поиск по оператору, точке, чек-листу…"
                        className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                      />
                    </div>
                    <SelectInput
                      value={filterCompany}
                      onChange={(event) => setFilterCompany(event.target.value)}
                      className="!w-auto !py-3 !text-sm"
                    >
                      <option value="all">Все точки</option>
                      <option value="global">Только глобальные</option>
                      {data.companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </SelectInput>
                    <SelectInput
                      value={runStatusFilter}
                      onChange={(event) => setRunStatusFilter(event.target.value as typeof runStatusFilter)}
                      className="!w-auto !py-3 !text-sm"
                    >
                      <option value="all">Все статусы</option>
                      {Object.entries(RUN_STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </SelectInput>
                    <SelectInput
                      value={runEvidenceFilter}
                      onChange={(event) => setRunEvidenceFilter(event.target.value as typeof runEvidenceFilter)}
                      className="!w-auto !py-3 !text-sm"
                    >
                      <option value="all">Все ответы</option>
                      <option value="with-problems">Только с проблемами</option>
                      <option value="missing-photo">Требовали фото, но фото нет</option>
                    </SelectInput>
                  </div>

                  <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
                    <MiniMetric label="Всего прохождений" value={runStats.total} />
                    <MiniMetric label="Завершено" value={runStats.completed} />
                    <MiniMetric label="В работе" value={runStats.inProgress} />
                    <MiniMetric label="Проблемных пунктов" value={runStats.failedItems} tone="danger" />
                    <MiniMetric label="Фото приложено" value={runStats.withPhotos} tone="success" />
                    <MiniMetric label="Фото не хватает" value={runStats.missingPhotos} tone={runStats.missingPhotos ? 'danger' : 'default'} />
                    <MiniMetric label="Штрафы" value={formatMoneyText(runStats.finesTotal)} tone="danger" />
                    <MiniMetric label="Бонусы" value={formatMoneyText(runStats.bonusesTotal)} tone="success" />
                  </div>

                  <div className="grid gap-3">
                    {filteredRuns.map((run) => (
                      <article key={run.id} className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950/50 p-5">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap gap-2">
                              <Badge>{run.company_name || 'Все точки'}</Badge>
                              <Badge>{RUN_STATUS_LABELS[run.status] || run.status}</Badge>
                              {run.shift_type && <Badge>Смена: {run.shift_type}</Badge>}
                              {Number(run.failed_count || 0) > 0 && <Badge>Проблем: {run.failed_count}</Badge>}
                            </div>
                            <h3 className="mt-3 break-words text-xl font-black text-slate-100">{run.template_title || 'Чек-лист'}</h3>
                            <p className="mt-2 break-words text-sm leading-6 text-slate-400">
                              Проходил: <span className="font-semibold text-slate-200">{run.run_by_name || 'не указан'}</span>
                              {' · '}
                              Начало: {formatDateTime(run.started_at)}
                              {' · '}
                              Завершение: {formatDateTime(run.completed_at)}
                            </p>
                            {run.co_signed_by_name && (
                              <p className="mt-1 text-sm text-slate-500">Подтвердил: {run.co_signed_by_name}</p>
                            )}
                          </div>

                          <div className="grid min-w-[320px] gap-2 sm:grid-cols-3">
                            <RunMetric
                              label="Ответы"
                              value={`${run.answered_count ?? 0}/${run.item_count ?? 0}`}
                            />
                            <RunMetric label="Штраф" value={formatMoneyText(run.fines_total)} tone="danger" />
                            <RunMetric label="Бонус" value={formatMoneyText(run.bonuses_total)} tone="success" />
                          </div>
                        </div>

                        {run.response_items?.length ? (
                          <details className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                            <summary className="cursor-pointer select-none text-sm font-black text-slate-200">
                              Детали ответов: {run.response_items.length}
                            </summary>
                            <div className="mt-4 grid gap-2">
                              {run.response_items.map((item, index) => {
                                const statusLabel = item.passed === true ? 'Ок' : item.failed ? 'Проблема' : 'Нет ответа'
                                const statusClass =
                                  item.passed === true
                                    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                                    : item.failed
                                      ? 'border-red-400/30 bg-red-400/10 text-red-100'
                                      : 'border-slate-700 bg-slate-800/70 text-slate-300'
                                const displayValue =
                                  item.value === null || item.value === undefined || item.value === ''
                                    ? null
                                    : typeof item.value === 'object'
                                      ? JSON.stringify(item.value)
                                      : String(item.value)

                                return (
                                  <div key={item.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                                            #{index + 1}
                                          </span>
                                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${statusClass}`}>
                                            {statusLabel}
                                          </span>
                                          {item.is_required && <Badge>обязательный</Badge>}
                                          {item.requires_photo && <Badge>фото</Badge>}
                                          {item.severity !== 'normal' && <Badge>{SEVERITY_LABELS[item.severity]}</Badge>}
                                        </div>
                                        <div className="mt-2 break-words text-sm font-bold text-slate-100">{item.title}</div>
                                        {displayValue && (
                                          <div className="mt-1 break-words text-xs leading-5 text-slate-400">
                                            Ответ: {displayValue}
                                          </div>
                                        )}
                                        {item.note && (
                                          <div className="mt-1 break-words text-xs leading-5 text-slate-400">
                                            Комментарий: {item.note}
                                          </div>
                                        )}
                                        {item.photo_data_url ? (
                                          <div className="mt-3">
                                            <a href={item.photo_data_url} target="_blank" rel="noreferrer" className="inline-block">
                                              <img
                                                src={item.photo_data_url}
                                                alt={item.photo_name || `Фото пункта ${index + 1}`}
                                                className="max-h-44 rounded-2xl border border-slate-700 object-cover"
                                              />
                                            </a>
                                            <div className="mt-1 text-[11px] text-slate-500">
                                              {item.photo_name || 'Фото подтверждение'}
                                              {item.photo_captured_at ? ` · ${formatDateTime(item.photo_captured_at)}` : ''}
                                            </div>
                                          </div>
                                        ) : item.requires_photo ? (
                                          <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                                            Фото требовалось, но не приложено.
                                          </div>
                                        ) : null}
                                      </div>
                                      <div className="flex shrink-0 flex-wrap gap-2 text-xs font-black">
                                        {item.photo_data_url && (
                                          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-sky-100">
                                            Есть фото
                                          </span>
                                        )}
                                        {Number(item.fine_amount || 0) > 0 && (
                                          <span className="rounded-full border border-red-400/30 bg-red-400/10 px-2 py-1 text-red-100">
                                            Штраф {formatMoneyText(item.fine_amount)}
                                          </span>
                                        )}
                                        {Number(item.bonus_amount || 0) > 0 && (
                                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-emerald-100">
                                            Бонус {formatMoneyText(item.bonus_amount)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </details>
                        ) : null}
                      </article>
                    ))}

                    {!filteredRuns.length && (
                      <EmptyState text="Пока нет прохождений чек-листов. Они появятся здесь после того, как оператор начнёт чек-лист в своей программе." />
                    )}
                  </div>
                </Panel>
              </div>
            )}

            {tab === 'categories' && (
              <div className="min-w-0">
                <Panel title="Категории базы знаний" icon={Layers3}>
                  <p className="mb-5 text-sm leading-6 text-slate-400">
                    Категории группируют материалы: правила клуба, зарплата и премии, штрафы, FAQ, проблемы техники, магазин и касса.
                  </p>
                  <div className="mb-5 flex justify-end">
                    {can('knowledge-admin.create') && (
                      <button
                        type="button"
                        onClick={openCategoryDialogNew}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-orange-950/30 transition hover:brightness-110"
                      >
                        <Plus className="h-4 w-4" />
                        Новая категория
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {data.categories.map((category) => (
                      <div key={category.id} className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950/50 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap gap-2">
                              <Badge>{KIND_LABELS[category.kind]}</Badge>
                              <Badge>{category.company_id ? `Точка: ${companyById.get(category.company_id)?.name || ''}` : 'Все точки'}</Badge>
                              {!category.is_active && <Badge>черновик</Badge>}
                            </div>
                            <h3 className="mt-3 break-words text-xl font-black">{category.title}</h3>
                            {category.description ? (
                              <div
                                className="mt-2 break-words text-sm leading-6 text-slate-400 [&_p]:my-1 [&_h1]:my-1.5 [&_h1]:text-base [&_h1]:font-black [&_h2]:my-1.5 [&_h2]:text-sm [&_h2]:font-black [&_h3]:my-1 [&_h3]:font-bold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-black [&_em]:italic [&_u]:underline [&_a]:text-amber-300 [&_a]:underline [&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-amber-300/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-slate-800/80 [&_code]:px-1 [&_mark]:rounded [&_mark]:px-1 [&_img]:my-2 [&_img]:max-h-40 [&_img]:rounded [&_table]:my-2 [&_th]:border [&_th]:border-slate-700 [&_th]:bg-slate-800 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-700 [&_td]:px-2 [&_td]:py-1"
                                dangerouslySetInnerHTML={{ __html: category.description }}
                              />
                            ) : (
                              <p className="mt-2 break-words text-sm leading-6 text-slate-500">Без описания</p>
                            )}
                          </div>
                          <RowActions
                            onEdit={() => openCategoryDialogEdit(category)}
                            onDelete={() => {
                              if (!confirmDelete(category.title)) return
                              void send('deleteCategory', undefined, category.id, () => {
                                setData((prev) => ({ ...prev, categories: removeById(prev.categories, category.id) }))
                              })
                            }}
                            canEdit={can('knowledge-admin.edit')}
                            canDelete={can('knowledge-admin.delete')}
                          />
                        </div>
                      </div>
                    ))}
                    {!data.categories.length && <EmptyState text="Категорий пока нет. Создайте первую через кнопку «Новая категория»." />}
                  </div>
                </Panel>
              </div>
            )}
          </>
        )}

        {articleDialogOpen && (
          <ArticleEditorDialog
            open={articleDialogOpen}
            onOpenChange={setArticleDialogOpen}
            initialValue={articleDialogValue}
            categories={data.categories}
            companies={data.companies}
            saving={saving}
            onSubmit={submitArticleDialog}
          />
        )}
        {categoryDialogOpen && (
          <CategoryEditorDialog
            open={categoryDialogOpen}
            onOpenChange={setCategoryDialogOpen}
            initialValue={categoryDialogValue}
            companies={data.companies}
            saving={saving}
            onSubmit={submitCategoryDialog}
          />
        )}
        {checklistDialogOpen && (
          <ChecklistEditorDialog
            open={checklistDialogOpen}
            onOpenChange={setChecklistDialogOpen}
            initialTemplate={checklistTemplateValue}
            initialItem={checklistItemValue}
            initialMode={checklistDialogMode}
            templates={data.templates}
            items={data.items}
            categories={data.categories}
            articles={data.articles}
            companies={data.companies}
            saving={saving}
            onSubmitTemplate={submitChecklistTemplateDialog}
            onSubmitItem={submitChecklistItemDialog}
            onDeleteItem={async (item) => {
              if (!confirmDelete(item.title)) return
              await send('deleteItem', undefined, item.id, () => {
                setData((prev) => ({ ...prev, items: removeById(prev.items, item.id) }))
              })
            }}
          />
        )}
      </section>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
      <div className="text-3xl font-black">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
    </div>
  )
}

function MiniMetric({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'danger' | 'success' }) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-400/25 bg-red-500/10 text-red-100'
      : tone === 'success'
        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
        : 'border-slate-800 bg-slate-950/50 text-slate-100'

  return (
    <div className={`min-w-0 rounded-3xl border p-4 ${toneClass}`}>
      <div className="break-words text-2xl font-black">{value}</div>
      <div className="mt-1 break-words text-xs uppercase tracking-[0.16em] text-slate-400">{label}</div>
    </div>
  )
}

function RunMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' | 'success' }) {
  const valueClass =
    tone === 'danger' ? 'text-red-200' : tone === 'success' ? 'text-emerald-200' : 'text-slate-100'

  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="break-words text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-black ${valueClass}`}>{value}</div>
    </div>
  )
}

function WorkflowGuide() {
  const steps = [
    {
      number: '01',
      title: 'Создай категории',
      text: 'Например: правила смены, штрафы, премии, FAQ, магазин, технические проблемы.',
    },
    {
      number: '02',
      title: 'Наполни статьи',
      text: 'В статьях пишем понятную инструкцию: что делать, что запрещено, какой штраф или бонус.',
    },
    {
      number: '03',
      title: 'Собери чек-листы',
      text: 'Шаблон смены связывает пункты с правилами, чтобы оператор не гадал, а проходил порядок.',
    },
  ]

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {steps.map((step) => (
        <div key={step.number} className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-200">
            Шаг {step.number}
          </div>
          <h3 className="break-words text-lg font-black text-slate-100">{step.title}</h3>
          <p className="mt-2 break-words text-sm leading-6 text-slate-400">{step.text}</p>
        </div>
      ))}
    </div>
  )
}

function TabHint({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-5 rounded-3xl border border-sky-400/20 bg-sky-400/10 p-4">
      <p className="break-words text-sm font-black text-sky-100">{title}</p>
      <p className="mt-1 break-words text-sm leading-6 text-slate-300">{text}</p>
    </div>
  )
}

function Panel({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900/55 p-5 shadow-2xl shadow-black/20">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-300/10 text-amber-200">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="min-w-0 break-words text-xl font-black">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function ArticleCard({
  article,
  category,
  companyName,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: {
  article: KnowledgeArticle
  category?: KnowledgeCategory
  companyName?: string
  onEdit: () => void
  onDelete: () => void
  canEdit?: boolean
  canDelete?: boolean
}) {
  return (
    <article className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950/50 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge>{companyName ? `Точка: ${companyName}` : 'Все точки'}</Badge>
            {category && <Badge>{category.title}</Badge>}
            <Badge>{SEVERITY_LABELS[article.severity]}</Badge>
            <Badge>{article.is_published ? 'Опубликовано' : 'Черновик'}</Badge>
            {article.requires_confirmation && <Badge>Подтверждение</Badge>}
            {(article.version ?? 1) > 0 && <Badge>v{article.version ?? 1}</Badge>}
            {(article.audience ?? []).map((aud) => (
              <Badge key={aud}>{AUDIENCE_OPTIONS.find((o) => o.value === aud)?.label || aud}</Badge>
            ))}
          </div>
          <h3 className="mt-3 break-words text-xl font-black">{article.title}</h3>
          <p className="mt-2 break-words text-sm leading-6 text-slate-400">{article.summary || 'Без краткого описания'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(article.tags ?? []).map((tag) => (
              <span key={tag} className="max-w-full break-words rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                #{tag}
              </span>
            ))}
          </div>
        </div>
        <RowActions onEdit={onEdit} onDelete={onDelete} canEdit={canEdit} canDelete={canDelete} />
      </div>
    </article>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="max-w-full break-words rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-bold text-amber-100">{children}</span>
}

function RowActions({
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: {
  onEdit: () => void
  onDelete: () => void
  canEdit?: boolean
  canDelete?: boolean
}) {
  return (
    <div className="flex shrink-0 gap-2">
      {canEdit && (
        <button onClick={onEdit} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-300/50 hover:text-amber-100">
          <Pencil className="h-4 w-4" />
        </button>
      )}
      {canDelete && (
        <button onClick={onDelete} className="grid h-9 w-9 place-items-center rounded-xl border border-red-500/30 bg-red-950/20 text-red-200 hover:bg-red-950/40">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-sm text-slate-500">{text}</div>
}

function ChecklistTemplateCard({
  template,
  items,
  companyName,
  articleById,
  onEdit,
  onDelete,
  onAddItem,
  onEditItem,
  onDeleteItem,
  canManage = true,
}: {
  template: ChecklistTemplate
  items: ChecklistItem[]
  companyName?: string
  articleById: Map<string, KnowledgeArticle>
  onEdit: () => void
  onDelete: () => void
  onAddItem: () => void
  onEditItem: (item: ChecklistItem) => void
  onDeleteItem: (item: ChecklistItem) => void
  canManage?: boolean
}) {
  return (
    <article className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950/50 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="break-words text-xl font-black">{template.title}</h3>
          <p className="mt-1 break-words text-sm leading-6 text-slate-400">{template.description || 'Описание пока не заполнено.'}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">{companyName ? companyName : 'Все точки'}</span>
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">{SCHEDULE_TYPE_LABELS[template.schedule_type] || template.schedule_type}</span>
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">{items.length} {items.length === 1 ? 'пункт' : 'пунктов'}</span>
            {template.blocks_shift ? <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 font-bold text-amber-100">блокирует смену</span> : null}
            {!template.is_active ? <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-400">черновик</span> : null}
          </div>
        </div>
        <RowActions onEdit={onEdit} onDelete={onDelete} canEdit={canManage} canDelete={canManage} />
      </div>

      <div className="mt-5 space-y-2 border-t border-slate-800 pt-4">
        {items.map((item, index) => {
          const linkedArticle = item.knowledge_article_id ? articleById.get(item.knowledge_article_id) : null
          const meta: string[] = []
          if (item.is_required) meta.push('обязательно')
          if (item.requires_photo || item.answer_type === 'photo') meta.push('фото')
          if (item.fine_amount) meta.push(`штраф ${formatMoney(item.fine_amount)}`)
          if (item.bonus_amount) meta.push(`бонус ${formatMoney(item.bonus_amount)}`)
          if (linkedArticle) meta.push(`FAQ: ${linkedArticle.title}`)
          return (
            <div key={item.id} className="flex min-w-0 items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-xs font-black text-emerald-100">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-bold text-slate-100">{item.title}</p>
                {item.description ? (
                  <div
                    className="mt-1 break-words text-xs leading-5 text-slate-500 [&_p]:my-1 [&_h1]:my-1.5 [&_h1]:text-sm [&_h1]:font-black [&_h2]:my-1.5 [&_h2]:text-sm [&_h2]:font-black [&_h3]:my-1 [&_h3]:font-bold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-black [&_em]:italic [&_u]:underline [&_a]:text-amber-300 [&_a]:underline [&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-amber-300/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-slate-800/80 [&_code]:px-1 [&_mark]:rounded [&_mark]:px-1 [&_img]:my-2 [&_img]:max-h-40 [&_img]:rounded [&_table]:my-2 [&_th]:border [&_th]:border-slate-700 [&_th]:bg-slate-800 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-700 [&_td]:px-2 [&_td]:py-1"
                    dangerouslySetInnerHTML={{ __html: item.description }}
                  />
                ) : null}
                {meta.length ? (
                  <p className="mt-1 break-words text-xs text-slate-500">{meta.join(' · ')}</p>
                ) : null}
              </div>
              <RowActions onEdit={() => onEditItem(item)} onDelete={() => onDeleteItem(item)} canEdit={canManage} canDelete={canManage} />
            </div>
          )
        })}
        {canManage && (
          <button
            type="button"
            onClick={onAddItem}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-3 text-sm font-semibold text-slate-400 transition hover:border-emerald-400/60 hover:text-emerald-200"
          >
            <Plus className="h-4 w-4" />
            {items.length ? 'Добавить пункт' : 'Добавить первый пункт'}
          </button>
        )}
      </div>
    </article>
  )
}
