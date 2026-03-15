import { NextResponse } from "next/server"

import { getOpenAIAdvice, type AnalysisData } from "@/lib/ai-analysis"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalysisData
    const text = await getOpenAIAdvice(body)
    return NextResponse.json({ text })
  } catch (error) {
    console.error("AI analysis route error:", error)
    return NextResponse.json(
      { error: "Не удалось получить AI-разбор. Проверьте подключение к OpenAI." },
      { status: 500 },
    )
  }
}
