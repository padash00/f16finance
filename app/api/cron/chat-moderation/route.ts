/**
 * Cron каждые 5 минут: ИИ сканирует свежие сообщения чата и DM,
 * флаги подозрительных кладёт в chat_moderation_flags.
 *
 * Категории: cash_skim, data_leak, harassment, threat, profanity, other.
 * Severity 0..10 — порог 4 для записи флага.
 */

import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { generateAiText } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const maxDuration = 60

type CandidateMessage = {
  source: 'team_chat' | 'direct_messages'
  id: string
  authorUserId: string | null
  authorName: string
  recipientUserId: string | null
  organizationId: string | null
  message: string
  createdAt: string
}

type AIVerdict = {
  severity: number
  categories: string[]
  summary: string | null
}

const SYSTEM_PROMPT = `Ты — модератор корпоративного чата сети игровых клубов в Казахстане.
Анализируй каждое сообщение и оцени его по категориям нарушений:
- cash_skim: сговор на кражу выручки, обсуждение «не вписать», «поделить разницу», подмена сумм
- data_leak: разглашение персональных данных клиентов (номера телефонов, имена, балансы, пароли)
- harassment: оскорбления, харассмент между сотрудниками
- threat: угрозы насилием или другими действиями
- profanity: грубая нецензурная лексика (только если явная агрессия, не просто эмоция)
- other: другие нарушения корпоративной этики

Для каждого сообщения верни JSON:
{ "severity": 0-10, "categories": ["..."], "summary": "почему" }

severity:
- 0: всё нормально
- 1-3: легко неуместно (грубоватый тон), не трогать
- 4-6: обратить внимание владельцу
- 7-10: серьёзное нарушение, нужен срочный разбор

Если ничего подозрительного — severity: 0, categories: [], summary: null.

Отвечай СТРОГО массивом JSON-объектов в том же порядке что входные сообщения, без markdown-блоков, без обёртки.`

function safeParse(text: string): AIVerdict[] {
  let cleaned = text.trim()
  // Убираем markdown-блоки если есть
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return []
    return parsed.map((v: any) => ({
      severity: Math.max(0, Math.min(10, Number(v?.severity) || 0)),
      categories: Array.isArray(v?.categories) ? v.categories.map(String) : [],
      summary: v?.summary ? String(v.summary) : null,
    }))
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  // Защита от внешнего вызова: разрешаем Vercel cron header или x-cron-secret
  const url = new URL(request.url)
  const cronSecret = process.env.CRON_SECRET
  const headerSecret = request.headers.get('x-cron-secret')
  const isVercelCron = request.headers.get('user-agent')?.includes('vercel-cron')
  if (cronSecret && headerSecret !== cronSecret && !isVercelCron && url.searchParams.get('secret') !== cronSecret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'admin supabase not configured' }, { status: 500 })
  }
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ ok: true, skipped: 'AI provider not configured' })
  }

  const supabase = createAdminSupabaseClient()

  // Сообщения за последние 10 минут (буфер) ещё не обработанные
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  // Собираем уже обработанные id
  const { data: processed } = await supabase
    .from('chat_moderation_flags')
    .select('source_table, source_message_id')
    .gte('created_at', since)
  const processedSet = new Set((processed || []).map((p: any) => `${p.source_table}|${p.source_message_id}`))

  // Тянем кандидатов из обоих источников
  const [team, dm] = await Promise.all([
    supabase
      .from('team_chat_messages')
      .select('id, sender_user_id, sender_name, organization_id, message, created_at')
      .gte('created_at', since)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(100),
    supabase
      .from('direct_messages')
      .select('id, sender_user_id, recipient_user_id, sender_name, message, created_at')
      .gte('created_at', since)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(100),
  ])

  const candidates: CandidateMessage[] = []
  for (const m of team.data || []) {
    if (!(m as any).message?.trim()) continue
    if (processedSet.has(`team_chat|${(m as any).id}`)) continue
    candidates.push({
      source: 'team_chat',
      id: (m as any).id,
      authorUserId: (m as any).sender_user_id || null,
      authorName: (m as any).sender_name || 'Аноним',
      recipientUserId: null,
      organizationId: (m as any).organization_id || null,
      message: (m as any).message,
      createdAt: (m as any).created_at,
    })
  }
  for (const m of dm.data || []) {
    if (!(m as any).message?.trim()) continue
    if (processedSet.has(`direct_messages|${(m as any).id}`)) continue
    candidates.push({
      source: 'direct_messages',
      id: (m as any).id,
      authorUserId: (m as any).sender_user_id || null,
      authorName: (m as any).sender_name || 'Аноним',
      recipientUserId: (m as any).recipient_user_id || null,
      organizationId: null,
      message: (m as any).message,
      createdAt: (m as any).created_at,
    })
  }

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0 })
  }

  // Батч в Claude/GPT
  const batchInput = candidates.map((c, i) => `[${i}] ${c.message}`).join('\n')
  let verdicts: AIVerdict[] = []
  try {
    const result = await generateAiText({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 1500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Проанализируй ${candidates.length} сообщений (массив JSON в том же порядке):\n\n${batchInput}` },
      ],
    })
    verdicts = safeParse(result.text)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'AI failed', scanned: candidates.length })
  }

  // Вставляем флаги для severity >= 4
  let flagged = 0
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const v = verdicts[i]
    if (!v || v.severity < 4) continue
    const { error } = await supabase
      .from('chat_moderation_flags')
      .insert({
        source_table: c.source,
        source_message_id: c.id,
        author_user_id: c.authorUserId,
        author_name: c.authorName,
        recipient_user_id: c.recipientUserId,
        organization_id: c.organizationId,
        message_text: c.message,
        severity: v.severity,
        categories: v.categories,
        ai_summary: v.summary,
        ai_model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        status: 'pending',
      })
    if (!error) flagged++
  }

  return NextResponse.json({ ok: true, scanned: candidates.length, flagged })
}
