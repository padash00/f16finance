import { redirect } from 'next/navigation'

/**
 * Старый адрес игровой зоны: /stations/<проект>?company=…&tab=….
 * Разделы переехали в меню («Система» → Игровой зал, Брони станций, …);
 * здесь только перенаправляем закладки и старые ссылки.
 */

const TAB_TO_SECTION: Record<string, string> = {
  live: 'hall',
  manage: 'stations',
  bookings: 'bookings',
  map: 'map',
  catalog: 'games',
  analytics: 'analytics',
  settings: 'kiosk',
}

export default async function LegacyStationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const pick = (key: string) => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }
  const section = TAB_TO_SECTION[pick('tab') || ''] || 'hall'
  const query = new URLSearchParams()
  for (const key of ['company', 'afrom', 'ato']) {
    const value = pick(key)
    if (value) query.set(key, value)
  }
  const qs = query.toString()
  redirect(`/arena/${section}${qs ? `?${qs}` : ''}`)
}
