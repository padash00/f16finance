import { NextResponse } from 'next/server'
import { runCopilotForWeb } from '@/lib/ai/copilot'
import { checkRateLimit } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.user) return json({ error: 'unauthorized' }, 401)
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const rl = checkRateLimit(`copilot:${access.user?.id || 'anon'}`, 20, 60_000)
    if (!rl.allowed) return NextResponse.json({ error: 'too-many-requests' }, { status: 429 })

    const body = (await request.json().catch(() => null)) as
      | { text?: string; callbackData?: string; currentPath?: string }
      | null
    if (!body) return json({ error: 'body required' }, 400)
    if (!body.text && !body.callbackData) {
      return json({ error: 'text or callbackData required' }, 400)
    }

    const response = await runCopilotForWeb({
      userId: access.user.id,
      role: access.staffRole || null,
      isSuperAdmin: access.isSuperAdmin,
      organizationId: access.activeOrganization?.id || null,
      text: body.text,
      callbackData: body.callbackData,
      currentPath: body.currentPath,
    })

    return json(response)
  } catch (error: any) {
    console.error('[ai/copilot]', error)
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
