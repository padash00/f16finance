import { NextResponse } from 'next/server'

import { getAllPageFeatures } from '@/lib/nav/sections'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// «Что разблокирует эту страницу» — для экрана /upgrade. Доступно любому
// авторизованному пользователю организации (не super-admin).
export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const feature = String(url.searchParams.get('feature') || '').trim()
    if (!feature) return NextResponse.json({ error: 'feature обязателен' }, { status: 400 })

    // Человеческое название страницы по фиче.
    const page = getAllPageFeatures().find((p) => p.feature === feature)
    const pageLabel = page?.label || 'эта страница'

    let packages: any[] = []
    let addons: any[] = []
    if (hasAdminSupabaseCredentials()) {
      const supabase = createAdminSupabaseClient()
      const [{ data: pkgs }, { data: adds }] = await Promise.all([
        supabase.from('packages').select('code, name, description, feature_codes, price_kzt').eq('status', 'active'),
        supabase.from('addons').select('code, name, description, feature_codes, price_kzt, billing_unit').eq('status', 'active'),
      ])
      packages = (pkgs || []).filter((p: any) => (p.feature_codes || []).includes(feature))
      addons = (adds || []).filter((a: any) => (a.feature_codes || []).includes(feature))
    }

    return NextResponse.json({ ok: true, feature, pageLabel, packages, addons })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
