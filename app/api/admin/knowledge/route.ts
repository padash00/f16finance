import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { listOrganizationCompanyIds, resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'

type CategoryPayload = {
  id?: string
  company_id?: string | null
  title: string
  slug?: string | null
  description?: string | null
  kind?: string | null
  sort_order?: number | null
  is_active?: boolean | null
}

type ArticlePayload = {
  id?: string
  company_id?: string | null
  category_id?: string | null
  title: string
  slug?: string | null
  summary?: string | null
  content?: string | null
  tags?: string[] | string | null
  audience?: string[] | string | null
  severity?: string | null
  related_fine_amount?: number | null
  related_bonus_amount?: number | null
  sort_order?: number | null
  is_published?: boolean | null
  requires_confirmation?: boolean | null
}

type TemplatePayload = {
  id?: string
  company_id?: string | null
  title: string
  description?: string | null
  role_scope?: string | null
  shift_scope?: string | null
  schedule_type?: string | null
  recurrence_minutes?: number | null
  blocks_shift?: boolean | null
  sort_order?: number | null
  is_active?: boolean | null
}

type ItemPayload = {
  id?: string
  template_id: string
  category_id?: string | null
  knowledge_article_id?: string | null
  title: string
  description?: string | null
  answer_type?: string | null
  is_required?: boolean | null
  requires_photo?: boolean | null
  severity?: string | null
  fine_amount?: number | null
  bonus_amount?: number | null
  sort_order?: number | null
}

type ImportArticle = {
  title: string
  category?: string | null
  summary?: string | null
  content?: string | null
  severity?: string | null
  requires_confirmation?: boolean
  tags?: string[] | null
  company_id?: string | null
}

type ImportChecklist = {
  title: string
  description?: string | null
  schedule_type?: string | null
  recurrence_minutes?: number | null
  blocks_shift?: boolean
  company_id?: string | null
  items?: Array<{
    title: string
    answer_type?: string | null
    is_required?: boolean
    requires_photo?: boolean
  }>
}

type ImportPayload = {
  articles?: ImportArticle[]
  checklists?: ImportChecklist[]
  /** true — существующие статьи обновляются новой редакцией, иначе пропускаются. */
  update_existing?: boolean
}

type Body =
  | { action: 'upsertCategory'; payload: CategoryPayload }
  | { action: 'deleteCategory'; id: string }
  | { action: 'upsertArticle'; payload: ArticlePayload }
  | { action: 'deleteArticle'; id: string }
  | { action: 'setArticlePublished'; payload: { id: string; is_published: boolean } }
  | { action: 'upsertTemplate'; payload: TemplatePayload }
  | { action: 'deleteTemplate'; id: string }
  | { action: 'upsertItem'; payload: ItemPayload }
  | { action: 'deleteItem'; id: string }
  | { action: 'seedDefaults' }
  | { action: 'applyImport'; payload: ImportPayload }
  | { action: 'duplicateTemplate'; id: string; company_id?: string | null; title?: string }

const CATEGORY_KINDS = new Set(['rules', 'faq', 'salary', 'problem', 'checklist'])
const SEVERITIES = new Set(['info', 'normal', 'warning', 'critical'])
const ROLE_SCOPES = new Set(['operator', 'cashier', 'senior_operator', 'senior_cashier', 'any'])
const SHIFT_SCOPES = new Set(['day', 'night', 'opening', 'closing', 'handover', 'any'])
const SCHEDULE_TYPES = new Set(['opening', 'periodic', 'closing', 'onboarding', 'handover'])
const ANSWER_TYPES = new Set(['boolean', 'text', 'number', 'photo', 'choice'])

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function slugify(value: string) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `item-${Date.now()}`
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : null
}

function sortOrder(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : 100
}

function arrayFromInput(value: string[] | string | null | undefined, fallback: string[]) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    return items.length ? items : fallback
  }
  return fallback
}

function scopedOr(organizationId: string | null | undefined) {
  return organizationId ? `organization_id.is.null,organization_id.eq.${organizationId}` : null
}

function ensureEditableOrganization(rowOrganizationId: string | null | undefined, activeOrganizationId: string | null, isSuperAdmin: boolean) {
  if (isSuperAdmin && !activeOrganizationId) return
  // NEVER-паттерн: без организации обычный пользователь не редактирует ничего.
  // Раньше здесь был return — пустая организация открывала правку любых записей.
  if (!activeOrganizationId) {
    throw new Error('Организация не выбрана')
  }
  if (rowOrganizationId && rowOrganizationId !== activeOrganizationId) {
    throw new Error('Запись принадлежит другой организации')
  }
}

const ARTICLE_LIST_COLUMNS =
  'id, organization_id, company_id, category_id, title, slug, summary, tags, audience, severity, related_fine_amount, related_bonus_amount, sort_order, is_published, requires_confirmation, version, updated_at'

