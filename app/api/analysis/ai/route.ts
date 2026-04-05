import { NextResponse } from "next/server"

import { getOpenAIAdvice, type AnalysisData } from "@/lib/ai-analysis"
import { getRequestAccessContext } from "@/lib/server/request-auth"
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit"

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = checkRateLimit(`analysis-ai:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: "too-many-requests",
          text: "Слишком много AI-запросов. Попробуйте еще раз чуть позже.",
        },
        { status: 429 },
      )
    }

    const access = await getRequestAccessContext(request)
    if ("response" in access) {
      return access.response
    }

    const body = (await request.json().catch(() => null)) as AnalysisData | null
    if (!body) {
      return NextResponse.json(
        {
          error: "invalid-body",
          text: "Не удалось прочитать данные для AI-разбора.",
        },
        { status: 400 },
      )
    }

    const text = await getOpenAIAdvice(body)
    return NextResponse.json({ text })
  } catch (error) {
    console.error("AI analysis route error:", error)
    return NextResponse.json(
      {
        text: "AI-разбор временно недоступен. Попробуйте обновить страницу позже.",
      },
      { status: 500 },
    )
  }
}
