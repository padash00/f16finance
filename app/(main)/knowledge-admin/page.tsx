'use client'

import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { ArticleEditorDialog, emptyArticleValue, type ArticleEditorValue } from '@/components/admin/article-editor-dialog'
import {
  ChecklistEditorDialog,
  emptyChecklistItemValue,
  emptyChecklistTemplateValue,
  type ChecklistItemEditorValue,
  type ChecklistTemplateEditorValue,
} from '@/components/admin/checklist-editor-dialog'

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
  content: string
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

type KnowledgeResponse = {
  categories: KnowledgeCategory[]
  articles: KnowledgeArticle[]
  templates: ChecklistTemplate[]
  items: ChecklistItem[]
  companies: Company[]
}

type Tab = 'articles' | 'checklists' | 'categories'

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

const emptyCategory = {
  title: '',
  company_id: '',
  description: '',
  kind: 'faq' as CategoryKind,
  sort_order: 100,
  is_active: true,
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

const ROLE_SCOPE_LABELS: Record<string, string> = {
  any: 'Любая роль',
  operator: 'Оператор',
  cashier: 'Кассир',
  senior_operator: 'Старший оператор',
  senior_cashier: 'Старший кассир',
}

const SHIFT_SCOPE_LABELS: Record<string, string> = {
  any: 'Любая смена',
  day: 'День',
  night: 'Ночь',
  opening: 'Открытие',
  closing: 'Закрытие',
  handover: 'Передача',
}

const ANSWER_TYPE_LABELS: Record<string, string> = {
  boolean: 'Галочка',
  text: 'Текст',
  number: 'Число',
  photo: 'Фото',
  choice: 'Выбор',
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
    recurrence_minutes: 60,
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

function FieldLabel({ children }: { children: string }) {
  return <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{children}</label>
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-400/80 focus:ring-2 focus:ring-amber-400/15 ${props.className ?? ''}`}
    />
  )
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-400/80 focus:ring-2 focus:ring-amber-400/15 ${props.className ?? ''}`}
    />
  )
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-28 w-full rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-400/80 focus:ring-2 focus:ring-amber-400/15 ${props.className ?? ''}`}
    />
  )
}

export default function KnowledgeAdminPage() {
  const [data, setData] = useState<KnowledgeResponse>({
    categories: [],
    articles: [],
    templates: [],
    items: [],
    companies: [],
  })
  const [tab, setTab] = useState<Tab>('articles')
  const [query, setQuery] = useState('')
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'info' | 'normal' | 'warning' | 'critical'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'published' | 'draft' | 'confirmation'>('all')
  const [filterCompany, setFilterCompany] = useState<string>('all')
  const [checklistScheduleFilter, setChecklistScheduleFilter] = useState<'all' | ChecklistTemplate['schedule_type']>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [categoryForm, setCategoryForm] = useState<any>(emptyCategory)
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
      return [article.title, article.summary, article.content, article.tags?.join(' ')]
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

  const checklistStats = useMemo(() => {
    const items = data.items
    return {
      active: data.templates.filter((template) => template.is_active).length,
      blocking: data.templates.filter((template) => template.blocks_shift).length,
      photo: items.filter((item) => item.requires_photo || item.answer_type === 'photo').length,
      risk: items.filter((item) => item.severity === 'critical' || item.fine_amount).length,
    }
  }, [data.templates, data.items])

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

  async function send(action: string, payload?: unknown, id?: string) {
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
      await load()
      return result
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Неизвестная ошибка')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault()
    const result = await send('upsertCategory', {
      ...categoryForm,
      company_id: normalizeId(categoryForm.company_id),
      sort_order: Number(categoryForm.sort_order || 100),
    })
    if (result) setCategoryForm(emptyCategory)
  }

  async function submitArticleDialog(value: ArticleEditorValue) {
    const result = await send('upsertArticle', {
      ...value,
      company_id: normalizeId(value.company_id),
      category_id: normalizeId(value.category_id),
      tags: splitList(value.tags || ''),
      audience: value.audience,
      related_fine_amount: moneyOrNull(value.related_fine_amount),
      related_bonus_amount: moneyOrNull(value.related_bonus_amount),
      sort_order: Number(value.sort_order || 100),
      requires_confirmation: value.requires_confirmation === true,
    })
    if (result) {
      setArticleDialogOpen(false)
    }
  }

  function openArticleDialogNew() {
    setArticleDialogValue({ ...emptyArticleValue })
    setArticleDialogOpen(true)
  }

  function openArticleDialogEdit(article: KnowledgeArticle) {
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
  }

  async function submitChecklistTemplateDialog(value: ChecklistTemplateEditorValue) {
    const result = await send('upsertTemplate', {
      ...value,
      company_id: normalizeId(value.company_id),
      sort_order: Number(value.sort_order || 100),
    })
    if (result) {
      setChecklistTemplateValue(undefined)
      setChecklistDialogOpen(false)
    }
  }

  async function submitChecklistItemDialog(value: ChecklistItemEditorValue) {
    const result = await send('upsertItem', {
      ...value,
      template_id: normalizeId(value.template_id),
      category_id: normalizeId(value.category_id),
      knowledge_article_id: normalizeId(value.knowledge_article_id),
      fine_amount: moneyOrNull(value.fine_amount),
      bonus_amount: moneyOrNull(value.bonus_amount),
      sort_order: Number(value.sort_order || 100),
    })
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

  function openChecklistItemNew() {
    setChecklistDialogMode('item')
    setChecklistTemplateValue(undefined)
    setChecklistItemValue({
      ...emptyChecklistItemValue,
      template_id: data.templates[0]?.id || '',
    })
    setChecklistDialogOpen(true)
  }

  const tabs = [
    { id: 'articles' as const, label: 'Статьи и FAQ', icon: FileText, count: data.articles.length },
    { id: 'checklists' as const, label: 'Чек-листы', icon: ClipboardList, count: data.templates.length },
    { id: 'categories' as const, label: 'Категории', icon: Layers3, count: data.categories.length },
  ]

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#07111c] px-4 py-8 text-slate-100 sm:px-6">
      <section className="mx-auto flex w-full max-w-[1760px] flex-col gap-6">
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
              <StatCard label="Пунктов" value={data.items.length} />
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
              onClick={() => send('seedDefaults')}
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
                      <button
                        type="button"
                        onClick={openArticleDialogNew}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-orange-950/30 transition hover:brightness-110"
                      >
                        <Plus className="h-4 w-4" />
                        Новый материал
                      </button>
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
                                void send('deleteArticle', undefined, article.id)
                              }}
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
                  <TabHint
                    title="Что здесь создавать?"
                    text="Это пошаговые сценарии для оператора: открыть смену, сделать обход, закрыть смену, передать смену или пройти обучение. Каждый пункт можно связать со статьёй FAQ, штрафом, бонусом и требованием фото."
                  />

                  <div className="mb-4 flex flex-col gap-2">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                      <div className="flex flex-1 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                        <Search className="h-4 w-4 text-slate-500" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Поиск по чек-листам, сценариям, пунктам..."
                          className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={openChecklistTemplateNew}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-orange-950/30 transition hover:brightness-110"
                      >
                        <Plus className="h-4 w-4" />
                        Новый чек-лист
                      </button>
                      <button
                        type="button"
                        onClick={openChecklistItemNew}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
                      >
                        <CheckSquare className="h-4 w-4" />
                        Новый пункт
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SelectInput value={filterCompany} onChange={(event) => setFilterCompany(event.target.value)} className="!w-auto !py-2 !text-xs">
                        <option value="all">Все точки</option>
                        <option value="global">Только общие</option>
                        {data.companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </SelectInput>
                      <SelectInput
                        value={checklistScheduleFilter}
                        onChange={(event) => setChecklistScheduleFilter(event.target.value as 'all' | ChecklistTemplate['schedule_type'])}
                        className="!w-auto !py-2 !text-xs"
                      >
                        <option value="all">Все сценарии</option>
                        {Object.entries(SCHEDULE_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </SelectInput>
                      <span className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-400">
                        Показано {filteredTemplates.length} из {data.templates.length}
                      </span>
                      <span className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-400">
                        Пунктов {data.items.length}
                      </span>
                      <span className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-400">
                        Фото {checklistStats.photo}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(SCHEDULE_TYPE_LABELS).map(([value, label]) => (
                        <ScheduleFilterButton
                          key={value}
                          active={checklistScheduleFilter === value}
                          onClick={() => setChecklistScheduleFilter(value as ChecklistTemplate['schedule_type'])}
                        >
                          {label}
                        </ScheduleFilterButton>
                      ))}
                      {CHECKLIST_PRESETS.map((preset) => (
                        <button
                          key={preset.title}
                          type="button"
                          onClick={() => applyChecklistPreset(preset)}
                          className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100 transition hover:border-amber-300/60 hover:bg-amber-300/15"
                        >
                          + {preset.title}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-5">
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
                                void send('deleteTemplate', undefined, template.id)
                              }}
                              onAddItem={() => addItemToTemplate(template.id)}
                              onEditItem={editItem}
                              onDeleteItem={(item) => {
                                if (!confirmDelete(item.title)) return
                                void send('deleteItem', undefined, item.id)
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                    {!templatesBySchedule.length && <EmptyState text="Чек-листов пока нет. Создайте первый сценарий или нажмите быстрый шаблон выше." />}
                  </div>
                </Panel>
              </div>
            )}

            {tab === 'categories' && (
              <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(460px,520px)]">
                <Panel title="Категории базы знаний" icon={Layers3}>
                  <TabHint
                    title="Зачем категории?"
                    text="Категории группируют материалы: правила клуба, зарплата и премии, штрафы, FAQ, проблемы техники, магазин и касса."
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    {data.categories.map((category) => (
                      <div key={category.id} className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950/50 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap gap-2">
                              <Badge>{KIND_LABELS[category.kind]}</Badge>
                              <Badge>{category.company_id ? `Точка: ${companyById.get(category.company_id)?.name || ''}` : 'Все точки'}</Badge>
                            </div>
                            <h3 className="mt-3 break-words text-xl font-black">{category.title}</h3>
                            <p className="mt-2 break-words text-sm leading-6 text-slate-400">{category.description || 'Без описания'}</p>
                          </div>
                          <RowActions
                            onEdit={() => setCategoryForm({ ...category, company_id: category.company_id || '', description: category.description || '' })}
                            onDelete={() => {
                              if (!confirmDelete(category.title)) return
                              void send('deleteCategory', undefined, category.id)
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {!data.categories.length && <EmptyState text="Категорий пока нет." />}
                  </div>
                </Panel>

                <Panel title={categoryForm.id ? 'Редактировать категорию' : 'Новая категория'} icon={Plus}>
                  <form onSubmit={submitCategory} className="space-y-4">
                    <div className="space-y-2">
                      <FieldLabel>Название</FieldLabel>
                      <TextInput value={categoryForm.title} onChange={(event) => setCategoryForm({ ...categoryForm, title: event.target.value })} required />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <FieldLabel>Точка</FieldLabel>
                        <SelectInput value={categoryForm.company_id} onChange={(event) => setCategoryForm({ ...categoryForm, company_id: event.target.value })}>
                          <option value="">Для всех точек</option>
                          {data.companies.map((company) => (
                            <option key={company.id} value={company.id}>
                              {company.name}
                            </option>
                          ))}
                        </SelectInput>
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>Тип</FieldLabel>
                        <SelectInput value={categoryForm.kind} onChange={(event) => setCategoryForm({ ...categoryForm, kind: event.target.value })}>
                          {Object.entries(KIND_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </SelectInput>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Описание</FieldLabel>
                      <TextArea value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Порядок</FieldLabel>
                      <TextInput value={categoryForm.sort_order} onChange={(event) => setCategoryForm({ ...categoryForm, sort_order: event.target.value })} inputMode="numeric" />
                    </div>
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                      <input type="checkbox" checked={categoryForm.is_active} onChange={(event) => setCategoryForm({ ...categoryForm, is_active: event.target.checked })} />
                      Активная категория
                    </label>
                    <FormActions saving={saving} reset={() => setCategoryForm(emptyCategory)} isEditing={Boolean(categoryForm.id)} />
                  </form>
                </Panel>
              </div>
            )}
          </>
        )}

        <ArticleEditorDialog
          open={articleDialogOpen}
          onOpenChange={setArticleDialogOpen}
          initialValue={articleDialogValue}
          categories={data.categories}
          companies={data.companies}
          saving={saving}
          onSubmit={submitArticleDialog}
        />
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
            await send('deleteItem', undefined, item.id)
          }}
        />
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
}: {
  article: KnowledgeArticle
  category?: KnowledgeCategory
  companyName?: string
  onEdit: () => void
  onDelete: () => void
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
          <p className="mt-2 break-words text-sm leading-6 text-slate-400">{article.summary || article.content.slice(0, 180)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(article.tags ?? []).map((tag) => (
              <span key={tag} className="max-w-full break-words rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                #{tag}
              </span>
            ))}
          </div>
        </div>
        <RowActions onEdit={onEdit} onDelete={onDelete} />
      </div>
    </article>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="max-w-full break-words rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-bold text-amber-100">{children}</span>
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex shrink-0 gap-2">
      <button onClick={onEdit} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-300/50 hover:text-amber-100">
        <Pencil className="h-4 w-4" />
      </button>
      <button onClick={onDelete} className="grid h-9 w-9 place-items-center rounded-xl border border-red-500/30 bg-red-950/20 text-red-200 hover:bg-red-950/40">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function FormActions({ saving, reset, isEditing }: { saving: boolean; reset: () => void; isEditing: boolean }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="submit"
        disabled={saving}
        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        {isEditing ? 'Сохранить' : 'Создать'}
      </button>
      <button type="button" onClick={reset} className="rounded-2xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500">
        Сбросить
      </button>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-sm text-slate-500">{text}</div>
}

function ScheduleFilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-xs font-bold transition ${
        active
          ? 'border-amber-300/70 bg-amber-300/15 text-amber-100'
          : 'border-slate-800 bg-slate-950/60 text-slate-500 hover:border-slate-600 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
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
}) {
  const requiredCount = items.filter((item) => item.is_required).length
  const photoCount = items.filter((item) => item.requires_photo || item.answer_type === 'photo').length
  const moneyImpact = items.reduce((sum, item) => sum + (item.fine_amount || 0) + (item.bonus_amount || 0), 0)

  return (
    <article className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950/50 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge>{companyName ? `Точка: ${companyName}` : 'Все точки'}</Badge>
            <Badge>{SCHEDULE_TYPE_LABELS[template.schedule_type] || template.schedule_type}</Badge>
            <Badge>{ROLE_SCOPE_LABELS[template.role_scope] || template.role_scope}</Badge>
            <Badge>{SHIFT_SCOPE_LABELS[template.shift_scope] || template.shift_scope}</Badge>
            {template.schedule_type === 'periodic' && template.recurrence_minutes ? <Badge>каждые {template.recurrence_minutes} мин</Badge> : null}
            {template.blocks_shift ? <Badge>блокирует смену</Badge> : null}
            <Badge>{template.is_active ? 'Активен' : 'Черновик'}</Badge>
          </div>
          <h3 className="mt-3 break-words text-xl font-black">{template.title}</h3>
          <p className="mt-2 break-words text-sm leading-6 text-slate-400">{template.description || 'Описание пока не заполнено.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="max-w-full break-words rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">Пунктов: {items.length}</span>
            <span className="max-w-full break-words rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">Обязательных: {requiredCount}</span>
            <span className="max-w-full break-words rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">Фото: {photoCount}</span>
            <span className="max-w-full break-words rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">Штраф/бонус: {formatMoney(moneyImpact) || '0 ₸'}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onAddItem}
            className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-950/20 text-emerald-200 hover:bg-emerald-950/40"
            title="Добавить пункт"
          >
            <Plus className="h-4 w-4" />
          </button>
          <RowActions onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>

      <div className="mt-5 space-y-3 border-t border-slate-800 pt-4">
        {items.map((item, index) => {
          const linkedArticle = item.knowledge_article_id ? articleById.get(item.knowledge_article_id) : null
          return (
            <div key={item.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-xs font-black text-emerald-100">
                      {index + 1}
                    </span>
                    <p className="break-words font-black text-slate-100">{item.title}</p>
                  </div>
                  <p className="mt-2 break-words text-xs leading-5 text-slate-500">{item.description || 'Без пояснения для оператора.'}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{SEVERITY_LABELS[item.severity]}</Badge>
                    <Badge>{ANSWER_TYPE_LABELS[item.answer_type] || item.answer_type}</Badge>
                    {item.is_required && <Badge>обязательно</Badge>}
                    {item.requires_photo && <Badge>фото обязательно</Badge>}
                    {formatMoney(item.fine_amount) ? <Badge>штраф {formatMoney(item.fine_amount)}</Badge> : null}
                    {formatMoney(item.bonus_amount) ? <Badge>бонус {formatMoney(item.bonus_amount)}</Badge> : null}
                    {linkedArticle ? <Badge>FAQ: {linkedArticle.title}</Badge> : null}
                  </div>
                </div>
                <RowActions onEdit={() => onEditItem(item)} onDelete={() => onDeleteItem(item)} />
              </div>
            </div>
          )
        })}
        {!items.length && (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-sm leading-6 text-slate-500">
            Пунктов пока нет. Нажмите плюс на карточке, чтобы добавить первый пункт.
          </div>
        )}
      </div>
    </article>
  )
}
