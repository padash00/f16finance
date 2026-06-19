/**
 * Unified HR Hire — атомарно создаёт оператора ИЛИ staff с полным профилем,
 * логином/паролем (для оператора) и назначениями.
 *
 * POST /api/admin/hr/hire
 * Body:
 *   {
 *     type: 'operator' | 'staff',
 *     full_name: string,
 *     short_name?: string,
 *     role: string,            // должность (positions.name)
 *     hire_date?: string,      // YYYY-MM-DD
 *     phone?: string,
 *     email?: string,
 *     telegram_chat_id?: string,
 *     photo_url?: string,
 *     // Для type=operator:
 *     username?: string,       // если не передан — генерируем
 *     company_ids?: string[],  // на каких точках работать
 *     // Для type=staff:
 *     monthly_salary?: number,
 *   }
 *
 * Возвращает:
 *   { ok: true, id, type, username?, password? }
 *   (password — plaintext, показывается админу один раз)
 */

import { NextResponse } from 'next/server'

import { normalizeOperatorUsername, toOperatorAuthEmail } from '@/lib/core/auth'
import { writeAuditLog } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { listOrganizationCompanyIds } from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '0123456789'
  const all = upper + lower + digits
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  let password = ''
  password += upper[bytes[0] % upper.length]
  password += lower[bytes[1] % lower.length]
  password += digits[bytes[2] % digits.length]
  for (let i = 3; i < 10; i++) password += all[bytes[i] % all.length]
  return password
}

const RU_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
}

