export type AnalysisData = {
  dataRangeStart: string
  dataRangeEnd: string
  avgIncome: number
  avgExpense: number
  avgProfit: number
  avgMargin: number
  totalIncome: number
  totalExpense: number
  totalCash: number
  totalKaspi: number
  totalCard: number
  totalOnline: number
  cashlessShare: number
  onlineShare: number
  predictedIncome: number
  predictedProfit: number
  trend: number
  trendExpense: number
  confidenceScore: number
  riskLevel: 'low' | 'medium' | 'high'
  seasonalityStrength: number
  growthRate: number
  profitVolatility: number
  planIncomeAchievementPct: number
  totalPlanIncome: number
  bestDayName: string
  worstDayName: string
  expensesByCategory: Record<string, number>
  anomalies: Array<{ date: string; type: string; amount: number }>
  currentMonth: {
    income: number
    expense: number
    profit: number
    projectedIncome: number
    projectedProfit: number
  }
  previousMonth: {
    income: number
    expense: number
    profit: number
  }
  nextMonthForecast: {
    income: number
    profit: number
  }
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini'
export const EMPTY_AI_RESPONSE = 'ИИ не смог сформировать осмысленный разбор. Попробуйте обновить страницу позже.'

function extractOpenAIText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  if (!Array.isArray(payload?.output)) return ''

  const parts = payload.output
    .flatMap((item: any) => {
      if (!Array.isArray(item?.content)) return []

      return item.content.flatMap((content: any) => {
        if (typeof content?.text === 'string' && content.text.trim()) {
          return [content.text.trim()]
        }

        if (typeof content?.output_text === 'string' && content.output_text.trim()) {
          return [content.output_text.trim()]
        }

        if (Array.isArray(content?.text?.annotations) && typeof content?.text?.value === 'string' && content.text.value.trim()) {
          return [content.text.value.trim()]
        }

        return []
      })
    })
    .filter(Boolean)

  return parts.join('\n\n').trim()
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString('ru-RU') + ' ₸'
}

