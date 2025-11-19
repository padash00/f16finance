'use server'

export async function getGeminiAdvice(data: any) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("❌ API Key is missing on server");
    return "Ошибка: Не настроен API ключ Gemini (проверьте Vercel Env Vars).";
  }

  const prompt = `
    Ты — профессиональный финансовый директор компьютерного клуба.
    Данные:
    - Доход: ${data.avgIncome}
    - Расход: ${data.avgExpense}
    - Прибыль прогноз: ${data.predictedProfit}
    - Тренд: ${data.trend}
    - Аномалии: ${JSON.stringify(data.anomalies)}
    
    Дай 3 жестких совета по увеличению прибыли. Кратко.
  `;

  try {
    // ✅ ИСПРАВЛЕНО: Используем модель gemini-2.0-flash, которую выдал вам Google
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const json = await response.json();

    // 1. Проверяем ошибки API
    if (!response.ok || json.error) {
      console.error("❌ Gemini API Error:", JSON.stringify(json.error, null, 2));
      return `Ошибка API (${response.status}): ${json.error?.message || 'Неизвестная ошибка'}`;
    }

    // 2. Проверяем наличие текста
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
        console.error("❌ No candidates in response:", JSON.stringify(json, null, 2));
        return "ИИ вернул пустой ответ. Попробуйте позже.";
    }

    return text;
    
  } catch (error) {
    console.error("❌ Network/Server Error:", error);
    return "Критическая ошибка соединения с сервером.";
  }
}