function transliterateToUsername(name: string): string {
  const lower = name.trim().toLowerCase()
  let result = ''
  for (const ch of lower) {
    if (/[a-z0-9]/.test(ch)) result += ch
    else if (RU_TO_LATIN[ch] !== undefined) result += RU_TO_LATIN[ch]
    else if (ch === ' ' || ch === '_' || ch === '-') result += '_'
  }
  result = result.replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 20)
  // Добавляем 4 случайные цифры — почти гарантированно уникально.
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${result || 'user'}_${suffix}`
}

type HireBody = {
  type?: 'operator' | 'staff'
  full_name?: string
  short_name?: string
  role?: string
  hire_date?: string
  phone?: string
  email?: string
  telegram_chat_id?: string
  photo_url?: string
  // operator only:
  username?: string
  company_ids?: string[]
  // staff only:
  monthly_salary?: number
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as HireBody | null
    if (!body) return json({ error: 'Invalid body' }, 400)

    const type = body.type
    if (type !== 'operator' && type !== 'staff') {
      return json({ error: 'type должен быть operator или staff' }, 400)
    }

    const fullName = String(body.full_name || '').trim()
    if (fullName.length < 2) return json({ error: 'ФИО обязательно' }, 400)

    const role = String(body.role || '').trim()
    if (!role) return json({ error: 'Должность обязательна' }, 400)

    // Capability check
    const denied = await requireCapability(
      access,
      type === 'operator' ? 'operators.create' : 'staff.create',
    )
    if (denied) return denied as any

    const supabase = createAdminSupabaseClient()

    // Изоляция: новый сотрудник/оператор обязан принадлежать организации вызывающего.
    // Без этого запись «теряется» (organization_id=null → невидима в скоупе орг).
    const organizationId = access.activeOrganization?.id || null
    if (!access.isSuperAdmin && !organizationId) {
      return json({ error: 'Нет активной организации — некуда привязать сотрудника' }, 400)
    }

    // Компании назначения (для оператора) обязаны принадлежать этой же организации.
    let assignmentCompanyIds: string[] = []
    if (Array.isArray(body.company_ids) && body.company_ids.length > 0) {
      const requested = body.company_ids.map((c: any) => String(c))
      if (access.isSuperAdmin && !organizationId) {
        assignmentCompanyIds = requested
      } else {
        const allowedCompanyIds = await listOrganizationCompanyIds({
          activeOrganizationId: organizationId,
          isSuperAdmin: access.isSuperAdmin,
        })
        const foreign = requested.filter((id) => !allowedCompanyIds.includes(id))
        if (foreign.length > 0) {
          return json({ error: 'forbidden', code: 'company-not-in-organization' }, 403)
        }
        assignmentCompanyIds = requested
      }
    }

    // Проверяем что роль существует в positions
    const { data: position } = await supabase
      .from('positions')
      .select('name')
      .eq('name', role)
      .maybeSingle()
    if (!position) {
      return json({ error: `Должность "${role}" не найдена. Создай её на /access → Должности.` }, 400)
    }

    // ─── Type: STAFF ───────────────────────────────────────────────
    if (type === 'staff') {
      const monthlySalary =
        typeof body.monthly_salary === 'number' && body.monthly_salary >= 0
          ? Math.round(body.monthly_salary)
          : 0

      const { data: createdStaff, error: staffError } = await supabase
        .from('staff')
        .insert({
          full_name: fullName,
          short_name: body.short_name?.trim() || null,
          role,
          monthly_salary: monthlySalary,
          phone: body.phone?.trim() || null,
          email: body.email?.trim() || null,
          telegram_chat_id: body.telegram_chat_id?.trim() || null,
          is_active: true,
          organization_id: organizationId,
        })
        .select('id')
        .single()

      if (staffError) return json({ error: staffError.message }, 500)

      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: 'staff',
        entityId: String((createdStaff as any).id),
        action: 'create',
        payload: { full_name: fullName, role, monthly_salary: monthlySalary, source: 'hr/hire' },
      })

      return json({ ok: true, id: (createdStaff as any).id, type: 'staff' })
    }

    // ─── Type: OPERATOR ────────────────────────────────────────────
    const shortName = body.short_name?.trim() || fullName.split(' ')[0] || fullName

    // 1. Создаём оператора
    const { data: createdOp, error: opError } = await supabase
      .from('operators')
      .insert({
        name: shortName,
        short_name: shortName,
        role,
        telegram_chat_id: body.telegram_chat_id?.trim() || null,
        is_active: true,
        organization_id: organizationId,
      })
      .select('id')
      .single()

    if (opError) return json({ error: opError.message }, 500)

    const operatorId = (createdOp as any).id as string

    // 2. Профиль оператора
    await supabase.from('operator_profiles').insert({
      operator_id: operatorId,
      full_name: fullName,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      photo_url: body.photo_url?.trim() || null,
      hire_date: body.hire_date || new Date().toISOString().slice(0, 10),
    })

    // 3. Логин + пароль (создаём auth-аккаунт)
    let username = body.username?.trim() || transliterateToUsername(shortName)
    username = normalizeOperatorUsername(username)
    const password = generatePassword()
    const authEmail = toOperatorAuthEmail(username)

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { role: 'operator', operator_id: operatorId, name: shortName },
    })

    if (authError) {
      // Откат: удаляем оператора
      await supabase.from('operators').delete().eq('id', operatorId)
      return json({ error: `Не удалось создать аккаунт: ${authError.message}` }, 500)
    }

    await supabase.from('operator_auth').insert({
      operator_id: operatorId,
      user_id: authUser.user!.id,
      username,
      role: 'operator',
      is_active: true,
    })

    // 4. Назначения на компании/точки (company_ids уже проверены на принадлежность орг)
    if (assignmentCompanyIds.length > 0) {
      const assignments = assignmentCompanyIds.map((companyId, idx) => ({
        operator_id: operatorId,
        company_id: companyId,
        role_in_company: 'operator',
        is_primary: idx === 0,
        is_active: true,
      }))
      const { error: assignErr } = await supabase
        .from('operator_company_assignments')
        .insert(assignments)
      if (assignErr) {
        // Не падаем — оператор создан, просто логируем для диагностики
        console.warn('hr/hire: failed to insert operator_company_assignments', assignErr)
      }
    }

    // 5. AuditLog
    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'operator',
      entityId: operatorId,
      action: 'create',
      payload: {
        full_name: fullName,
        role,
        username,
        company_ids: body.company_ids || [],
        source: 'hr/hire',
      },
    })

    return json({
      ok: true,
      id: operatorId,
      type: 'operator',
      username,
      password,
    })
  } catch (e: any) {
    return json({ error: e?.message || 'Server error' }, 500)
  }
}