function formatPercent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`
}

function summarizeExpenses(expensesByCategory: Record<string, number>) {
  const total = Object.values(expensesByCategory || {}).reduce((sum, value) => sum + Number(value || 0), 0)
  const sorted = Object.entries(expensesByCategory || {}).sort(([, a], [, b]) => b - a)
  const details = sorted
    .map(([category, amount]) => {
      const share = total > 0 ? (amount / total) * 100 : 0
      return `- ${category}: ${formatMoney(amount)} (${formatPercent(share)})`
    })
    .join('\n')

  const [topCategoryName, topCategoryAmount] = sorted[0] || ['—', 0]
  const topCategoryShare = total > 0 ? (Number(topCategoryAmount || 0) / total) * 100 : 0

  return {
    total,
    details: details || '- Нет данных по категориям расходов',
    topCategoryName,
    topCategoryAmount: Number(topCategoryAmount || 0),
    topCategoryShare,
  }
}

function anomaliesText(anomalies: AnalysisData['anomalies']) {
  if (!anomalies.length) return 'Аномалий не обнаружено.'
  return anomalies
    .map((item) => `- ${item.date}: ${item.type} (${formatMoney(item.amount)})`)
    .join('\n')
}

function riskLabel(riskLevel: AnalysisData['riskLevel']) {
  if (riskLevel === 'high') return 'высокий'
  if (riskLevel === 'medium') return 'средний'
  return 'низкий'
}

function buildFallbackAdvice(data: AnalysisData) {
  const expenses = summarizeExpenses(data.expensesByCategory)
  const planGap = data.planIncomeAchievementPct - 100
  const currentMonthProjectedIncomeGap = data.currentMonth.projectedIncome - data.totalPlanIncome
  const marginSignal =
    data.avgMargin < 12 ? 'Маржа критически низкая.' : data.avgMargin < 20 ? 'Маржа ниже комфортной зоны.' : 'Маржа пока держится в рабочем диапазоне.'
  const trendSignal =
    data.trend < 0
      ? `Доход идёт вниз на ${formatMoney(Math.abs(data.trend))} в день.`
      : `Доход идёт вверх на ${formatMoney(data.trend)} в день.`
  const expenseSignal =
    data.trendExpense > 0
      ? `Расходы растут на ${formatMoney(data.trendExpense)} в день.`
      : `Расходы снижаются на ${formatMoney(Math.abs(data.trendExpense))} в день.`

  const actions = [
    `Срезать или заморозить категорию "${expenses.topCategoryName}" на 10-15% — пройти все траты вручную и убрать слабые позиции — это быстрее всего защищает маржу.`,
    data.planIncomeAchievementPct < 100
      ? `Закрыть разрыв к плану ${formatPercent(Math.abs(planGap))} — поставить недельный план по выручке и разложить его по дням/каналам — это даёт управляемость вместо надежды на общий рост.`
      : `Зафиксировать перевыполнение плана и удержать темп — разложить текущий рост по каналам и не дать расходам съесть эффект.`
    ,
    data.cashlessShare < 55
      ? 'Поднять долю безнала и online — стимулировать предоплату/удобные способы оплаты — это повышает предсказуемость денежного потока.'
      : 'Проверить комиссионную нагрузку по безналу — держать баланс между удобством клиента и чистой маржей.',
    data.anomalies.length > 0
      ? 'Разобрать аномальные дни вручную — отделить разовый выброс от системной проблемы — это помогает не принимать ложные решения.'
      : 'Ввести недельный контроль по отклонениям дохода и расхода — чтобы ловить проблему до конца месяца.',
    'Собрать 5 недельных KPI владельца: выручка, расходы, прибыль, маржа, выполнение плана — смотреть их в одном ритме каждую неделю.',
  ]

  return [
    '1. Диагноз',
    `${marginSignal} ${trendSignal} ${expenseSignal} Общий риск сейчас ${riskLabel(data.riskLevel)}.`,
    '',
    '2. Что происходит сейчас',
    `Деньги: доход ${formatMoney(data.totalIncome)}, расход ${formatMoney(data.totalExpense)}, прибыль ${formatMoney(data.totalIncome - data.totalExpense)}.`,
    `Маржа: ${formatPercent(data.avgMargin)}. Выполнение плана: ${formatPercent(data.planIncomeAchievementPct)}.`,
    `Структура оплат: наличные ${formatMoney(data.totalCash)}, Kaspi ${formatMoney(data.totalKaspi)}, card ${formatMoney(data.totalCard)}, online ${formatMoney(data.totalOnline)}.`,
    '',
    '3. Прогноз',
    `Текущий месяц, скорее всего, закроется на доходе ${formatMoney(data.currentMonth.projectedIncome)} и прибыли ${formatMoney(data.currentMonth.projectedProfit)}.`,
    `Следующий месяц сейчас выглядит как ${formatMoney(data.nextMonthForecast.income)} дохода и ${formatMoney(data.nextMonthForecast.profit)} прибыли.`,
    currentMonthProjectedIncomeGap < 0
      ? `Главный риск: недобор к плану примерно ${formatMoney(Math.abs(currentMonthProjectedIncomeGap))}.`
      : `Главный потенциал: текущий прогноз выше плана примерно на ${formatMoney(currentMonthProjectedIncomeGap)}.`,
    '',
    '4. Аномалии и закономерности',
    data.anomalies.length > 0 ? anomaliesText(data.anomalies) : 'Сильных аномалий в выборке не найдено.',
    `Самая тяжёлая категория расходов: ${expenses.topCategoryName} — ${formatMoney(expenses.topCategoryAmount)} (${formatPercent(expenses.topCategoryShare)}).`,
    `Лучший день: ${data.bestDayName}. Худший день: ${data.worstDayName}.`,
    '',
    '5. Решения на 30 дней',
    ...actions.map((item, index) => `${index + 1}. ${item}`),
    '',
    '6. Контроль владельца',
    '- Выручка за неделю',
    '- Расходы за неделю',
    '- Прибыль и маржа',
    '- Выполнение недельного плана',
    '- Доля топ-3 категорий расходов в общих тратах',
  ].join('\n')
}

export async function getOpenAIAdvice(data: AnalysisData) {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    console.error('OPENAI_API_KEY is missing')
    return buildFallbackAdvice(data)
  }

  const expenses = summarizeExpenses(data.expensesByCategory)

  const systemPrompt = `
Ты — жёсткий финансовый директор и антикризисный управляющий с большим опытом в офлайн-бизнесе.
Пишешь кратко, по делу, как человек, который отвечает за деньги.
Никаких фраз "как ИИ", никаких извинений, никакой воды.
Только управленческий разбор, прогнозы, риски и действия.
`

  const userPrompt = `
Сделай автономный CFO-разбор бизнеса на основе готовой аналитики.

