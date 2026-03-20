import type { AssistantPage } from '@/lib/ai/types'

export const SITE_CONTEXT = {
  product: 'Orda Control',
  purpose: 'Операционная система для финансового контроля, отчётности, смен, задач и команды.',
  pages: [
    {
      page: 'analysis' as AssistantPage,
      route: '/analysis',
      title: 'AI Разбор',
      description: 'Глубокая финансовая диагностика: тренды, аномалии, прогноз, структура оплат и рекомендации.',
    },
    {
      page: 'reports' as AssistantPage,
      route: '/reports',
      title: 'Отчёты',
      description: 'Сводная аналитика по выручке, расходам, прибыли, компаниям, категориям и сравнению периодов.',
    },
    {
      page: 'expenses' as AssistantPage,
      route: '/expenses',
      title: 'Расходы',
      description: 'Контроль расходов по категориям, компаниям, трендам, аномалиям и структуре оплат.',
    },
    {
      page: 'forecast' as AssistantPage,
      route: '/forecast',
      title: 'AI Прогноз',
      description: 'Прогноз доходов, расходов и прибыли на 30/60/90 дней на основе исторических трендов.',
    },
    {
      page: 'ratings' as AssistantPage,
      route: '/ratings',
      title: 'Рейтинг операторов',
      description: 'Лидерборд операторов по выручке, количеству смен и среднему чеку за выбранный период.',
    },
    {
      page: 'cashflow' as AssistantPage,
      route: '/cashflow',
      title: 'Cash Flow — движение денег',
      description: 'Анализ ежедневного движения денег: доходы, расходы, баланс нарастающим итогом, убыточные дни.',
    },
    {
      page: 'weekly-report' as AssistantPage,
      route: '/weekly-report',
      title: 'Недельный отчёт',
      description: 'Сальдо, структура платежей, сравнение с прошлой неделей, динамика по дням и прогноз.',
    },
    {
      page: 'global' as AssistantPage,
      route: '/',
      title: 'Глобальный консультант',
      description: 'Навигирует по сайту, подсказывает куда идти и какие данные смотреть для принятия решений.',
    },
  ],
  rules: [
    'Ассистент не имеет прямого доступа к Supabase service role key.',
    'Ассистент работает только с безопасными срезами данных и серверными функциями.',
    'Ассистент отвечает как CFO/финансовый аналитик — конкретно, с цифрами, без воды.',
    'Если данных недостаточно, ассистент прямо говорит об ограничениях вместо выдумывания.',
    'На странице cashflow фокус на балансе, убыточных днях и движении денег.',
    'На странице weekly-report генерирует структурированный отчёт с разделами.',
  ],
}
