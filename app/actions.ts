'use server'

export async function getGeminiAdvice(data: any) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return "Ошибка: Не настроен API ключ Gemini. Добавьте GEMINI_API_KEY в .env.local";
  }

  // Формируем промпт (задание) для ИИ
  const prompt = `
    Ты — профессиональный финансовый директор компьютерного клуба / кибер-арены.
    Твоя задача — проанализировать сухие цифры и дать владельцу 3 конкретных, жестких совета по увеличению прибыли.
    
    Вот данные бизнеса за последние 30-90 дней:
    - Текущий средний доход в день: ${data.avgIncome} ₸
    - Текущий средний расход в день: ${data.avgExpense} ₸
    - Прогнозируемая прибыль на след. месяц: ${data.predictedProfit} ₸
    - Тренд роста: ${data.trend > 0 ? '+' : ''}${data.trend.toFixed(2)} ₸/день
    - Найденные аномалии (дни с плохими показателями): ${JSON.stringify(data.anomalies)}
    
    Проанализируй это. 
    Если тренд отрицательный — бей тревогу. 
    Если есть аномалии расходов — укажи на это.
    Дай советы списком (1, 2, 3). Пиши кратко, без воды, как бизнесмен бизнесмену. Используй эмодзи.
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const json = await response.json();
    
    // Извлекаем текст ответа
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || "ИИ не смог сформировать ответ. Попробуйте позже.";
    
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Ошибка соединения с ИИ.";
  }
}
