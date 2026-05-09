/**
 * AI-инсайт по текущему срезу страницы /reports.
 * Принимает агрегированные totals (что уже есть на клиенте) → отдаёт короткий
 * комментарий ассистента: что важного, на что обратить внимание.
 *
 * Cheap call — gpt-4o-mini, ~150 tokens out.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { generateAiText } from '@/lib/ai/provider'

export const runtime = 'nodejs'

function fmtMoney(v: number) {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
  if (Math.abs(v) >= 1_000) return Math.round(v / 1_000) + 'к ₸'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

function pct(curr: number, prev: number) {
  if (!prev) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

interface Body {
  dateFrom?: string
  dateTo?: string
  totals?: {
    incomeTotal?: number
    expenseTotal?: number
    profit?: number
    incomeCash?: number
    incomeKaspi?: number
    incomeOnline?: number
    incomeCard?: number
  }
  totalsPrev?: {
    incomeTotal?: number
    expenseTotal?: number
    profit?: number
  }
  topIncome?: { name: string; value: number }[]
  topExpense?: { name: string; value: number }[]
  cashlessLabel?: string  // "Kaspi" / "Halyk" / "Безналичный"
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body?.totals) return NextResponse.json({ error: 'totals required' }, { status: 400 })

  const t = body.totals
  const tp = body.totalsPrev || {}
  const cashLabel = body.cashlessLabel || 'безналичный'

  const incomeChange = pct(t.incomeTotal || 0, tp.incomeTotal || 0)
  const expenseChange = pct(t.expenseTotal || 0, tp.expenseTotal || 0)
  const profitChange = pct(t.profit || 0, tp.profit || 0)

  const prompt = [
    `Период: ${body.dateFrom} — ${body.dateTo}`,
    `Доход: ${fmtMoney(t.incomeTotal || 0)}${incomeChange !== null ? ` (${incomeChange > 0 ? '+' : ''}${incomeChange.toFixed(0)}% к прошлому периоду)` : ''}`,
    `Расход: ${fmtMoney(t.expenseTotal || 0)}${expenseChange !== null ? ` (${expenseChange > 0 ? '+' : ''}${expenseChange.toFixed(0)}%)` : ''}`,
    `Прибыль: ${fmtMoney(t.profit || 0)}${profitChange !== null ? ` (${profitChange > 0 ? '+' : ''}${profitChange.toFixed(0)}%)` : ''}`,
    `Структура дохода: нал ${fmtMoney(t.incomeCash || 0)}, ${cashLabel} ${fmtMoney(t.incomeKaspi || 0)}, online ${fmtMoney(t.incomeOnline || 0)}, карта ${fmtMoney(t.incomeCard || 0)}`,
    body.topIncome?.length ? `Топ доходов: ${body.topIncome.slice(0, 3).map(i => `${i.name} (${fmtMoney(i.value)})`).join(', ')}` : '',
    body.topExpense?.length ? `Топ расходов: ${body.topExpense.slice(0, 3).map(i => `${i.name} (${fmtMoney(i.value)})`).join(', ')}` : '',
    '',
    'Ты опытный финансист, помогаешь владельцу сети игровых клубов. Напиши КОРОТКОЕ (макс 4 строки) сообщение про этот период:',
    '— что важно отметить (рост/падение, аномалии, концентрация)',
    '— 1 короткий совет если есть что улучшить',
    '— стиль: дружелюбный, прямой, без воды; 1-2 эмодзи',
    'НЕ начинай с "Привет"/"Здравствуйте". Начни сразу с эмодзи и сути.',
  ].filter(Boolean).join('\n')

  try {
    const result = await generateAiText({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens: 250,
      messages: [
        { role: 'system', content: 'Ты — финансовый ассистент владельца сети игровых клубов в Казахстане. Пиши кратко, по делу, на русском.' },
        { role: 'user', content: prompt },
      ],
    })
    return NextResponse.json({ text: result.text, tokens: result.usage?.total_tokens || null })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'AI failed' }, { status: 500 })
  }
}
