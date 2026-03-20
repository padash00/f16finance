import { NextResponse } from 'next/server'

import { runAssistant } from '@/lib/ai/assistant'
import type { AssistantRequest } from '@/lib/ai/types'
import { getRequestAccessContext } from '@/lib/server/request-auth'

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) {
      return access.response
    }

    const body = (await request.json().catch(() => null)) as AssistantRequest | null

    if (!body?.page || !body?.prompt?.trim()) {
      return NextResponse.json({ error: 'page и prompt обязательны.' }, { status: 400 })
    }

    const result = await runAssistant(body, {
      supabase: access.supabase,
      currentSnapshot: body.snapshot || null,
    })

    if (result.error) {
      return NextResponse.json({ text: result.error })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/ai/assistant failed:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Не удалось выполнить AI-запрос.',
      },
      { status: 500 },
    )
  }
}