КОНТЕКСТ:
- Период анализа: ${data.dataRangeStart} -> ${data.dataRangeEnd}
- Средний доход в день: ${formatMoney(data.avgIncome)}
- Средний расход в день: ${formatMoney(data.avgExpense)}
- Средняя прибыль в день: ${formatMoney(data.avgProfit)}
- Средняя маржа: ${formatPercent(data.avgMargin)}
- Тренд дохода: ${formatMoney(data.trend)} в день
- Тренд расхода: ${formatMoney(data.trendExpense)} в день
- Уровень риска: ${data.riskLevel}
- Достоверность прогноза: ${formatPercent(data.confidenceScore)}
- Сезонность: ${formatPercent(data.seasonalityStrength)}
- Темп роста: ${formatPercent(data.growthRate)}
- Волатильность прибыли: ${formatMoney(data.profitVolatility)}

ТЕКУЩАЯ СТРУКТУРА ДЕНЕГ:
- Общий доход за период: ${formatMoney(data.totalIncome)}
- Общий расход за период: ${formatMoney(data.totalExpense)}
- Наличные: ${formatMoney(data.totalCash)}
- Kaspi: ${formatMoney(data.totalKaspi)}
- Карта: ${formatMoney(data.totalCard)}
- Online: ${formatMoney(data.totalOnline)}
- Доля безнала: ${formatPercent(data.cashlessShare)}
- Доля online: ${formatPercent(data.onlineShare)}

ПЛАН И ПРОГНОЗ:
- План дохода: ${formatMoney(data.totalPlanIncome)}
- Выполнение плана: ${formatPercent(data.planIncomeAchievementPct)}
- Прогноз дохода на ближайшие 30 дней: ${formatMoney(data.predictedIncome)}
- Прогноз прибыли на ближайшие 30 дней: ${formatMoney(data.predictedProfit)}
- Текущий месяц факт: доход ${formatMoney(data.currentMonth.income)}, расход ${formatMoney(data.currentMonth.expense)}, прибыль ${formatMoney(data.currentMonth.profit)}
- Текущий месяц прогноз до закрытия: доход ${formatMoney(data.currentMonth.projectedIncome)}, прибыль ${formatMoney(data.currentMonth.projectedProfit)}
- Прошлый месяц факт: доход ${formatMoney(data.previousMonth.income)}, расход ${formatMoney(data.previousMonth.expense)}, прибыль ${formatMoney(data.previousMonth.profit)}
- Следующий месяц прогноз: доход ${formatMoney(data.nextMonthForecast.income)}, прибыль ${formatMoney(data.nextMonthForecast.profit)}

ОПЕРАЦИОННЫЕ СИГНАЛЫ:
- Лучший день недели по доходу: ${data.bestDayName}
- Худший день недели по доходу: ${data.worstDayName}
- Самая тяжёлая категория расходов: ${String(expenses.topCategoryName || '—')} — ${formatMoney(expenses.topCategoryAmount)} (${formatPercent(expenses.topCategoryShare)})

КАТЕГОРИИ РАСХОДОВ:
${expenses.details}

АНОМАЛИИ:
${anomaliesText(data.anomalies)}

ОТВЕТ ДАЙ СТРОГО В СТРУКТУРЕ:

1. **Диагноз**
Коротко и жёстко оцени состояние бизнеса сейчас.

2. **Что происходит сейчас**
- деньги
- расходы
- маржа
- выполнение плана
- структура оплат

3. **Прогноз**
- чем, скорее всего, закончится текущий месяц
- что ждёт в следующем месяце
- где риск провала, а где потенциал роста

4. **Аномалии и закономерности**
- что выглядит системной проблемой
- что похоже на разовый выброс
- какие дни/каналы/расходы проседают или перегреты

5. **Решения на 30 дней**
Дай 5-7 конкретных управленческих действий в формате:
**[действие] — [как сделать] — [зачем это даст деньги / маржу / стабильность]**

6. **Контроль владельца**
Дай 5 ключевых метрик, которые владелец должен смотреть каждую неделю.
`

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort: 'medium' },
        max_output_tokens: 1400,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: systemPrompt.trim() }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: userPrompt.trim() }],
          },
        ],
      }),
    })

    const json = await response.json().catch(() => null)

    if (!response.ok || json?.error) {
      console.error('OpenAI AI analysis error:', JSON.stringify(json, null, 2))
      if (json?.error?.code === 'rate_limit_exceeded' || response.status === 429) {
        return buildFallbackAdvice(data)
      }
      return buildFallbackAdvice(data)
    }

    const outputText = extractOpenAIText(json)
    if (outputText) return outputText

    console.error('OpenAI AI analysis returned no text:', JSON.stringify(json, null, 2))
    return buildFallbackAdvice(data)
  } catch (error) {
    console.error('Network error in getOpenAIAdvice:', error)
    return buildFallbackAdvice(data)
  }
}
