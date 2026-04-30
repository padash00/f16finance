import { NextResponse } from 'next/server'

import { runAssistant, streamAssistant } from '@/lib/ai/assistant'
import type { AssistantRequest } from '@/lib/ai/types'
import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-assistant:ip:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'too-many-requests' }, { status: 429 })
    }

    const access = await getRequestAccessContext(request)
    if ('response' in access) {
      return access.response
    }

    const userKey = access.user?.id || ip
    const userRl = checkRateLimit(`ai-assistant:user:${userKey}`, 30, 60_000)
    if (!userRl.allowed) {
      return NextResponse.json({ error: 'too-many-requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as AssistantRequest | null

    if (!body?.page || !body?.prompt?.trim()) {
      return NextResponse.json({ error: 'page и prompt обязательны.' }, { status: 400 })
    }

    const wantsStream = request.headers.get('accept')?.includes('text/event-stream')
    if (wantsStream) {
      const stream = streamAssistant(
        body,
        {
          supabase: access.supabase,
          currentSnapshot: body.snapshot || null,
        },
        {
          signal: request.signal,
          onUsage: (usage) =>
            logAiUsageSafe(access.supabase, {
              userId: access.user?.id || null,
              endpoint: '/api/ai/assistant',
              model: OPENAI_MODEL,
              usage,
            }),
          onError: (error) =>
            logAiUsageSafe(access.supabase, {
              userId: access.user?.id || null,
              endpoint: '/api/ai/assistant',
              model: OPENAI_MODEL,
              status: 'error',
              error,
            }),
        },
      )

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      })
    }

    const result = await runAssistant(body, {
      supabase: access.supabase,
      currentSnapshot: body.snapshot || null,
    })

    if (result.error) {
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/ai/assistant',
        model: OPENAI_MODEL,
        status: 'error',
        error: result.error,
      })
      return NextResponse.json({ text: result.error })
    }

    await logAiUsageSafe(access.supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/ai/assistant',
      model: OPENAI_MODEL,
      usage: result.usage,
    })

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
