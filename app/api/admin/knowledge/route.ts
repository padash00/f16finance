import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { listOrganizationCompanyIds, resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'

type CategoryPayload = {
  id?: string
  title: string
  slug?: string | null
  description?: string | null
  kind?: string | null
  sort_order?: number | null
  is_active?: boolean | null
}

type ArticlePayload = {
  id?: string
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
}

type TemplatePayload = {
  id?: string
  company_id?: string | null
  title: string
  description?: string | null
  role_scope?: string | null
  shift_scope?: string | null
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

type Body =
  | { action: 'upsertCategory'; payload: CategoryPayload }
  | { action: 'deleteCategory'; id: string }
  | { action: 'upsertArticle'; payload: ArticlePayload }
  | { action: 'deleteArticle'; id: string }
  | { action: 'upsertTemplate'; payload: TemplatePayload }
  | { action: 'deleteTemplate'; id: string }
  | { action: 'upsertItem'; payload: ItemPayload }
  | { action: 'deleteItem'; id: string }
  | { action: 'seedDefaults' }

const CATEGORY_KINDS = new Set(['rules', 'faq', 'salary', 'problem', 'checklist'])
const SEVERITIES = new Set(['info', 'normal', 'warning', 'critical'])
const ROLE_SCOPES = new Set(['operator', 'cashier', 'senior_operator', 'senior_cashier', 'any'])
const SHIFT_SCOPES = new Set(['day', 'night', 'opening', 'closing', 'handover', 'any'])
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
  if (!activeOrganizationId) return
  if (rowOrganizationId && rowOrganizationId !== activeOrganizationId) {
    throw new Error('Запись принадлежит другой организации')
  }
}

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
    .select('*')
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

  return {
    categories: categoriesResult.data || [],
    articles: articlesResult.data || [],
    templates: templatesResult.data || [],
    items,
    companies: companiesResult.data || [],
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
      summary: 'Штрафы фиксируют нарушения, премии поощряют стабильную качественную работу.',
      content:
        'Премия — это не подарок, а поощрение за стабильное выполнение правил. Штраф применяется за конкретное нарушение с причиной. Серьёзные случаи должны проходить проверку руководителем. Идеальная смена может давать бонус, а повторные нарушения усиливают ответственность.',
      tags: ['зарплата', 'штраф', 'премия'],
      severity: 'info',
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
        sort_order: (index + 1) * 10,
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

  await writeAuditLog(supabase, {
    actorUserId,
    entityType: 'knowledge-center',
    entityId: organizationId || 'global',
    action: 'seed-defaults',
    payload: { organizationId },
  })
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'staff')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

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

    if (body.action === 'seedDefaults') {
      await seedDefaults(organizationId, user?.id || null)
      return json({ ok: true, data: await loadKnowledgeData({ organizationId, isSuperAdmin: access.isSuperAdmin }) })
    }

    if (body.action === 'upsertCategory') {
      const payload = {
        organization_id: organizationId,
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
      const payload = {
        organization_id: organizationId,
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
      }
      if (!payload.title) return json({ error: 'Название обязательно' }, 400)

      if (body.payload.id) {
        const { data: current, error: currentError } = await supabase
          .from('knowledge_articles')
          .select('id, organization_id')
          .eq('id', body.payload.id)
          .maybeSingle()
        if (currentError) throw currentError
        if (!current) return json({ error: 'Статья не найдена' }, 404)
        ensureEditableOrganization(current.organization_id, organizationId, access.isSuperAdmin)
        const { data, error } = await supabase.from('knowledge_articles').update(payload).eq('id', body.payload.id).select('*').single()
        if (error) throw error
        return json({ ok: true, data })
      }

      const { data, error } = await supabase.from('knowledge_articles').insert([payload]).select('*').single()
      if (error) throw error
      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'knowledge-article', entityId: data.id, action: 'create', payload: data })
      return json({ ok: true, data })
    }

    if (body.action === 'upsertTemplate') {
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
        description: body.payload.description?.trim() || null,
        role_scope: ROLE_SCOPES.has(String(body.payload.role_scope || 'operator')) ? String(body.payload.role_scope || 'operator') : 'operator',
        shift_scope: SHIFT_SCOPES.has(String(body.payload.shift_scope || 'any')) ? String(body.payload.shift_scope || 'any') : 'any',
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
        const { data, error } = await supabase.from('checklist_items').update(payload).eq('id', body.payload.id).select('*').single()
        if (error) throw error
        return json({ ok: true, data })
      }

      const { data, error } = await supabase.from('checklist_items').insert([payload]).select('*').single()
      if (error) throw error
      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'checklist-item', entityId: data.id, action: 'create', payload: data })
      return json({ ok: true, data })
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
