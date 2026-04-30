import 'server-only'

type AiUsage = {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
}

type AiUsageLogEntry = {
  userId?: string | null
  endpoint: string
  provider?: string
  model: string
  usage?: AiUsage | null
  status?: 'success' | 'error'
  error?: string | null
  payload?: Record<string, unknown> | null
}

const MODEL_COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
}

function estimateCost(model: string, usage?: AiUsage | null) {
  if (!usage) return null
  const rates = MODEL_COST_PER_MILLION[model]
  if (!rates) return null
  const input = Number(usage.prompt_tokens || 0)
  const output = Number(usage.completion_tokens || 0)
  return (input / 1_000_000) * rates.input + (output / 1_000_000) * rates.output
}

export async function logAiUsageSafe(client: any, entry: AiUsageLogEntry) {
  try {
    const usage = entry.usage || null
    await client.from('ai_usage_log').insert({
      user_id: entry.userId || null,
      endpoint: entry.endpoint,
      provider: entry.provider || 'openai',
      model: entry.model,
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
      cost_estimate: estimateCost(entry.model, usage),
      status: entry.status || 'success',
      error: entry.error || null,
      payload: entry.payload || null,
    })
  } catch (error) {
    console.warn('AI usage log write skipped', error)
  }
}
