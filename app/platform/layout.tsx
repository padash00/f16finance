import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getTenantBaseHost } from '@/lib/core/tenant-domain'
import { normalizeRequestHost, resolveOrganizationByHost } from '@/lib/server/tenant-hosts'

import PlatformShell from './PlatformShell'

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const host = headersList.get('host')

  const baseHost = getTenantBaseHost().toLowerCase()
  const normalizedHost = normalizeRequestHost(host)
  const isTenantSubdomain =
    !!normalizedHost && normalizedHost !== baseHost && normalizedHost !== `www.${baseHost}`

  if (isTenantSubdomain) {
    const hostOrganization = await resolveOrganizationByHost(host)
    redirect(hostOrganization?.id ? '/workspace' : '/login')
  }

  return <PlatformShell>{children}</PlatformShell>
}
