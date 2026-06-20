import { NextResponse } from 'next/server'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'

// Диагностика: проверяет, может ли СЕРВЕР извлечь пользователя из переданного Bearer
// токена (та же валидация, что в getRequestUser). Отдаёт только данные ИЗ самого токена
// (его владельца) + текст ошибки — секретов нет. Нужен чтобы понять, почему unauthorized
// при валидном на вид токене. Можно потом удалить.
export async function GET(request: Request) {
  const raw = request.headers.get('authorization') || ''
  const m = raw.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim() || null

  const result: Record<string, unknown> = {
    hasToken: !!token,
    hasAdminCreds: hasAdminSupabaseCredentials(),
  }

  if (!token) return NextResponse.json(result)

  try {
    if (hasAdminSupabaseCredentials()) {
      const { data, error } = await createAdminSupabaseClient().auth.getUser(token)
      result.userId = data?.user?.id ?? null
      result.email = data?.user?.email ?? null
      result.role = (data?.user as any)?.role ?? null
      result.error = error?.message ?? null
      result.status = (error as any)?.status ?? null
    } else {
      result.error = 'no-admin-credentials'
    }
  } catch (e: any) {
    result.error = e?.message || 'exception'
  }

  return NextResponse.json(result)
}
