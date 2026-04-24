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

type CategoryKind = 'rules' | 'faq' | 'salary' | 'problem' | 'checklist'

type KnowledgeCategory = {
  id: string
  title: string
  slug: string
  description: string | null
  kind: CategoryKind
  sort_order: number
  is_active: boolean
}

type KnowledgeArticle = {
  id: string
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
}

type ChecklistTemplate = {
  id: string
  company_id: string | null
  title: string
  description: string | null
  role_scope: string
  shift_scope: string
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
  description: '',
  kind: 'faq' as CategoryKind,
  sort_order: 100,
  is_active: true,
}

const emptyArticle = {
  title: '',
  category_id: '',
  summary: '',
  content: '',
  tags: '',
  audience: 'operator,cashier,manager',
  severity: 'info' as const,
  related_fine_amount: '',
  related_bonus_amount: '',
  sort_order: 100,
  is_published: true,
}

const emptyTemplate = {
  title: '',
  description: '',
  company_id: '',
  role_scope: 'operator',
  shift_scope: 'any',
  sort_order: 100,
  is_active: true,
}

const emptyItem = {
  template_id: '',
  category_id: '',
  knowledge_article_id: '',
  title: '',
  description: '',
  answer_type: 'boolean' as const,
  severity: 'normal' as const,
  fine_amount: '',
  bonus_amount: '',
  sort_order: 100,
  is_required: true,
  requires_photo: false,
}

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [categoryForm, setCategoryForm] = useState<any>(emptyCategory)
  const [articleForm, setArticleForm] = useState<any>(emptyArticle)
  const [templateForm, setTemplateForm] = useState<any>(emptyTemplate)
  const [itemForm, setItemForm] = useState<any>(emptyItem)

  const categoryById = useMemo(() => {
    return new Map(data.categories.map((category) => [category.id, category]))
  }, [data.categories])

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
    if (!needle) return data.articles
    return data.articles.filter((article) => {
      return [article.title, article.summary, article.content, article.tags?.join(' ')]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    })
  }, [data.articles, query])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/knowledge', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить базу знаний')
      const normalized = normalizeKnowledgeResponse(payload)
      setData(normalized)
      setItemForm((current: any) => ({
        ...current,
        template_id: current.template_id || normalized.templates[0]?.id || '',
      }))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

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
      sort_order: Number(categoryForm.sort_order || 100),
    })
    if (result) setCategoryForm(emptyCategory)
  }

  async function submitArticle(event: FormEvent) {
    event.preventDefault()
    const result = await send('upsertArticle', {
      ...articleForm,
      category_id: normalizeId(articleForm.category_id),
      tags: splitList(articleForm.tags || ''),
      audience: splitList(articleForm.audience || ''),
      related_fine_amount: moneyOrNull(articleForm.related_fine_amount),
      related_bonus_amount: moneyOrNull(articleForm.related_bonus_amount),
      sort_order: Number(articleForm.sort_order || 100),
    })
    if (result) setArticleForm(emptyArticle)
  }

  async function submitTemplate(event: FormEvent) {
    event.preventDefault()
    const result = await send('upsertTemplate', {
      ...templateForm,
      company_id: normalizeId(templateForm.company_id),
      sort_order: Number(templateForm.sort_order || 100),
    })
    if (result) setTemplateForm(emptyTemplate)
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault()
    const result = await send('upsertItem', {
      ...itemForm,
      template_id: normalizeId(itemForm.template_id),
      category_id: normalizeId(itemForm.category_id),
      knowledge_article_id: normalizeId(itemForm.knowledge_article_id),
      fine_amount: moneyOrNull(itemForm.fine_amount),
      bonus_amount: moneyOrNull(itemForm.bonus_amount),
      sort_order: Number(itemForm.sort_order || 100),
    })
    if (result) {
      setItemForm({
        ...emptyItem,
        template_id: itemForm.template_id,
      })
    }
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
              <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(460px,520px)]">
                <Panel title="Материалы для операторов" icon={FileText}>
                  <TabHint
                    title="Что здесь создавать?"
                    text="Это сами правила и ответы: как открыть смену, что делать если не работает Kaspi, когда штраф, когда премия, как разговаривать с клиентом."
                  />
                  <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                    <Search className="h-4 w-4 text-slate-500" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Поиск по FAQ, правилам, проблемам..."
                      className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                    />
                  </div>

                  <div className="grid gap-3">
                    {filteredArticles.map((article) => (
                      <ArticleCard
                        key={article.id}
                        article={article}
                        category={article.category_id ? categoryById.get(article.category_id) : undefined}
                        onEdit={() =>
                          setArticleForm({
                            ...article,
                            category_id: article.category_id || '',
                            summary: article.summary || '',
                            tags: article.tags?.join(', ') || '',
                            audience: article.audience?.join(', ') || '',
                            related_fine_amount: article.related_fine_amount ?? '',
                            related_bonus_amount: article.related_bonus_amount ?? '',
                          })
                        }
                        onDelete={() => send('deleteArticle', undefined, article.id)}
                      />
                    ))}
                    {!filteredArticles.length && <EmptyState text="Материалов пока нет. Создайте первую инструкцию или нажмите «Создать базу F16»." />}
                  </div>
                </Panel>

                <Panel title={articleForm.id ? 'Редактировать материал' : 'Новый материал'} icon={Plus}>
                  <form onSubmit={submitArticle} className="space-y-4">
                    <div className="space-y-2">
                      <FieldLabel>Название</FieldLabel>
                      <TextInput value={articleForm.title} onChange={(event) => setArticleForm({ ...articleForm, title: event.target.value })} required />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <FieldLabel>Категория</FieldLabel>
                        <SelectInput value={articleForm.category_id} onChange={(event) => setArticleForm({ ...articleForm, category_id: event.target.value })}>
                          <option value="">Без категории</option>
                          {data.categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.title}
                            </option>
                          ))}
                        </SelectInput>
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>Важность</FieldLabel>
                        <SelectInput value={articleForm.severity} onChange={(event) => setArticleForm({ ...articleForm, severity: event.target.value })}>
                          {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </SelectInput>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Краткое описание</FieldLabel>
                      <TextArea value={articleForm.summary} onChange={(event) => setArticleForm({ ...articleForm, summary: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Полный текст</FieldLabel>
                      <TextArea value={articleForm.content} onChange={(event) => setArticleForm({ ...articleForm, content: event.target.value })} required className="min-h-44" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <FieldLabel>Теги через запятую</FieldLabel>
                        <TextInput value={articleForm.tags} onChange={(event) => setArticleForm({ ...articleForm, tags: event.target.value })} placeholder="касса, смена, конфликт" />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>Аудитория</FieldLabel>
                        <TextInput value={articleForm.audience} onChange={(event) => setArticleForm({ ...articleForm, audience: event.target.value })} placeholder="operator,cashier,manager" />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <FieldLabel>Штраф, ₸</FieldLabel>
                        <TextInput value={articleForm.related_fine_amount} onChange={(event) => setArticleForm({ ...articleForm, related_fine_amount: event.target.value })} inputMode="numeric" />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>Бонус, ₸</FieldLabel>
                        <TextInput value={articleForm.related_bonus_amount} onChange={(event) => setArticleForm({ ...articleForm, related_bonus_amount: event.target.value })} inputMode="numeric" />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>Порядок</FieldLabel>
                        <TextInput value={articleForm.sort_order} onChange={(event) => setArticleForm({ ...articleForm, sort_order: event.target.value })} inputMode="numeric" />
                      </div>
                    </div>
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                      <input type="checkbox" checked={articleForm.is_published} onChange={(event) => setArticleForm({ ...articleForm, is_published: event.target.checked })} />
                      Опубликовано для операторов
                    </label>
                    <FormActions saving={saving} reset={() => setArticleForm(emptyArticle)} isEditing={Boolean(articleForm.id)} />
                  </form>
                </Panel>
              </div>
            )}

            {tab === 'checklists' && (
              <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(460px,520px)]">
                <Panel title="Шаблоны чек-листов" icon={ClipboardList}>
                  <TabHint
                    title="Как работает чек-лист?"
                    text="Сначала создаётся шаблон смены, например «Приём смены». Потом внутрь добавляются пункты: проверить кассу, чистоту, склад, терминал, фото-отчёт."
                  />
                  <div className="grid gap-4">
                    {data.templates.map((template) => (
                      <div key={template.id} className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950/50 p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="break-words text-xl font-black">{template.title}</h3>
                            <p className="mt-1 break-words text-sm leading-6 text-slate-400">{template.description || 'Без описания'}</p>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                              <Badge>{template.role_scope}</Badge>
                              <Badge>{template.shift_scope}</Badge>
                              <Badge>{template.is_active ? 'active' : 'off'}</Badge>
                            </div>
                          </div>
                          <RowActions
                            onEdit={() => setTemplateForm({ ...template, company_id: template.company_id || '', description: template.description || '' })}
                            onDelete={() => send('deleteTemplate', undefined, template.id)}
                          />
                        </div>
                        <div className="mt-4 grid gap-2">
                          {(itemsByTemplate.get(template.id) ?? []).map((item) => (
                            <div key={item.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <CheckSquare className="h-4 w-4 text-emerald-300" />
                                  <p className="break-words font-bold">{item.title}</p>
                                </div>
                                <p className="mt-1 break-words text-xs leading-5 text-slate-500">{item.description || 'Без пояснения'}</p>
                              </div>
                              <RowActions
                                onEdit={() =>
                                  setItemForm({
                                    ...item,
                                    category_id: item.category_id || '',
                                    knowledge_article_id: item.knowledge_article_id || '',
                                    description: item.description || '',
                                    fine_amount: item.fine_amount ?? '',
                                    bonus_amount: item.bonus_amount ?? '',
                                  })
                                }
                                onDelete={() => send('deleteItem', undefined, item.id)}
                              />
                            </div>
                          ))}
                          {!(itemsByTemplate.get(template.id) ?? []).length && <EmptyState text="Пунктов пока нет." />}
                        </div>
                      </div>
                    ))}
                    {!data.templates.length && <EmptyState text="Шаблонов пока нет. Создайте шаблон смены или базовую структуру." />}
                  </div>
                </Panel>

                <div className="space-y-6">
                  <Panel title={templateForm.id ? 'Редактировать шаблон' : 'Новый шаблон'} icon={Plus}>
                    <form onSubmit={submitTemplate} className="space-y-4">
                      <div className="space-y-2">
                        <FieldLabel>Название</FieldLabel>
                        <TextInput value={templateForm.title} onChange={(event) => setTemplateForm({ ...templateForm, title: event.target.value })} required />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>Описание</FieldLabel>
                        <TextArea value={templateForm.description} onChange={(event) => setTemplateForm({ ...templateForm, description: event.target.value })} />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabel>Точка</FieldLabel>
                          <SelectInput value={templateForm.company_id} onChange={(event) => setTemplateForm({ ...templateForm, company_id: event.target.value })}>
                            <option value="">Для всех точек</option>
                            {data.companies.map((company) => (
                              <option key={company.id} value={company.id}>
                                {company.name}
                              </option>
                            ))}
                          </SelectInput>
                        </div>
                        <div className="space-y-2">
                          <FieldLabel>Смена</FieldLabel>
                          <SelectInput value={templateForm.shift_scope} onChange={(event) => setTemplateForm({ ...templateForm, shift_scope: event.target.value })}>
                            <option value="any">Любая</option>
                            <option value="day">День</option>
                            <option value="night">Ночь</option>
                            <option value="opening">Открытие</option>
                            <option value="closing">Закрытие</option>
                          </SelectInput>
                        </div>
                      </div>
                      <FormActions saving={saving} reset={() => setTemplateForm(emptyTemplate)} isEditing={Boolean(templateForm.id)} />
                    </form>
                  </Panel>

                  <Panel title={itemForm.id ? 'Редактировать пункт' : 'Новый пункт'} icon={CheckSquare}>
                    <form onSubmit={submitItem} className="space-y-4">
                      <div className="space-y-2">
                        <FieldLabel>Шаблон</FieldLabel>
                        <SelectInput value={itemForm.template_id} onChange={(event) => setItemForm({ ...itemForm, template_id: event.target.value })} required>
                          <option value="">Выберите шаблон</option>
                          {data.templates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.title}
                            </option>
                          ))}
                        </SelectInput>
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>Пункт чек-листа</FieldLabel>
                        <TextInput value={itemForm.title} onChange={(event) => setItemForm({ ...itemForm, title: event.target.value })} required />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>Описание</FieldLabel>
                        <TextArea value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabel>Связанная статья</FieldLabel>
                          <SelectInput value={itemForm.knowledge_article_id} onChange={(event) => setItemForm({ ...itemForm, knowledge_article_id: event.target.value })}>
                            <option value="">Не привязана</option>
                            {data.articles.map((article) => (
                              <option key={article.id} value={article.id}>
                                {article.title}
                              </option>
                            ))}
                          </SelectInput>
                        </div>
                        <div className="space-y-2">
                          <FieldLabel>Ответ</FieldLabel>
                          <SelectInput value={itemForm.answer_type} onChange={(event) => setItemForm({ ...itemForm, answer_type: event.target.value })}>
                            <option value="boolean">Галочка</option>
                            <option value="text">Текст</option>
                            <option value="number">Число</option>
                            <option value="photo">Фото</option>
                            <option value="choice">Выбор</option>
                          </SelectInput>
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <TextInput value={itemForm.fine_amount} onChange={(event) => setItemForm({ ...itemForm, fine_amount: event.target.value })} placeholder="Штраф ₸" inputMode="numeric" />
                        <TextInput value={itemForm.bonus_amount} onChange={(event) => setItemForm({ ...itemForm, bonus_amount: event.target.value })} placeholder="Бонус ₸" inputMode="numeric" />
                        <TextInput value={itemForm.sort_order} onChange={(event) => setItemForm({ ...itemForm, sort_order: event.target.value })} placeholder="Порядок" inputMode="numeric" />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                          <input type="checkbox" checked={itemForm.is_required} onChange={(event) => setItemForm({ ...itemForm, is_required: event.target.checked })} />
                          Обязательный пункт
                        </label>
                        <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                          <input type="checkbox" checked={itemForm.requires_photo} onChange={(event) => setItemForm({ ...itemForm, requires_photo: event.target.checked })} />
                          Требовать фото
                        </label>
                      </div>
                      <FormActions saving={saving} reset={() => setItemForm({ ...emptyItem, template_id: itemForm.template_id })} isEditing={Boolean(itemForm.id)} />
                    </form>
                  </Panel>
                </div>
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
                            <Badge>{KIND_LABELS[category.kind]}</Badge>
                            <h3 className="mt-3 break-words text-xl font-black">{category.title}</h3>
                            <p className="mt-2 break-words text-sm leading-6 text-slate-400">{category.description || 'Без описания'}</p>
                          </div>
                          <RowActions
                            onEdit={() => setCategoryForm({ ...category, description: category.description || '' })}
                            onDelete={() => send('deleteCategory', undefined, category.id)}
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
  onEdit,
  onDelete,
}: {
  article: KnowledgeArticle
  category?: KnowledgeCategory
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <article className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950/50 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {category && <Badge>{category.title}</Badge>}
            <Badge>{SEVERITY_LABELS[article.severity]}</Badge>
            <Badge>{article.is_published ? 'Опубликовано' : 'Черновик'}</Badge>
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
