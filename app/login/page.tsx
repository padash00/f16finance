import { headers } from 'next/headers'

import { SITE_URL } from '@/lib/core/site'
import { getTenantBaseHost } from '@/lib/core/tenant-domain'
import { normalizeRequestHost, resolveDefaultOrganization, resolveOrganizationByHost } from '@/lib/server/tenant-hosts'

import LoginForm from './LoginForm'

export default async function LoginPage() {
  const headersList = await headers()
  const host = headersList.get('host')

  const baseHost = getTenantBaseHost().toLowerCase()
  const normalizedHost = normalizeRequestHost(host)
  const isTenantSubdomain =
    !!normalizedHost && normalizedHost !== baseHost && normalizedHost !== `www.${baseHost}`

  const entryOrganization = isTenantSubdomain
    ? await resolveOrganizationByHost(host)
    : await resolveDefaultOrganization()

  const hostOrg =
    entryOrganization?.id
      ? { name: entryOrganization.name, slug: entryOrganization.slug }
      : null

  return <LoginForm hostOrg={hostOrg} isTenantSubdomain={isTenantSubdomain || !!hostOrg} platformUrl={SITE_URL} />
}
