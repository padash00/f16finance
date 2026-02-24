'use server'

// Определяем тип входящих данных для строгости
type AnalysisData = {
  avgIncome: number;
  avgExpense: number;
  predictedProfit: number;
  trend: number;
  expensesByCategory: Record<string, number>;
  anomalies: Array<{ date: string; type: string; amount: number }>;
}

export async function getGeminiAdvice(data: AnalysisData) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("❌ API Key is missing");
    return "Ошибка: Не настроен API ключ Gemini.";
  }

  // 1. ПОДГОТОВКА ДАННЫХ

  // Общий расход за период
  const totalExpenseForPeriod = Object
    .values(data.expensesByCategory || {})
    .reduce((a, b) => a + b, 0);

  // Топ-категория расходов
  const sortedExpenses = Object.entries(data.expensesByCategory || {})
    .sort(([, a], [, b]) => b - a);

  const [topCategoryNameRaw, topCategoryAmountRaw] = sortedExpenses[0] || ['—', 0];
  const topCategoryName = topCategoryNameRaw || '—';
  const topCategoryAmount = topCategoryAmountRaw || 0;

  const topCategoryShare = totalExpenseForPeriod > 0
    ? (topCategoryAmount / totalExpenseForPeriod) * 100
    : 0;

  // Маржа и структура
  const dailyProfit = data.avgIncome - data.avgExpense;
  const marginPercent = data.avgIncome > 0
    ? (dailyProfit / data.avgIncome) * 100
    : 0;

  const expenseSharePercent = data.avgIncome > 0
    ? (data.avgExpense / data.avgIncome) * 100
    : 0;

  // Текст расходов с процентами (для разборки по категориям)
  const expensesText = sortedExpenses
    .map(([cat, amount]) => {
      const percent = totalExpenseForPeriod > 0
        ? ((amount / totalExpenseForPeriod) * 100).toFixed(1)
        : '0.0';
      return `- ${cat}: ${amount.toLocaleString('ru-RU')} ₸ (${percent}%)`;
    })
    .join('\n');

  // Текст аномалий
  const anomaliesText = data.anomalies.length > 0
    ? data.anomalies
        .map(a => `- ${a.date}: ${a.type} (${a.amount.toLocaleString('ru-RU')} ₸)`)
        .join('\n')
    : "Аномалий не обнаружено. Выручка и расходы ведут себя предсказуемо.";

  // 2. ПРОМПТ — ПЕРСОНА + ЖЁСТКАЯ СТРУКТУРА

  const prompt = `
РОЛЬ:
Ты — жёсткий, прагматичный финансовый директор и антикризисный консультант
с 30–40 годами опыта в крупных корпорациях. Несколько компаний ты вытянул
из предбанкротного состояния. Ты не боишься говорить неприятную правду.
Ты не пишешь как студент, ты пишешь как человек, который отвечает за деньги.

НИКАКИХ фраз вида "как ИИ", никаких извинений, никаких рассуждений о себе.
Только сухой профессиональный анализ и конкретные управленческие выводы.

ОТРАСЛЕВЫЕ БЕНЧМАРКИ (компьютерные клубы / офлайн-развлечения):
- Целевая операционная маржа (после основных расходов): 20–30%+.
- ФОТ (зарплаты): до 30% от выручки.
- Аренда: до 15–20% от выручки.
- Маркетинг: 5–10% от выручки.
Если фактические значения выше — это уже зона риска.

ВХОДНЫЕ ДАННЫЕ (за последние ~30 дней, агрегированные):

1) ФИНАНСОВЫЕ ПОКАЗАТЕЛИ:
- Средняя выручка в день: ${data.avgIncome.toLocaleString('ru-RU')} ₸
- Средний расход в день: ${data.avgExpense.toLocaleString('ru-RU')} ₸
- Средняя дневная прибыль: ${dailyProfit.toLocaleString('ru-RU')} ₸
- Операционная маржа по прибыли: ${marginPercent.toFixed(1)}%
- Доля расходов от выручки: ${expenseSharePercent.toFixed(1)}%
- Прогноз прибыли на следующий месяц: ${data.predictedProfit.toLocaleString('ru-RU')} ₸
- Тренд выручки: ${data.trend > 0 ? 'рост' : (data.trend < 0 ? 'падение' : 'боковик')} на ${Math.abs(data.trend).toFixed(0)} ₸ в день

2) СТРУКТУРА РАСХОДОВ:
- Всего расходов по категориям: ${totalExpenseForPeriod.toLocaleString('ru-RU')} ₸
- Крупнейшая категория: ${topCategoryName} — ${topCategoryAmount.toLocaleString('ru-RU')} ₸ (${topCategoryShare.toFixed(1)}% от всех затрат)
Детализация по категориям:
${expensesText || '- Нет данных по категориям расходов'}

3) АНОМАЛИИ (выбросы по дням):
${anomaliesText}

ЗАДАЧА:
Проведи полноценный управленческий разбор: насколько бизнес сейчас жизнеспособен,
где он теряет деньги, и какие управленческие решения надо принимать.

ФОРМАТ ОТВЕТА (строго по структуре, Markdown):

1️⃣ **Краткий диагноз (1–3 жёстких предложения)**  
Опиши состояние бизнеса так, как сказал бы акционерам: без смягчений и красивых формулировок.

2️⃣ **Финансовый анализ (по пунктам)**  
Разбери по подпунктам:
- **Прибыльность и маржа.** Сравни текущую маржу и структуру расходов с бенчмарками, дай вывод: норма / погранично / плохо.
- **Структура затрат.** Отдельно прокомментируй крупнейшую категорию расходов (${topCategoryName}) — это нормально для такого бизнеса или раздуто.
- **Динамика (тренд).** Что означает текущий тренд выручки и прибыли — ускорение, торможение, стагнация.
- **Устойчивость.** Насколько бизнес устойчив к просадке выручки на 20–30% (ответ качественный, но с опорой на цифры).

3️⃣ **Конкретные управленческие решения на 30 дней**  
Дай список из 4–7 конкретных действий:
- минимум 2 пункта по **сокращению или переформатированию расходов** (но без банального "сократить все расходы");
- минимум 2 пункта по **росту выручки** (цены, акции, сегменты клиентов, работа с чек-моделями, загрузка ночи/дня);
- отделяй то, что даёт быстрый эффект (до 30 дней), от того, что работает как среднесрочная стратегия (2–3 месяца).

Каждый пункт должен быть в формате:  
**[Суть действия] — [механика] — [ожидаемый эффект в деньгах / марже]**.

4️⃣ **Риски и аномалии**  
Кратко оцени:
- какие из аномалий выглядят разовыми (объяснимыми),
- какие похожи на системную проблему (например, перекос в определённые дни или категории),
- к чему это приведёт, если ничего не делать.

5️⃣ **Что контролировать еженедельно (доска метрик)**  
Дай список 5–7 ключевых метрик, которые владелец должен смотреть каждую неделю
(прям по названиям метрик: "Маржа по клубу, %", "Выручка по сменам день/ночь", и т.д.).

ТРЕБОВАНИЯ К СТИЛЮ:
- Пиши как опытный финансовый директор, а не как блогер и не как студент.
- Минимум эмоций, максимум сути. Допускаются жёсткие формулировки.
- Никаких длинных вступлений, сразу к делу.
- Не пересказывай входные данные — работай с выводами и управленческими решениями.
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4, // логика > креатив
            maxOutputTokens: 700,
          }
        }),
      }
    );

    const json = await response.json();
    
    if (!response.ok || json.error) {
      console.error("AI Error:", JSON.stringify(json, null, 2));
      if (json.error?.code === 429) return "Ошибка: Превышен лимит запросов к ИИ.";
      return `Ошибка API: ${json.error?.message || 'Неизвестная ошибка'}`;
    }

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || "ИИ не смог сформировать осмысленный ответ. Попробуйте позже.";
    
  } catch (error) {
    console.error("Network Error in getGeminiAdvice:", error);
    return "Ошибка соединения с сервером.";
  }
}