async function loadKnowledgeData(params: { organizationId: string | null; isSuperAdmin: boolean }) {
  const supabase = createAdminSupabaseClient()
  const allowedCompanyIds = await listOrganizationCompanyIds({
    activeOrganizationId: params.organizationId,
    isSuperAdmin: params.isSuperAdmin,
  })

  let categoriesQuery = supabase
    .from('knowledge_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true })
  let articlesQuery = supabase
    .from('knowledge_articles')
    .select(ARTICLE_LIST_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false })
  let templatesQuery = supabase
    .from('checklist_templates')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true })
  const scope = scopedOr(params.organizationId)
  if (scope) {
    categoriesQuery = categoriesQuery.or(scope)
    articlesQuery = articlesQuery.or(scope)
    templatesQuery = templatesQuery.or(scope)
  }

  let companiesQuery = supabase.from('companies').select('id, name, code').order('name', { ascending: true })
  if (allowedCompanyIds) {
    if (allowedCompanyIds.length === 0) {
      return { categories: [], articles: [], templates: [], items: [], companies: [] }
    }
    companiesQuery = companiesQuery.in('id', allowedCompanyIds)
  }

  const [categoriesResult, articlesResult, templatesResult, companiesResult] = await Promise.all([
    categoriesQuery,
    articlesQuery,
    templatesQuery,
    companiesQuery,
  ])

  if (categoriesResult.error) throw categoriesResult.error
  if (articlesResult.error) throw articlesResult.error
  if (templatesResult.error) throw templatesResult.error
  if (companiesResult.error) throw companiesResult.error

  const templateIds = (templatesResult.data || []).map((item) => String(item.id))
  let items: any[] = []
  if (templateIds.length) {
    const { data, error } = await supabase
      .from('checklist_items')
      .select('*')
      .in('template_id', templateIds)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    items = data || []
  }

  const templates = templatesResult.data || []
  const companies = companiesResult.data || []
  const templateById = new Map(templates.map((template: any) => [String(template.id), template]))
  const companyById = new Map(companies.map((company: any) => [String(company.id), company]))
  const itemsByTemplate = new Map<string, any[]>()
  for (const item of items) {
    const list = itemsByTemplate.get(String(item.template_id)) || []
    list.push(item)
    itemsByTemplate.set(String(item.template_id), list)
  }

  let runs: any[] = []
  if (templateIds.length) {
    const { data: rawRuns, error: runsError } = await supabase
      .from('checklist_runs')
      .select('id, shift_id, template_id, run_by, co_signed_by, started_at, completed_at, scheduled_at, status, responses, fines_total, bonuses_total, created_at, updated_at')
      .in('template_id', templateIds)
      .order('created_at', { ascending: false })
      .limit(150)
    if (runsError) throw runsError

    const shiftIds = Array.from(new Set((rawRuns || []).map((run: any) => run.shift_id).filter(Boolean).map(String)))
    const staffIds = Array.from(
      new Set(
        (rawRuns || [])
          .flatMap((run: any) => [run.run_by, run.co_signed_by])
          .filter(Boolean)
          .map(String),
      ),
    )

    const [shiftsResult, staffResult] = await Promise.all([
      shiftIds.length
        ? supabase
            .from('point_shifts')
            .select('id, company_id, opened_at, closed_at, shift_type, status')
            .in('id', shiftIds)
        : Promise.resolve({ data: [], error: null }),
      staffIds.length
        ? supabase
            .from('staff')
            .select('id, full_name, short_name, email')
            .in('id', staffIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (shiftsResult.error) throw shiftsResult.error
    if (staffResult.error) throw staffResult.error

    const shiftById = new Map(((shiftsResult.data || []) as any[]).map((shift) => [String(shift.id), shift]))
    const staffById = new Map(((staffResult.data || []) as any[]).map((staff) => [String(staff.id), staff]))
    const allowedCompanySet = allowedCompanyIds ? new Set(allowedCompanyIds) : null

    runs = ((rawRuns || []) as any[])
      .map((run) => {
        const shift = shiftById.get(String(run.shift_id))
        const companyId = shift?.company_id || templateById.get(String(run.template_id))?.company_id || null
        if (allowedCompanySet && companyId && !allowedCompanySet.has(companyId)) return null
        const responses = run.responses && typeof run.responses === 'object' && !Array.isArray(run.responses)
          ? run.responses
          : {}
        const responseValues = Object.values(responses as Record<string, any>)
        const failedCount = responseValues.filter((response: any) => response?.passed === false || response?.value === false).length
        const templateItems = itemsByTemplate.get(String(run.template_id)) || []
        const responseItems = templateItems.map((item: any) => {
          const response = (responses as Record<string, any>)[String(item.id)] || null
          const hasResponse = response !== null
          const failed = response?.passed === false || response?.value === false
          const value = response?.value
          const hasValue =
            typeof value === 'boolean' ||
            typeof value === 'number' ||
            (typeof value === 'string' && value.trim().length > 0) ||
            (Array.isArray(value) && value.length > 0)
          const hasPhoto = typeof response?.photo_data_url === 'string' && response.photo_data_url.trim().length > 0
          const hasNote = typeof response?.note === 'string' && response.note.trim().length > 0
          const hasComment = typeof response?.comment === 'string' && response.comment.trim().length > 0
          const isNonBooleanAnswered =
            item.answer_type === 'photo' ? hasPhoto : hasValue || hasPhoto || hasNote || hasComment
          const passed = failed
            ? false
            : response?.passed === true || response?.value === true || (hasResponse && item.answer_type !== 'boolean' && isNonBooleanAnswered)
          return {
            id: item.id,
            title: item.title,
            is_required: item.is_required,
            requires_photo: item.requires_photo,
            severity: item.severity,
            fine_amount: item.fine_amount,
            bonus_amount: item.bonus_amount,
            answer_type: item.answer_type,
            passed: hasResponse ? passed : null,
            failed,
            value: response?.value ?? null,
            note: response?.note || response?.comment || null,
            photo_data_url: response?.photo_data_url || null,
            photo_name: response?.photo_name || null,
            photo_captured_at: response?.photo_captured_at || null,
          }
        })
        const runner = run.run_by ? staffById.get(String(run.run_by)) : null
        const cosigner = run.co_signed_by ? staffById.get(String(run.co_signed_by)) : null
        const company = companyId ? companyById.get(String(companyId)) : null

        return {
          ...run,
          template_title: templateById.get(String(run.template_id))?.title || 'Чек-лист',
          company_id: companyId,
          company_name: company?.name || null,
          shift_type: shift?.shift_type || null,
          shift_status: shift?.status || null,
          shift_opened_at: shift?.opened_at || null,
          run_by_name: runner?.full_name || runner?.short_name || runner?.email || null,
          co_signed_by_name: cosigner?.full_name || cosigner?.short_name || cosigner?.email || null,
          item_count: templateItems.length,
          answered_count: responseValues.length,
          failed_count: failedCount,
          response_items: responseItems,
        }
      })
      .filter(Boolean)
  }

  return {
    categories: categoriesResult.data || [],
    articles: articlesResult.data || [],
    templates,
    items,
    companies,
    runs,
  }
}

async function seedDefaults(organizationId: string | null, actorUserId: string | null) {
  const supabase = createAdminSupabaseClient()
  const defaults = [
    { title: 'Правила смены', slug: 'shift-rules', kind: 'rules', description: 'Приём, ведение и сдача смены.' },
    { title: 'FAQ по проблемам', slug: 'problem-faq', kind: 'problem', description: 'Быстрые решения проблем в клубе и магазине.' },
    { title: 'Зарплата, штрафы и премии', slug: 'salary-rules', kind: 'salary', description: 'Финансовые правила для операторов.' },
    { title: 'Чек-листы', slug: 'checklists', kind: 'checklist', description: 'Проверки приёма, обхода и сдачи смены.' },
  ]

  const { data: existingCategories, error: categoriesError } = await supabase
    .from('knowledge_categories')
    .select('*')
    .or(scopedOr(organizationId) || 'organization_id.is.null')
  if (categoriesError) throw categoriesError

  const bySlug = new Map((existingCategories || []).map((item: any) => [String(item.slug), item]))
  for (let index = 0; index < defaults.length; index += 1) {
    const item = defaults[index]
    if (bySlug.has(item.slug)) continue
    const { data, error } = await supabase
      .from('knowledge_categories')
      .insert([{ ...item, organization_id: organizationId, sort_order: (index + 1) * 10 }])
      .select('*')
      .single()
    if (error) throw error
    bySlug.set(item.slug, data)
  }

  const articles = [
    {
      category: 'shift-rules',
      title: 'Как правильно принять смену',
      slug: 'shift-handover-acceptance',
      industry: 'club',
      topic_key: 'shift_handover',
      summary: 'Смена принимается только после обхода, проверки оборудования и фиксации проблем.',
      content:
        'До принятия смены оператор вместе со сменщиком проходит зал, проверяет чистоту, оборудование, PRO/VIP, PS5/VR/SimRacing, кассу, магазин и активные брони. Все проблемы фиксируются до принятия смены. Если проблема не зафиксирована, ответственность переходит на принимающего смену.',
      tags: ['пересменка', 'прием смены', 'ответственность'],
      severity: 'warning',
    },
    {
      category: 'problem-faq',
      title: 'Что делать, если не работает компьютер',
      slug: 'pc-not-working',
      industry: 'club',
      topic_key: 'club_pc_failure',
      summary: 'Быстрый порядок действий при технической проблеме у клиента.',
      content:
        '1. Спокойно уточнить проблему у клиента. 2. Проверить питание, монитор, мышку, клавиатуру, интернет и запуск игры. 3. Если можно решить на месте — решить и извиниться за ожидание. 4. Если не решается — пересадить клиента, зафиксировать номер ПК и проблему, сообщить руководителю. 5. Не оставлять неисправный ПК без отметки.',
      tags: ['пк', 'техника', 'клиент'],
      severity: 'normal',
    },
    {
      category: 'salary-rules',
      title: 'Штрафы и премии: общий принцип',
      slug: 'salary-fines-bonuses-principle',
      industry: null,
      topic_key: 'shift_pay_rules',
      summary: 'Штрафы фиксируют нарушения, премии поощряют стабильную качественную работу.',
      content:
        'Премия — это не подарок, а поощрение за стабильное выполнение правил. Штраф применяется за конкретное нарушение с причиной. Серьёзные случаи должны проходить проверку руководителем. Идеальная смена может давать бонус, а повторные нарушения усиливают ответственность.',
      tags: ['зарплата', 'штраф', 'премия'],
      severity: 'info',
      requires_confirmation: true,
    },
    {
      category: 'shift-rules',
      title: 'Неразглашение внутренней информации',
      slug: 'operator-confidentiality-rules',
      industry: null,
      topic_key: 'confidentiality',
      summary: 'Оператор не передаёт внутренние данные, цены, отчёты, доступы, переписки и данные клиентов третьим лицам.',
      content:
        '<p>Оператор получает доступ только для выполнения рабочих задач. Запрещено передавать логины, пароли, скриншоты отчётов, данные клиентов, суммы кассы, внутренние инструкции и переписки третьим лицам.</p><p>Если доступ был потерян, телефон украден или появился подозрительный запрос — нужно сразу сообщить руководителю.</p>',
      tags: ['конфиденциальность', 'доступы', 'безопасность'],
      severity: 'critical',
      requires_confirmation: true,
    },
    {
      category: 'shift-rules',
      title: 'Техника безопасности и ответственность на смене',
      slug: 'operator-safety-responsibility',
      industry: null,
      topic_key: 'safety',
      summary: 'Базовые правила безопасности для зала, кассы, техники и конфликтных ситуаций.',
      content:
        '<p>Главный принцип: не рисковать собой, клиентами и имуществом клуба. При конфликте оператор не спорит агрессивно, фиксирует ситуацию и зовёт руководителя.</p><p>Нельзя самостоятельно вскрывать опасное оборудование, переносить тяжёлые предметы без помощи, оставлять зал без контроля и игнорировать запах гари, перегрев или повреждения проводов.</p>',
      tags: ['безопасность', 'ответственность', 'клиенты'],
      severity: 'warning',
      requires_confirmation: true,
    },
    {
      category: 'salary-rules',
      title: 'Долги оператора: только просмотр',
      slug: 'operator-debts-view-only',
      industry: null,
      topic_key: 'shift_pay_rules',
      summary: 'Оператор видит свои долги, но не закрывает их вручную в программе.',
      content:
        '<p>Долги в кабинете оператора нужны для прозрачности: оператор видит, какие позиции и суммы закреплены за ним.</p><p>Оператор не нажимает “оплатил” и не закрывает долг самостоятельно. Погашение выполняет руководитель через расчёт зарплаты или административную часть.</p>',
      tags: ['долги', 'зарплата', 'правила'],
      severity: 'warning',
      requires_confirmation: true,
    },
  ]

  const { data: existingArticles, error: articlesError } = await supabase
    .from('knowledge_articles')
    .select('slug')
    .or(scopedOr(organizationId) || 'organization_id.is.null')
  if (articlesError) throw articlesError
  const existingArticleSlugs = new Set((existingArticles || []).map((item: any) => String(item.slug)))

  for (let index = 0; index < articles.length; index += 1) {
    const item = articles[index]
    if (existingArticleSlugs.has(item.slug)) continue
    const category = bySlug.get(item.category)
    const { error } = await supabase.from('knowledge_articles').insert([
      {
        organization_id: organizationId,
        category_id: category?.id || null,
        title: item.title,
        slug: item.slug,
        summary: item.summary,
        content: item.content,
        tags: item.tags,
        audience: ['operator', 'cashier'],
        severity: item.severity,
        requires_confirmation: item.requires_confirmation === true,
        sort_order: (index + 1) * 10,
        // Ниша и тема каркаса. Без industry клубная статья («не работает
        // компьютер») попадала бы в экзамен продавца магазина: подбор считает
        // общесетевую статью без ниши годной для всех точек.
        industry: item.industry ?? null,
        topic_key: item.topic_key ?? null,
        source: 'seed',
      },
    ])
    if (error) throw error
  }

  const { data: existingTemplates, error: templatesError } = await supabase
    .from('checklist_templates')
    .select('id, title')
    .or(scopedOr(organizationId) || 'organization_id.is.null')
  if (templatesError) throw templatesError
  const templateTitle = 'Приём смены оператора'
  let template = (existingTemplates || []).find((item: any) => item.title === templateTitle)
  if (!template) {
    const { data, error } = await supabase
      .from('checklist_templates')
      .insert([
        {
          organization_id: organizationId,
          title: templateTitle,
          description: 'Базовая проверка до принятия ответственности за смену.',
          role_scope: 'operator',
          shift_scope: 'handover',
          schedule_type: 'handover',
          blocks_shift: true,
          sort_order: 10,
        },
      ])
      .select('id, title')
      .single()
    if (error) throw error
    template = data
  }

  const { data: existingItems, error: itemsError } = await supabase
    .from('checklist_items')
    .select('title')
    .eq('template_id', template.id)
  if (itemsError) throw itemsError
  const existingItemTitles = new Set((existingItems || []).map((item: any) => String(item.title)))
  const checklistItems = [
    'Проверить чистоту столов, кресел, пола и барной зоны',
    'Проверить наличие мышек, клавиатур, гарнитур и донглов',
    'Проверить PRO/VIP, PS5, VR и SimRacing',
    'Проверить активные брони и проблемные ситуации',
    'Зафиксировать все проблемы до принятия смены',
  ]
  for (let index = 0; index < checklistItems.length; index += 1) {
    const title = checklistItems[index]
    if (existingItemTitles.has(title)) continue
    const { error } = await supabase.from('checklist_items').insert([
      {
        template_id: template.id,
        category_id: bySlug.get('checklists')?.id || null,
        title,
        answer_type: 'boolean',
        is_required: true,
        requires_photo: index === 4,
        severity: index === 4 ? 'warning' : 'normal',
        sort_order: (index + 1) * 10,
      },
    ])
    if (error) throw error
  }

  const templateSeeds = [
    {
      title: 'Обход каждые 2 часа',
      description: 'Периодическая проверка зала, техники, чистоты, клиентов и магазина каждые 120 минут.',
      schedule_type: 'periodic',
      shift_scope: 'any',
      recurrence_minutes: 120,
      blocks_shift: false,
      sort_order: 20,
      items: [
        { title: 'Проверить чистоту зала, столов, кресел и проходов', requires_photo: false, severity: 'normal' },
        { title: 'Проверить свободные и занятые места, чтобы не было забытых вещей', requires_photo: false, severity: 'normal' },
        { title: 'Проверить работу проблемной техники и отметить новые поломки', requires_photo: true, severity: 'warning' },
        { title: 'Проверить витрину/бар и низкие остатки', requires_photo: false, severity: 'normal' },
      ],
    },
    {
      title: 'Закрытие смены',
      description: 'Финальная проверка перед закрытием: касса, отчёт, долги, уборка и оборудование.',
      schedule_type: 'closing',
      shift_scope: 'closing',
      recurrence_minutes: null,
      blocks_shift: true,
      sort_order: 30,
      items: [
        { title: 'Сверить кассу, Безналичный и итог сменного отчёта', requires_photo: false, severity: 'warning' },
        { title: 'Проверить активные долги и сканер', requires_photo: false, severity: 'warning' },
        { title: 'Сделать фото состояния зала после уборки', requires_photo: true, severity: 'normal' },
        { title: 'Выключить/проверить оборудование по правилам точки', requires_photo: false, severity: 'normal' },
      ],
    },
    {
      title: 'Онбординг оператора',
      description: 'Первое ознакомление с правилами смены, FAQ, штрафами, премиями и безопасностью.',
      schedule_type: 'onboarding',
      shift_scope: 'any',
      recurrence_minutes: null,
      blocks_shift: true,
      sort_order: 40,
      items: [
        { title: 'Ознакомиться с правилами смены и ответственностью', requires_photo: false, severity: 'warning' },
        { title: 'Ознакомиться с правилами штрафов и премий', requires_photo: false, severity: 'warning' },
        { title: 'Подтвердить неразглашение внутренней информации', requires_photo: false, severity: 'critical' },
        { title: 'Открыть FAQ и найти решение тестовой проблемы', requires_photo: false, severity: 'normal' },
      ],
    },
  ]

  for (const seed of templateSeeds) {
    let seededTemplate = (existingTemplates || []).find((item: any) => item.title === seed.title)
    if (!seededTemplate) {
      const { data, error } = await supabase
        .from('checklist_templates')
        .insert([
          {
            organization_id: organizationId,
            title: seed.title,
            description: seed.description,
            role_scope: 'operator',
            shift_scope: seed.shift_scope,
            schedule_type: seed.schedule_type,
            recurrence_minutes: seed.recurrence_minutes,
            blocks_shift: seed.blocks_shift,
            sort_order: seed.sort_order,
          },
        ])
        .select('id, title')
        .single()
      if (error) throw error
      seededTemplate = data
    }

    const { data: seededItems, error: seededItemsError } = await supabase
      .from('checklist_items')
      .select('title')
      .eq('template_id', seededTemplate.id)
    if (seededItemsError) throw seededItemsError

    const seededTitles = new Set((seededItems || []).map((item: any) => String(item.title)))
    for (let index = 0; index < seed.items.length; index += 1) {
      const item = seed.items[index]
      if (seededTitles.has(item.title)) continue
      const { error } = await supabase.from('checklist_items').insert([
        {
          template_id: seededTemplate.id,
          category_id: bySlug.get('checklists')?.id || null,
          title: item.title,
          answer_type: item.requires_photo ? 'photo' : 'boolean',
          is_required: true,
          requires_photo: item.requires_photo,
          severity: item.severity,
          sort_order: (index + 1) * 10,
        },
      ])
      if (error) throw error
    }
  }

  await writeAuditLog(supabase, {
    actorUserId,
    entityType: 'knowledge-center',
    entityId: organizationId || 'global',
    action: 'seed-defaults',
    payload: { organizationId },
  })
}

/**
 * Запись разобранного документа в базу знаний.
 *
 * Импорт не трогает то, что уже есть: категория ищется по названию, статья с
 * таким же slug пропускается. Иначе повторная загрузка того же файла удвоила бы
 * всю базу, а операторы получили бы дубли в обязательных материалах.
 */
async function applyImport(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  params: {
    payload: ImportPayload
    organizationId: string | null
    isSuperAdmin: boolean
    actorUserId: string | null
  },
) {
  const { payload, organizationId, isSuperAdmin, actorUserId } = params
  const articles = Array.isArray(payload?.articles) ? payload.articles : []
  const checklists = Array.isArray(payload?.checklists) ? payload.checklists : []

  const allowedCompanyIds = await listOrganizationCompanyIds({
    activeOrganizationId: organizationId,
    isSuperAdmin,
  })
  const companyAllowed = (companyId: string | null | undefined) => {
    if (!companyId) return null
    if (!allowedCompanyIds) return companyId
    return allowedCompanyIds.includes(companyId) ? companyId : null
  }

  const { data: existingCategories } = await supabase
    .from('knowledge_categories')
    .select('id, title, slug')
    .or(scopedOr(organizationId) || 'organization_id.is.null')
  const categoryByTitle = new Map<string, string>()
  for (const row of existingCategories || []) {
    categoryByTitle.set(String((row as any).title || '').trim().toLowerCase(), String((row as any).id))
  }

  async function ensureCategory(title: string): Promise<string | null> {
    const clean = title.trim() || 'Регламент'
    const key = clean.toLowerCase()
    const existing = categoryByTitle.get(key)
    if (existing) return existing

    const { data, error } = await supabase
      .from('knowledge_categories')
      .insert([
        {
          organization_id: organizationId,
          title: clean,
          slug: slugify(clean),
          kind: 'rules',
          sort_order: (categoryByTitle.size + 1) * 10,
          is_active: true,
        },
      ])
      .select('id')
      .single()
    if (error) throw error
    const id = String((data as any).id)
    categoryByTitle.set(key, id)
    return id
  }

  const { data: existingArticles } = await supabase
    .from('knowledge_articles')
    .select('slug')
    .or(scopedOr(organizationId) || 'organization_id.is.null')
  const existingSlugs = new Set((existingArticles || []).map((row: any) => String(row.slug)))

  let createdArticles = 0
  let updatedArticles = 0
  let skippedArticles = 0
  for (let index = 0; index < articles.length; index += 1) {
    const item = articles[index]
    const title = String(item?.title || '').trim()
    if (!title) continue

    const slug = slugify(title)
    const categoryId = await ensureCategory(String(item.category || 'Регламент'))

    if (existingSlugs.has(slug)) {
      if (!payload?.update_existing) {
        skippedArticles += 1
        continue
      }
      // Триггер в БД поднимает version при смене текста и обнуляет силу старых
      // подтверждений — сотрудникам придётся ознакомиться с новой редакцией.
      // Обновление ограничено своей организацией: slug не уникален глобально,
      // без фильтра импорт переписывал бы одноимённые статьи чужих клиентов.
      let updateQuery = supabase
        .from('knowledge_articles')
        .update({
          category_id: categoryId,
          title,
          summary: item.summary?.trim() || null,
          content: item.content?.trim() || '',
          tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
          severity: SEVERITIES.has(String(item.severity || 'normal')) ? String(item.severity || 'normal') : 'normal',
          requires_confirmation: item.requires_confirmation === true,
          company_id: companyAllowed(item.company_id),
          is_published: true,
        })
        .eq('slug', slug)
      const updateScope = scopedOr(organizationId)
      if (updateScope) updateQuery = updateQuery.or(updateScope)
      else if (!isSuperAdmin) updateQuery = updateQuery.eq('organization_id', '00000000-0000-0000-0000-000000000000')
      const { error: updateError } = await updateQuery
      if (updateError) throw updateError
      updatedArticles += 1
      continue
    }

    const { error } = await supabase.from('knowledge_articles').insert([
      {
        organization_id: organizationId,
        company_id: companyAllowed(item.company_id),
        category_id: categoryId,
        title,
        slug,
        summary: item.summary?.trim() || null,
        content: item.content?.trim() || '',
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        audience: ['operator', 'cashier'],
        severity: SEVERITIES.has(String(item.severity || 'normal')) ? String(item.severity || 'normal') : 'normal',
        requires_confirmation: item.requires_confirmation === true,
        sort_order: (index + 1) * 10,
        is_published: true,
        source: 'import',
      },
    ])
    if (error) throw error
    existingSlugs.add(slug)
    createdArticles += 1
  }

  const { data: existingTemplates } = await supabase
    .from('checklist_templates')
    .select('id, title')
    .or(scopedOr(organizationId) || 'organization_id.is.null')
  const existingTemplateTitles = new Set(
    (existingTemplates || []).map((row: any) => String(row.title || '').trim().toLowerCase()),
  )

  let createdChecklists = 0
  let createdItems = 0
  let skippedChecklists = 0
  for (let index = 0; index < checklists.length; index += 1) {
    const item = checklists[index]
    const title = String(item?.title || '').trim()
    if (!title) continue
    if (existingTemplateTitles.has(title.toLowerCase())) {
      skippedChecklists += 1
      continue
    }

    const scheduleType = SCHEDULE_TYPES.has(String(item.schedule_type || 'opening'))
      ? String(item.schedule_type || 'opening')
      : 'opening'

    const { data: template, error: templateError } = await supabase
      .from('checklist_templates')
      .insert([
        {
          organization_id: organizationId,
          company_id: companyAllowed(item.company_id),
          title,
          description: item.description?.trim() || null,
          role_scope: 'operator',
          shift_scope: scheduleType === 'periodic' ? 'any' : scheduleType,
          schedule_type: scheduleType,
          recurrence_minutes:
            scheduleType === 'periodic' ? Math.max(0, Number(item.recurrence_minutes || 0)) || null : null,
          blocks_shift: item.blocks_shift === true,
          sort_order: (index + 1) * 10,
          is_active: true,
        },
      ])
      .select('id')
      .single()
    if (templateError) throw templateError

    const rows = (item.items || [])
      .filter((row) => String(row?.title || '').trim())
      .map((row, rowIndex) => ({
        template_id: String((template as any).id),
        title: String(row.title).trim(),
        answer_type: ANSWER_TYPES.has(String(row.answer_type || 'boolean')) ? String(row.answer_type || 'boolean') : 'boolean',
        is_required: row.is_required !== false,
        requires_photo: row.requires_photo === true,
        severity: 'normal',
        sort_order: (rowIndex + 1) * 10,
      }))

    if (rows.length) {
      const { error: itemsError } = await supabase.from('checklist_items').insert(rows)
      if (itemsError) throw itemsError
      createdItems += rows.length
    }

    existingTemplateTitles.add(title.toLowerCase())
    createdChecklists += 1
  }

  await writeAuditLog(supabase, {
    actorUserId,
    entityType: 'knowledge-center',
    entityId: organizationId || 'global',
    action: 'import-document',
    payload: { createdArticles, updatedArticles, createdChecklists, createdItems, skippedArticles, skippedChecklists },
  })

  return { createdArticles, updatedArticles, createdChecklists, createdItems, skippedArticles, skippedChecklists }
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'staff')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'knowledge-admin.view')
    if (denied) return denied

    const url = new URL(req.url)
    const articleId = url.searchParams.get('article')
    if (articleId) {
      const supabase = createAdminSupabaseClient()
      const { data, error } = await supabase.from('knowledge_articles').select('*').eq('id', articleId).maybeSingle()
      if (error) throw error
      if (!data) return json({ error: 'Статья не найдена' }, 404)
      ensureEditableOrganization(
        (data as any).organization_id,
        access.activeOrganization?.id || null,
        access.isSuperAdmin,
      )
      return json({ ok: true, data })
    }

    const data = await loadKnowledgeData({
      organizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/knowledge:get',
      message: error?.message || 'Knowledge GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'staff')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    const supabase = createAdminSupabaseClient()
    const organizationId = access.activeOrganization?.id || null

    // NEVER-паттерн: без организации запись создавалась бы с organization_id=null,
    // то есть попадала бы в базу знаний ВСЕХ клиентов сразу. Супер-админ — исключение.
    if (!organizationId && !access.isSuperAdmin) {
      return json({ error: 'Организация не выбрана' }, 400)
    }

    if (body.action === 'seedDefaults') {
      await seedDefaults(organizationId, user?.id || null)
      return json({ ok: true, data: await loadKnowledgeData({ organizationId, isSuperAdmin: access.isSuperAdmin }) })
    }

    if (body.action === 'applyImport') {
      const denied = await requireCapability(access, 'knowledge-admin.create')
      if (denied) return denied as any

      const result = await applyImport(supabase, {
        payload: body.payload,
        organizationId,
        isSuperAdmin: access.isSuperAdmin,
        actorUserId: user?.id || null,
      })

      return json({
        ok: true,
        result,
        data: await loadKnowledgeData({ organizationId, isSuperAdmin: access.isSuperAdmin }),
      })
    }

    if (body.action === 'upsertCategory') {
      const denied = await requireCapability(access, 'knowledge-admin.edit')
      if (denied) return denied as any
      if (body.payload.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: organizationId,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: body.payload.company_id,
        })
      }
      const payload = {
        organization_id: organizationId,
        company_id: body.payload.company_id || null,
        title: String(body.payload.title || '').trim(),
        slug: slugify(body.payload.slug || body.payload.title),
        description: body.payload.description?.trim() || null,
        kind: CATEGORY_KINDS.has(String(body.payload.kind || 'faq')) ? String(body.payload.kind || 'faq') : 'faq',
        sort_order: sortOrder(body.payload.sort_order),
        is_active: body.payload.is_active !== false,
      }
      if (!payload.title) return json({ error: 'Название обязательно' }, 400)

      if (body.payload.id) {
        const { data: current, error: currentError } = await supabase
          .from('knowledge_categories')
          .select('id, organization_id')
          .eq('id', body.payload.id)
          .maybeSingle()
        if (currentError) throw currentError
        if (!current) return json({ error: 'Категория не найдена' }, 404)
        ensureEditableOrganization(current.organization_id, organizationId, access.isSuperAdmin)
        const { data, error } = await supabase.from('knowledge_categories').update(payload).eq('id', body.payload.id).select('*').single()
        if (error) throw error
        return json({ ok: true, data })
      }

      const { data, error } = await supabase.from('knowledge_categories').insert([payload]).select('*').single()
      if (error) throw error
      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'knowledge-category', entityId: data.id, action: 'create', payload: data })
      return json({ ok: true, data })
    }

    if (body.action === 'upsertArticle') {
      const denied = await requireCapability(access, 'knowledge-admin.edit')
      if (denied) return denied as any
      if (body.payload.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: organizationId,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: body.payload.company_id,
        })
      }
      const payload = {
        organization_id: organizationId,
        company_id: body.payload.company_id || null,
        category_id: body.payload.category_id || null,
        title: String(body.payload.title || '').trim(),
        slug: slugify(body.payload.slug || body.payload.title),
        summary: body.payload.summary?.trim() || null,
        content: body.payload.content?.trim() || '',
        tags: arrayFromInput(body.payload.tags, []),
        audience: arrayFromInput(body.payload.audience, ['operator']),
        severity: SEVERITIES.has(String(body.payload.severity || 'normal')) ? String(body.payload.severity || 'normal') : 'normal',
        related_fine_amount: numberOrNull(body.payload.related_fine_amount),
        related_bonus_amount: numberOrNull(body.payload.related_bonus_amount),
        sort_order: sortOrder(body.payload.sort_order),
        is_published: body.payload.is_published !== false,
        requires_confirmation: body.payload.requires_confirmation === true,
      }
      if (!payload.title) return json({ error: 'Название обязательно' }, 400)

      if (body.payload.id) {
        const { data: current, error: currentError } = await supabase
          .from('knowledge_articles')
          .select('id, organization_id, is_published')
          .eq('id', body.payload.id)
          .maybeSingle()
        if (currentError) throw currentError
        if (!current) return json({ error: 'Статья не найдена' }, 404)
        ensureEditableOrganization(current.organization_id, organizationId, access.isSuperAdmin)
        // Публикация — не правка.
        //
        // Опубликованный регламент команда обязана прочитать и подтвердить, а
        // за нарушение по нему выписывают штраф — суммы лежат в самой статье.
        // Снятие с публикации не мягче: правило исчезает у всех разом. Право
        // «Публикация» в каталоге было с самого начала и не значило ничего:
        // состояние переключалось вместе с текстом, под правом на правку.
        if (Boolean(current.is_published) !== payload.is_published) {
          const publishDenied = await requireCapability(access, 'knowledge-admin.publish')
          if (publishDenied) return publishDenied as any
        }
        const { data, error } = await supabase.from('knowledge_articles').update(payload).eq('id', body.payload.id).select('*').single()
        if (error) throw error
        return json({ ok: true, data })
      }

      // Новая статья сразу опубликованной — то же решение, только в один шаг.
      if (payload.is_published) {
        const publishDenied = await requireCapability(access, 'knowledge-admin.publish')
        if (publishDenied) return publishDenied as any
      }

      const { data, error } = await supabase.from('knowledge_articles').insert([payload]).select('*').single()
      if (error) throw error
      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'knowledge-article', entityId: data.id, action: 'create', payload: data })
      return json({ ok: true, data })
    }

    // Публикация отдельным действием, а не сохранением статьи целиком.
    //
    // Телефон текста статьи не грузит — в списке только заголовки. Если бы он
    // публиковал через `upsertArticle`, он отправил бы пустое содержимое и
    // стёр регламент, который как раз собирался показать команде.
    if (body.action === 'setArticlePublished') {
      const denied = await requireCapability(access, 'knowledge-admin.publish')
      if (denied) return denied as any
      const articleId = String((body as any).payload?.id || (body as any).id || '').trim()
      const nextState = ((body as any).payload?.is_published ?? (body as any).is_published) === true
      if (!articleId) return json({ error: 'id обязателен' }, 400)

      const { data: current, error: currentError } = await supabase
        .from('knowledge_articles')
        .select('id, organization_id, is_published, title')
        .eq('id', articleId)
        .maybeSingle()
      if (currentError) throw currentError
      if (!current) return json({ error: 'Статья не найдена' }, 404)
      ensureEditableOrganization(current.organization_id, organizationId, access.isSuperAdmin)

      const { data, error } = await supabase
        .from('knowledge_articles')
        .update({ is_published: nextState })
        .eq('id', articleId)
        .select('*')
        .single()
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'knowledge-article',
        entityId: articleId,
        action: nextState ? 'publish' : 'unpublish',
        payload: { title: current.title },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'upsertTemplate') {
      const denied = await requireCapability(access, 'knowledge-admin.manage_checklists')
      if (denied) return denied as any
      if (body.payload.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: organizationId,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: body.payload.company_id,
        })
      }
      const scheduleType = SCHEDULE_TYPES.has(String(body.payload.schedule_type || 'opening'))
        ? String(body.payload.schedule_type || 'opening')
        : 'opening'
      const recurrenceMinutes =
        scheduleType === 'periodic' ? Math.max(0, Number(body.payload.recurrence_minutes || 0)) || null : null

      const payload = {
        organization_id: organizationId,
        company_id: body.payload.company_id || null,
        title: String(body.payload.title || '').trim(),
        description: body.payload.description?.trim() || null,
        role_scope: ROLE_SCOPES.has(String(body.payload.role_scope || 'operator')) ? String(body.payload.role_scope || 'operator') : 'operator',
        shift_scope: SHIFT_SCOPES.has(String(body.payload.shift_scope || 'any')) ? String(body.payload.shift_scope || 'any') : 'any',
        schedule_type: scheduleType,
        recurrence_minutes: recurrenceMinutes,
        blocks_shift: body.payload.blocks_shift === true,
        sort_order: sortOrder(body.payload.sort_order),
        is_active: body.payload.is_active !== false,
      }
      if (!payload.title) return json({ error: 'Название обязательно' }, 400)

      if (body.payload.id) {
        const { data: current, error: currentError } = await supabase
          .from('checklist_templates')
          .select('id, organization_id')
          .eq('id', body.payload.id)
          .maybeSingle()
        if (currentError) throw currentError
        if (!current) return json({ error: 'Шаблон не найден' }, 404)
        ensureEditableOrganization(current.organization_id, organizationId, access.isSuperAdmin)
        const { data, error } = await supabase.from('checklist_templates').update(payload).eq('id', body.payload.id).select('*').single()
        if (error) throw error
        return json({ ok: true, data })
      }

      const { data, error } = await supabase.from('checklist_templates').insert([payload]).select('*').single()
      if (error) throw error
      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'checklist-template', entityId: data.id, action: 'create', payload: data })
      return json({ ok: true, data })
    }

    if (body.action === 'upsertItem') {
      const payload = {
        template_id: body.payload.template_id,
        category_id: body.payload.category_id || null,
        knowledge_article_id: body.payload.knowledge_article_id || null,
        title: String(body.payload.title || '').trim(),
        description: body.payload.description?.trim() || null,
        answer_type: ANSWER_TYPES.has(String(body.payload.answer_type || 'boolean')) ? String(body.payload.answer_type || 'boolean') : 'boolean',
        is_required: body.payload.is_required !== false,
        requires_photo: body.payload.requires_photo === true,
        severity: SEVERITIES.has(String(body.payload.severity || 'normal')) ? String(body.payload.severity || 'normal') : 'normal',
        fine_amount: numberOrNull(body.payload.fine_amount),
        bonus_amount: numberOrNull(body.payload.bonus_amount),
        sort_order: sortOrder(body.payload.sort_order),
      }
      if (!payload.template_id) return json({ error: 'Шаблон обязателен' }, 400)
      if (!payload.title) return json({ error: 'Название обязательно' }, 400)

      const { data: template, error: templateError } = await supabase
        .from('checklist_templates')
        .select('id, organization_id')
        .eq('id', payload.template_id)
        .maybeSingle()
      if (templateError) throw templateError
      if (!template) return json({ error: 'Шаблон не найден' }, 404)
      ensureEditableOrganization(template.organization_id, organizationId, access.isSuperAdmin)

      if (body.payload.id) {
        // Проверяем и САМ пункт, а не только целевой шаблон: иначе подстановкой
        // чужого id можно было утащить пункт другой организации в свой чек-лист.
        const { data: currentItem, error: currentItemError } = await supabase
          .from('checklist_items')
          .select('id, template_id')
          .eq('id', body.payload.id)
          .maybeSingle()
        if (currentItemError) throw currentItemError
        if (!currentItem) return json({ error: 'Пункт не найден' }, 404)
        if (String((currentItem as any).template_id) !== String(payload.template_id)) {
          const { data: ownerTemplate, error: ownerError } = await supabase
            .from('checklist_templates')
            .select('organization_id')
            .eq('id', (currentItem as any).template_id)
            .maybeSingle()
          if (ownerError) throw ownerError
          ensureEditableOrganization((ownerTemplate as any)?.organization_id, organizationId, access.isSuperAdmin)
        }
        const { data, error } = await supabase.from('checklist_items').update(payload).eq('id', body.payload.id).select('*').single()
        if (error) throw error
        return json({ ok: true, data })
      }

      const { data, error } = await supabase.from('checklist_items').insert([payload]).select('*').single()
      if (error) throw error
      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'checklist-item', entityId: data.id, action: 'create', payload: data })
      return json({ ok: true, data })
    }

    if (body.action === 'duplicateTemplate') {
      const denied = await requireCapability(access, 'knowledge-admin.manage_checklists')
      if (denied) return denied as any

      const { data: source, error: sourceError } = await supabase
        .from('checklist_templates')
        .select('*')
        .eq('id', body.id)
        .maybeSingle()
      if (sourceError) throw sourceError
      if (!source) return json({ error: 'Шаблон не найден' }, 404)
      ensureEditableOrganization((source as any).organization_id, organizationId, access.isSuperAdmin)

      // Точку копии проверяем отдельно: без этого чек-лист можно было бы
      // подсунуть в чужую компанию, передав её id прямо в запросе.
      let targetCompanyId: string | null = body.company_id || null
      if (targetCompanyId) {
        await resolveCompanyScope({
          activeOrganizationId: organizationId,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: targetCompanyId,
        })
      }

      const { data: copy, error: copyError } = await supabase
        .from('checklist_templates')
        .insert([
          {
            organization_id: (source as any).organization_id ?? organizationId,
            company_id: targetCompanyId,
            title: String(body.title || '').trim() || `${(source as any).title} (копия)`,
            description: (source as any).description,
            role_scope: (source as any).role_scope,
            shift_scope: (source as any).shift_scope,
            schedule_type: (source as any).schedule_type,
            recurrence_minutes: (source as any).recurrence_minutes,
            blocks_shift: (source as any).blocks_shift,
            sort_order: Number((source as any).sort_order || 100) + 1,
            is_active: (source as any).is_active !== false,
          },
        ])
        .select('*')
        .single()
      if (copyError) throw copyError

      const { data: sourceItems, error: itemsError } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('template_id', body.id)
        .order('sort_order', { ascending: true })
      if (itemsError) throw itemsError

      if ((sourceItems || []).length) {
        const rows = (sourceItems || []).map((item: any) => ({
          template_id: (copy as any).id,
          category_id: item.category_id,
          knowledge_article_id: item.knowledge_article_id,
          title: item.title,
          description: item.description,
          answer_type: item.answer_type,
          is_required: item.is_required,
          requires_photo: item.requires_photo,
          severity: item.severity,
          fine_amount: item.fine_amount,
          bonus_amount: item.bonus_amount,
          sort_order: item.sort_order,
        }))
        const { error: insertItemsError } = await supabase.from('checklist_items').insert(rows)
        if (insertItemsError) throw insertItemsError
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'checklist-template',
        entityId: (copy as any).id,
        action: 'duplicate',
        payload: { from: body.id, company_id: targetCompanyId, items: (sourceItems || []).length },
      })

      return json({
        ok: true,
        data: await loadKnowledgeData({ organizationId, isSuperAdmin: access.isSuperAdmin }),
      })
    }

    const deleteMap = {
      deleteCategory: { table: 'knowledge_categories', entity: 'knowledge-category' },
      deleteArticle: { table: 'knowledge_articles', entity: 'knowledge-article' },
      deleteTemplate: { table: 'checklist_templates', entity: 'checklist-template' },
      deleteItem: { table: 'checklist_items', entity: 'checklist-item' },
    } as const

    if (body.action in deleteMap) {
      const config = deleteMap[body.action as keyof typeof deleteMap]
      const id = (body as any).id
      const { data: current, error: currentError } = await supabase.from(config.table).select('*').eq('id', id).maybeSingle()
      if (currentError) throw currentError
      if (!current) return json({ error: 'Запись не найдена' }, 404)
      if ('organization_id' in current) ensureEditableOrganization((current as any).organization_id, organizationId, access.isSuperAdmin)
      if (config.table === 'checklist_items') {
        const { data: template, error: templateError } = await supabase
          .from('checklist_templates')
          .select('organization_id')
          .eq('id', (current as any).template_id)
          .maybeSingle()
        if (templateError) throw templateError
        ensureEditableOrganization((template as any)?.organization_id, organizationId, access.isSuperAdmin)
      }
      const { error } = await supabase.from(config.table).delete().eq('id', id)
      if (error) throw error
      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: config.entity, entityId: id, action: 'delete', payload: current })
      return json({ ok: true })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/knowledge:post',
      message: error?.message || 'Knowledge POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
