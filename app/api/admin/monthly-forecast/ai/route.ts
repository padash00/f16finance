import { NextResponse } from 'next/server'

import { generateAiText } from '@/lib/ai/provider'
import { requireAnyCapability } from '@/lib/server/capabilities'
import { requireAddon } from '@/lib/server/entitlements'
import { getRequestAccessContext } from '@/lib/server/request-auth'

/**
 * AI-вывод по прогнозу /analysis. ИИ здесь не учится и не считает прогноз —
 * он объясняет владельцу цифры модели: насколько им верить (по истории
 * промахов), что стоит за разбросом сценариев и что сделать.
 */

const fmt = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₸'
const pct = (share: unknown) => (share === null || share === undefined ? '—' : `${Math.round(Number(share) * 100)}%`)

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const addonDenied = await requireAddon(access, 'addon.ai')
    if (addonDenied) return addonDenied
    const denied = await requireAnyCapability(access, ['forecast.generate', 'analysis.refresh'])
    if (denied) return denied

    const b = await req.json().catch(() => null)
    if (!b?.scenarios) return NextResponse.json({ error: 'invalid-body' }, { status: 400 })
    const s = b.scenarios

    const system =
      'Ты финансовый аналитик. По месячному прогнозу в трёх сценариях и истории его точности дай КОРОТКИЙ вывод владельцу: ' +
      '2 абзаца простым языком, без воды и без цифр сверх данных. ' +
      'Первый — насколько верить прогнозу: опирайся на среднюю ошибку и попадание в коридор, если сверок мало — прямо скажи. ' +
      'Второй — что двигает разброс между пессимистичным и оптимистичным сценарием и 1–2 конкретных действия, чтобы месяц ушёл ближе к оптимистичному. ' +
      'Если модель стабильно промахивалась в одну сторону — упомяни. Без markdown-заголовков.'

    const misses = Array.isArray(b.misses)
      ? b.misses
          .slice(-6)
          .map((m: any) => `${m.month}: прогноз ${fmt(m.forecast)}, факт ${fmt(m.actual)}, ошибка ${pct(m.error)}${m.inside ? '' : ' (вне коридора)'}`)
          .join('\n')
      : ''

    const user = [
      `Прогноз на ${b.targetMonthLabel}.`,
      `Доход: пессимистичный ${fmt(s.pessimistic?.income)}, реальный ${fmt(s.realistic?.income)}, оптимистичный ${fmt(s.optimistic?.income)}.`,
      `Расход: пессимистичный ${fmt(s.pessimistic?.expense)}, реальный ${fmt(s.realistic?.expense)}, оптимистичный ${fmt(s.optimistic?.expense)}.`,
      `Прибыль: пессимистичный ${fmt(s.pessimistic?.profit)}, реальный ${fmt(s.realistic?.profit)}, оптимистичный ${fmt(s.optimistic?.profit)}.`,
      `Точность модели: сверок ${b.accuracy?.checks ?? 0}, средняя ошибка дохода за последние месяцы ${pct(b.accuracy?.recentError?.income)}, ` +
        `факт в коридоре ${b.accuracy?.coverage?.income?.inside ?? 0} из ${b.accuracy?.coverage?.income?.total ?? 0}.`,
      Array.isArray(b.explanation) && b.explanation.length ? `Как модель считала:\n${b.explanation.join('\n')}` : '',
      misses ? `Последние сверки:\n${misses}` : '',
      b.expense
        ? `Структура расхода: постоянные ${fmt(b.expense.fixed)}, переменные ${Number(b.expense.variableRatePct || 0).toFixed(0)}% от дохода, разовые в среднем ${fmt(b.expense.oneOffAvg)}/мес (в прогноз не входят).`
        : '',
      b.breakeven ? `Безубыточность при доходе ${fmt(b.breakeven)}.` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    const { text } = await generateAiText({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      // Reasoning-модели (gpt-5*) тратят часть бюджета на размышление
      maxTokens: model.startsWith('gpt-5') ? 3000 : 600,
    })
    return NextResponse.json({ text })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'ai-error' }, { status: 500 })
  }
}
