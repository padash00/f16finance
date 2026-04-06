import { NextResponse } from 'next/server'

import { getDefaultAppPath } from '@/lib/core/access'
import { getTenantBaseHost } from '@/lib/core/tenant-domain'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { ACTIVE_ORGANIZATION_COOKIE } from '@/lib/server/organizations'
import { normalizeRequestHost, resolveOrganizationByHost } from '@/lib/server/tenant-hosts'

function setActiveOrganizationCookie(response: NextResponse, organizationId: string | null) {
  if (!organizationId) return response
  response.cookies.set({
    name: ACTIVE_ORGANIZATION_COOKIE,
    value: organizationId,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}

export async function GET(req: Request) {
  const normalizedHost = normalizeRequestHost(req.headers.get('host'))
  const baseHost = getTenantBaseHost().toLowerCase()
  const isTenantHost =
    !!normalizedHost && normalizedHost !== baseHost && normalizedHost !== `www.${baseHost}`

  if (!isTenantHost) {
    return NextResponse.redirect(new URL('/platform', req.url))
  }

  const hostOrganization = await resolveOrganizationByHost(req.headers.get('host'))
  if (!hostOrganization?.id) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const access = await getRequestAccessContext(req, { allowCustomer: true })
  if ('response' in access) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const targetPath = access.isSuperAdmin
    ? '/workspace'
    : getDefaultAppPath({
        isSuperAdmin: false,
        isStaff: !!access.staffMember,
        isOperator: !!access.operatorAuth,
        isCustomer: access.isCustomer,
        staffRole: access.staffRole,
      })

  const response = NextResponse.redirect(new URL(targetPath, req.url))
  return setActiveOrganizationCookie(response, hostOrganization.id)
}
