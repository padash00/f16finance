import { NextResponse } from 'next/server'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'

// SQL: create table if not exists expense_templates (
//   id uuid primary key default gen_random_uuid(),
//   name text not null,
//   category text not null,
//   amount numeric not null,
//   payment_type text default 'cash', -- 'cash' | 'kaspi'
//   company_id uuid references companies(id),
//   comment text,
//   created_at timestamptz default now()
// );

function json(data: unknown, status = 200) { return NextResponse.json(data, { status }) }

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    let query = access.supabase
      .from('expense_templates')
      .select('*')
      .order('name')
    if (companyScope.allowedCompanyIds) {
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }
    const { data, error } = await query
    if (error) {
      if (error.code === '42P01') return json({ data: [], tableExists: false })
      throw error
    }
    return json({ data: data ?? [], tableExists: true })
  } catch (e: any) { return json({ error: e?.message }, 500) }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const body = await req.json().catch(() => null)
    if (!body?.name || !body?.category || !body?.amount) {
      return json({ error: 'name, category, amount required' }, 400)
    }
    if (body.company_id) {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId: String(body.company_id),
      })
    }
    const { data, error } = await access.supabase
      .from('expense_templates')
      .insert({ name: body.name, category: body.category, amount: body.amount, payment_type: body.payment_type || 'cash', company_id: body.company_id || null, comment: body.comment || null })
      .select().single()
    if (error) throw error
    return json({ data })
  } catch (e: any) { return json({ error: e?.message }, 500) }
}

export async function DELETE(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return json({ error: 'id required' }, 400)
    const { data: existing, error: existingError } = await access.supabase
      .from('expense_templates')
      .select('id, company_id')
      .eq('id', id)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return json({ error: 'not-found' }, 404)
    if (existing.company_id) {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId: String(existing.company_id),
      })
    }
    const { error } = await access.supabase.from('expense_templates').delete().eq('id', id)
    if (error) throw error
    return json({ ok: true })
  } catch (e: any) { return json({ error: e?.message }, 500) }
}
