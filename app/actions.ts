'use server'

import { getOpenAIAdvice as getOpenAIAdviceInternal, type AnalysisData } from "@/lib/ai-analysis"

export async function getOpenAIAdvice(data: AnalysisData) {
  return getOpenAIAdviceInternal(data)
}

export const getGeminiAdvice = getOpenAIAdvice
