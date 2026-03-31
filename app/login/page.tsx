import { headers } from 'next/headers'

import { SITE_URL } from '@/lib/core/site'
import { getTenantBaseHost } from '@/lib/core/tenant-domain'
import { normalizeRequestHost, resolveOrganizationByHost } from '@/lib/server/tenant-hosts'

import LoginForm from './LoginForm'

export default async function LoginPage() {
  const headersList = await headers()
  const host = headersList.get('host')

  const baseHost = getTenantBaseHost().toLowerCase()
  const normalizedHost = normalizeRequestHost(host)
  const isTenantSubdomain =
    !!normalizedHost && normalizedHost !== baseHost && normalizedHost !== `www.${baseHost}`

  let hostOrg: { name: string; slug: string } | null = null
  if (isTenantSubdomain) {
    const org = await resolveOrganizationByHost(host)
    if (org?.id) {
      hostOrg = { name: org.name, slug: org.slug }
    }
  }

  return <LoginForm hostOrg={hostOrg} isTenantSubdomain={isTenantSubdomain} platformUrl={SITE_URL} />
}
