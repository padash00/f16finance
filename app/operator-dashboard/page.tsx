import { redirect } from 'next/navigation'

export default async function OperatorDashboardRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] | undefined }>
}) {
  const params = await searchParams
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab

  if (rawTab === 'schedule') redirect('/operator/shifts')
  if (rawTab === 'history') redirect('/operator/salary')
  if (rawTab === 'profile') redirect('/operator/profile')

  redirect('/operator')
}
