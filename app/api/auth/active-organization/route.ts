import { NextResponse } from 'next/server'

import { ACTIVE_ORGANIZATION_COOKIE } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(req: Request) {
  const access = await getRequestAccessContext(req)
  if ('response' in access) return access.response

  const body = await req.json().catch(() => null) as { organizationId?: string | null } | null
  const organizationId = String(body?.organizationId || '').trim()
  if (!organizationId) {
    return json({ error: 'organizationId required' }, 400)
  }

  const organization = access.organizations.find((item) => item.id === organizationId)
  if (!organization) {
    return json({ error: 'forbidden' }, 403)
  }

  const response = json({
    ok: true,
    activeOrganization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      accessRole: organization.accessRole,
    },
  })
  response.cookies.set({
    name: ACTIVE_ORGANIZATION_COOKIE,
    value: organization.id,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}
