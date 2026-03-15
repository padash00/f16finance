'use server'

type AnalysisData = {
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

export async function getOpenAIAdvice(data: AnalysisData) {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    console.error('OPENAI_API_KEY is missing')
    return 'Ошибка: Не настроен OPENAI_API_KEY.'
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
        return 'Ошибка: Лимит OpenAI API временно исчерпан. Подождите немного или увеличьте billing limit.'
      }
      return `Ошибка OpenAI API: ${json?.error?.message || `HTTP ${response.status}`}`
    }

    const text = json?.output_text
    if (typeof text === 'string' && text.trim()) return text.trim()

    return 'ИИ не смог сформировать осмысленный разбор. Попробуйте обновить страницу позже.'
  } catch (error) {
    console.error('Network error in getOpenAIAdvice:', error)
    return 'Ошибка соединения с OpenAI API.'
  }
}

export const getGeminiAdvice = getOpenAIAdvice
