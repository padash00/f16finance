import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type CreateOrganizationBody = {
  name?: string | null
  slug?: string | null
  legalName?: string | null
  planCode?: string | null
  createPrimaryDomain?: boolean | null
}

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a',
  ә: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  қ: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  ң: 'n',
  о: 'o',
  ө: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ұ: 'u',
  ү: 'u',
  ф: 'f',
  х: 'h',
  һ: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ы: 'y',
  і: 'i',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ь: '',
  ъ: '',
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split('')
    .map((char) => CYRILLIC_TO_LATIN_MAP[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

async function reserveUniqueSlug(supabase: ReturnType<typeof createAdminSupabaseClient>, baseSlug: string) {
  const normalizedBase = slugify(baseSlug)
  if (!normalizedBase) {
    throw new Error('Укажите slug латиницей или название, из которого можно собрать slug.')
  }

  const { data, error } = await supabase
    .from('organizations')
    .select('slug')
    .ilike('slug', `${normalizedBase}%`)

  if (error) throw error

  const existing = new Set((data || []).map((row: any) => String(row.slug || '').trim().toLowerCase()).filter(Boolean))
  if (!existing.has(normalizedBase)) {
    return normalizedBase
  }

  let counter = 2
  while (existing.has(`${normalizedBase}-${counter}`)) {
    counter += 1
  }

  return `${normalizedBase}-${counter}`
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as CreateOrganizationBody | null
    const name = String(body?.name || '').trim()
    const legalName = String(body?.legalName || '').trim() || null
    const desiredSlug = String(body?.slug || '').trim() || name
    const planCode = String(body?.planCode || '').trim() || 'starter'
    const createPrimaryDomain = body?.createPrimaryDomain !== false

    if (!name) {
      return json({ error: 'Название организации обязательно' }, 400)
    }

    const supabase = createAdminSupabaseClient()
    const slug = await reserveUniqueSlug(supabase, desiredSlug)

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('id, code')
      .eq('code', planCode)
      .maybeSingle()

    if (planError) throw planError
    if (!plan?.id) {
      return json({ error: 'plan-not-found' }, 400)
    }

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .insert([
        {
          name,
          slug,
          legal_name: legalName,
          status: 'active',
          settings: {
            created_from: 'project-hub',
          },
        },
      ])
      .select('id, name, slug, status')
      .single()

    if (organizationError) throw organizationError

    const organizationId = String((organization as any).id)

    const { error: subscriptionError } = await supabase
      .from('organization_subscriptions')
      .insert([
        {
          organization_id: organizationId,
          plan_id: String(plan.id),
          status: 'trialing',
          billing_period: 'monthly',
          metadata: {
            created_from: 'project-hub',
          },
        },
      ])
    if (subscriptionError) throw subscriptionError

    const { error: memberError } = await supabase
      .from('organization_members')
      .upsert(
        [
          {
            organization_id: organizationId,
            staff_id: access.staffMember?.id || null,
            user_id: access.user?.id || null,
            email: access.user?.email?.trim().toLowerCase() || null,
            role: 'owner',
            status: 'active',
            is_default: true,
            metadata: {
              created_from: 'project-hub',
            },
          },
        ],
        {
          onConflict: 'organization_id,user_id',
        },
      )
    if (memberError) throw memberError

    if (createPrimaryDomain) {
      const { error: domainError } = await supabase
        .from('tenant_domains')
        .insert([
          {
            organization_id: organizationId,
            host: slug,
            is_primary: true,
          },
        ])
        .select('id')
        .maybeSingle()
      if (domainError) {
        console.warn('Primary tenant domain was not created', domainError)
      }
    }

    return json({
      ok: true,
      organization: {
        id: organizationId,
        name: String((organization as any).name || name),
        slug: String((organization as any).slug || slug),
        status: String((organization as any).status || 'active'),
        planCode: String(plan.code),
      },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
