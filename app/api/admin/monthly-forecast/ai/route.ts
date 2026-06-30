import { NextResponse } from 'next/server'

import { generateAiText } from '@/lib/ai/provider'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'

function fmt(n: number) {
  return Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₸'
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'forecast.generate')
    if (denied) return denied

    const b = await req.json().catch(() => null)
    if (!b) return NextResponse.json({ error: 'invalid-body' }, { status: 400 })

    const sys =
      'Ты финансовый аналитик. По цифрам месячного прогноза дай КОРОТКИЙ вывод для владельца бизнеса: ' +
      '1-2 абзаца, простым языком, без воды и без выдумывания цифр сверх данных. ' +
      'Скажи главное: реалистичен ли прогноз, на что обратить внимание (доход/постоянные/переменные расходы), 1-2 конкретных действия. ' +
      'Если уверенность низкая или мало данных — честно предупреди. Не используй markdown-заголовки.'

    const user =
      `Прогноз на ${b.targetMonthLabel}.\n` +
      `Доход: ожидаемый ${fmt(b.income?.expected)} (диапазон ${fmt(b.income?.low)}–${fmt(b.income?.high)}), ` +
      `средний за последние месяцы ${fmt(b.income?.recentAvg)}, тренд ${Number(b.income?.momGrowthPct || 0).toFixed(1)}%/мес, ` +
      `сезонность ${b.confidence?.seasonalityAvailable ? `×${Number(b.income?.seasonalIndex).toFixed(2)}` : 'недоступна (<13 мес)'}.\n` +
      `Расход: ожидаемый ${fmt(b.expense?.expected)} = постоянные ${fmt(b.expense?.fixed)} + переменные ${fmt(b.expense?.variable)} ` +
      `(${Number(b.expense?.variableRatePct || 0).toFixed(0)}% от дохода). Разовые в среднем ${fmt(b.expense?.oneOffAvg)}/мес (вне прогноза).\n` +
      `Прибыль ожидаемая ${fmt(b.profit?.expected)} (худший ${fmt(b.scenarios?.worst)}, лучший ${fmt(b.scenarios?.best)}).\n` +
      `Уверенность ${b.confidence?.score}/100, месяцев данных ${b.confidence?.monthsOfData}, волатильность ${Number(b.confidence?.volatilityPct || 0).toFixed(0)}%.`

    const { text } = await generateAiText({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0.4,
      maxTokens: 500,
    })
    return NextResponse.json({ text })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'ai-error' }, { status: 500 })
  }
}
