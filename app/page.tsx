import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Boxes,
  Brain,
  CheckCircle2,
  Clock4,
  Crown,
  LineChart,
  Package,
  PiggyBank,
  Receipt,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ContactLeadForm } from '@/components/public/contact-lead-form'
import { FaqStructuredData, WebsiteStructuredData } from '@/components/public/structured-data'
import { SITE_NAME } from '@/lib/core/site'

export const metadata: Metadata = {
  title: 'OrdaOps — финансы клуба, смены, магазин и AI-помощник',
  description:
    'Видите ОПиУ, EBITDA, маржу и прибыль клуба каждый день, а не в конце месяца. Закрытие смен автоматически. Магазин со складом и витриной. AI-помощник объясняет цифры. Telegram-отчёты автоматически.',
}

// ─────────────────────── HERO ───────────────────────

const heroBadges = [
  '💰 ОПиУ и EBITDA каждый день',
  '🤖 AI объясняет цифры',
  '⏰ Закрытие смен за 30 секунд',
  '📦 Склад и витрина по полочкам',
  '📲 Отчёты в Telegram',
]

// ─────────────────────── ПЭЙН-ПОИНТЫ ───────────────────────

const painPoints = [
  {
    icon: '💸',
    pain: 'Узнаю прибыль клуба только когда бухгалтер закроет месяц',
    solution: 'ОПиУ и EBITDA обновляются каждый раз когда оператор закрывает смену',
  },
  {
    icon: '📉',
    pain: 'Маржа упала, а почему — не понимаю',
    solution: 'AI смотрит ваши цифры и говорит: "выросла закупка колы на 14%, найдите альтернативу"',
  },
  {
    icon: '🚪',
    pain: 'Кассир ушёл с разницей и непонятно откуда',
    solution: 'Закрытие смены автоматически считает из продаж, расхождение подсвечено красным',
  },
  {
    icon: '👥',
    pain: 'Зарплата операторов — каждый месяц спор и ручной пересчёт',
    solution: 'Гибкие правила: % от выручки + KPI − штрафы. Считается само, выводится по неделям',
  },
  {
    icon: '🌙',
    pain: 'Ночной Kaspi не сходится с банковской выпиской',
    solution: 'Раздельный учёт Kaspi до и после полуночи — выручка по календарным суткам',
  },
  {
    icon: '📲',
    pain: 'Я в Алматы, клуб в Шымкенте — что там сейчас?',
    solution: 'Telegram-отчёт после каждой смены: выручка, разница, кто работал',
  },
  {
    icon: '📦',
    pain: 'На складе товар есть, на витрине нет — продать невозможно',
    solution: 'Склад и витрина — независимые балансы, заявки на пополнение, история движений',
  },
  {
    icon: '🧾',
    pain: 'Не успеваю смотреть фотки накладных от поставщиков',
    solution: 'AI парсит фото счёта-фактуры, находит товары в каталоге, импортирует в приёмку',
  },
]

// ─────────────────────── 3 СТОЛПА ───────────────────────

const pillars = [
  {
    icon: PiggyBank,
    title: 'Финансы клуба',
    subtitle: 'каждый день, а не в конце месяца',
    points: [
      'ОПиУ автоматически из продаж и расходов',
      'EBITDA и маржа по точкам и в сумме',
      'Прогноз выручки на 90 дней с подсветкой аномалий',
      'Раздельный учёт нал / Kaspi / онлайн / карта',
      'Сверка Kaspi-комиссий с банковской выпиской',
      'История по дням, неделям, месяцам с экспортом',
    ],
    cta: 'Финансовый дашборд',
  },
  {
    icon: Brain,
    title: 'AI-помощник',
    subtitle: 'объясняет цифры человеческим языком',
    points: [
      'Анализирует выручку, расходы, маржу, операторов',
      'Подсвечивает аномалии: «нал в кассе на 8 200 ₸ меньше»',
      'Объясняет тренды: почему выросло, почему упало',
      'Рекомендации: где сэкономить, что усилить',
      'OCR накладных: фото счёта → автоимпорт в приёмку',
      'Прогноз спроса по товарам',
    ],
    cta: 'AI-аналитика',
  },
  {
    icon: Clock4,
    title: 'Смены без хаоса',
    subtitle: 'открытие, закрытие, Z-отчёт',
    points: [
      'Открытие со стартовой мелочью кассы',
      'Закрытие автоматически считает из продаж',
      'Учёт мелочи (оборотные деньги) отдельно',
      'Z-отчёт в стиле кассового чека',
      'Расхождения подсвечены красным сразу',
      'Telegram-уведомление с итогами автоматически',
    ],
    cta: 'Закрытие смен',
  },
  {
    icon: Boxes,
    title: 'Магазин',
    subtitle: 'склад, витрина, приёмка, ревизия',
    points: [
      'Склад и витрина — независимые балансы',
      'Заявки склад → витрина с резервированием',
      'Приёмка от поставщика с OCR накладных через AI',
      'Ревизия с автоматическим расчётом недостачи',
      'POS-касса бьёт только витрину, без сюрпризов',
      'История каждого движения товара',
    ],
    cta: 'Магазин',
  },
]

// ─────────────────────── AI ПРИМЕРЫ ───────────────────────

const aiExamples = [
  {
    type: 'warning',
    title: 'Аномалия в кассе',
    content:
      'Сегодня нал в кассе на 8 200 ₸ меньше расчётного из продаж. Возможные причины: ошибка кассира, незакрытая возвратная операция, недостача. Рекомендую проверить смену оператора Айгерим за период 14:00–18:00.',
  },
  {
    type: 'insight',
    title: 'Что съедает прибыль',
    content:
      'За последние 7 дней маржа упала на 3.2%. Главная причина: рост закупочной цены на колу у поставщика «Алматы-Дрим» на 14%. Альтернативный поставщик «Тастак» предлагает на 11% дешевле — экономия около 42 000 ₸/мес.',
  },
  {
    type: 'opportunity',
    title: 'Где можно вырасти',
    content:
      'Категория «энергетики» приносит 18% выручки при 4% от ассортимента. Топ-3 позиции расходятся за 1.8 дня. Рекомендую расширить ассортимент энергетиков — потенциальный рост выручки 6-8%.',
  },
  {
    type: 'team',
    title: 'Аналитика по операторам',
    content:
      'Айгерим показывает средний чек 2 850 ₸ против 1 920 ₸ у остальных (+48%). Конверсия в дополнительные позиции 67% против 31%. Рекомендую сделать её наставником и провести обучение для команды.',
  },
]

// ─────────────────────── ФИНАНСОВЫЕ МЕТРИКИ ───────────────────────

const financialMetrics = [
  { label: 'Выручка', value: '4 820 000', delta: '+12%', trend: 'up' },
  { label: 'Маржа', value: '42%', delta: '-3%', trend: 'down' },
  { label: 'EBITDA', value: '1 960 000', delta: '+8%', trend: 'up' },
  { label: 'ФОТ', value: '1 120 000', delta: '0%', trend: 'flat' },
]

// ─────────────────────── СМЕНА ЗА 30 СЕКУНД ───────────────────────

const shiftSteps = [
  {
    step: '1',
    time: '08:00',
    title: 'Открытие смены',
    text: 'Оператор приходит. Указывает стартовую мелочь в кассе. Жмёт «Открыть смену». Всё.',
  },
  {
    step: '2',
    time: '08:00 — 22:00',
    title: 'Работа дня',
    text: 'Продажи, возвраты. Фоном: складские заявки, продажи через POS, учёт долгов клиентов.',
  },
  {
    step: '3',
    time: '22:00',
    title: 'Закрытие смены',
    text: 'Жмёт «Заполнить из продаж». Вычитает мелочь. Подтверждает. Z-отчёт автоматически в Telegram.',
  },
]

// ─────────────────────── СРАВНЕНИЕ ───────────────────────

const competitors = [
  {
    name: 'Excel + бухгалтер раз в месяц',
    cells: ['—', '—', '—', '—', '—', '—', '—'],
  },
  {
    name: '1С: Розница',
    cells: ['△', '✓', '—', '△', '✓', '—', '—'],
  },
  {
    name: 'Wipon / Poster (POS)',
    cells: ['△', '△', '—', '△', '✓', '✓', '—'],
  },
  {
    name: 'OrdaOps',
    cells: ['✓✓', '✓✓', '✓', '✓✓', '✓✓', '✓✓', '✓✓'],
    highlight: true,
  },
]
const competitorColumns = [
  'ОПиУ ежедневно',
  'EBITDA / маржа',
  'AI-помощник',
  'Смены и Z-отчёт',
  'Склад/витрина',
  'Telegram автоматом',
  'Прогноз 90 дней',
]

// ─────────────────────── ЦЕНЫ ───────────────────────

const pricingPlans = [
  {
    name: 'Базовый',
    price: '25 000',
    note: '/мес за точку',
    features: [
      'Дашборд с выручкой и расходами',
      'Открытие/закрытие смен с Z-отчётом',
      'Telegram-отчёты автоматом',
      'Operator Desktop (Windows-касса)',
      'До 3 операторов на точку',
      'Поддержка в Telegram',
    ],
    cta: 'Начать',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '45 000',
    note: '/мес за точку',
    features: [
      'Всё из Базового',
      'AI-помощник и финансовая аналитика',
      'ОПиУ, EBITDA, маржа автоматически',
      'Прогноз выручки на 90 дней',
      'OCR накладных через AI',
      'KPI и расчёт зарплаты по правилам',
      'Без ограничений на операторов',
    ],
    cta: 'Выбрать Pro',
    highlight: true,
    badge: 'Главный план',
  },
  {
    name: 'Сеть',
    price: 'Договорно',
    note: 'для нескольких точек',
    features: [
      'Всё из Pro',
      'Несколько точек на одной БД',
      'Иерархия компании',
      'Кастомные правила и отчёты',
      'Выделенный менеджер',
      'Приоритет в фичах',
    ],
    cta: 'Связаться',
    highlight: false,
  },
]

// ─────────────────────── РОЛИ ───────────────────────

const audiences = [
  {
    icon: Crown,
    title: 'Владельцу',
    text: 'Не ждать конца месяца чтобы понять прибыль. Видеть ОПиУ, EBITDA, маржу каждый день. AI-помощник объясняет где утечки и где можно усилить.',
  },
  {
    icon: ShieldCheck,
    title: 'Управляющему',
    text: 'Контроль смен, операторов, расхождений в кассе. Понятная зарплата с KPI. Telegram-отчёты после каждой смены без ручной сверки.',
  },
  {
    icon: Store,
    title: 'Оператору',
    text: 'Открыл смену → работал → закрыл смену. Z-отчёт автоматом. Касса для попутных продаж. Минимум ручного, максимум скорости.',
  },
]

// ─────────────────────── ДО / ПОСЛЕ ───────────────────────

const before = [
  'Прибыль становится понятна 5-го числа следующего месяца',
  'Расхождения в кассе обнаруживаются на ревизии раз в квартал',
  'Зарплата операторов — каждый раз ручной пересчёт и спор',
  'Ночной Kaspi не сходится с банковской выпиской',
  'Анализ "почему меньше денег" — догадки и ощущения',
]

const after = [
  'ОПиУ и EBITDA обновляются каждые 15 минут',
  'Расхождение видно сразу при закрытии смены',
  'Зарплата считается автоматически по правилам и KPI',
  'Раздельный учёт Kaspi по календарным суткам',
  'AI смотрит цифры и точно говорит причину',
]

// ─────────────────────── FAQ ───────────────────────

const faqItems = [
  {
    question: 'Чем это отличается от 1С: Розницы?',
    answer:
      '1С — учётная система. Орда — операционно-финансовая платформа: смены, касса, AI-аналитика, Telegram. Главное отличие: вы видите финансы каждый день в реальном времени с AI-объяснениями, а не закрываете месяц задним числом.',
  },
  {
    question: 'А если я уже использую Wipon или Poster?',
    answer:
      'Они хороши как POS, но не дают финансовую аналитику уровня владельца. С нами можно работать в дополнение: касса остаётся в Wipon, а закрытие смен и финансы — в OrdaOps. Или полностью перейти — поможем с миграцией каталога.',
  },
  {
    question: 'AI правда работает или это маркетинг?',
    answer:
      'Внутри — GPT-4o (и Gemini как fallback). Видит ваши данные: выручка, расходы, маржа, операторы, склад. Прогнозирует, объясняет тренды, находит аномалии. Не "пишет тексты" — анализирует цифры и даёт конкретные рекомендации с числами.',
  },
  {
    question: 'Что нужно установить?',
    answer:
      'На кассовом компьютере (Windows) — Operator Desktop. На вашем телефоне/ноутбуке — ничего, веб-админка работает в браузере на ordaops.kz. Серверов и баз данных у вас не должно быть.',
  },
  {
    question: 'Работает без интернета?',
    answer:
      'Кассовая программа — да. Сохраняет операции локально и синхронизируется когда сеть вернётся. Веб-админка требует интернет (но дашборд кэшируется на сутки).',
  },
  {
    question: 'Кто видит мои финансовые данные?',
    answer:
      'Только вы и те кому вы дали доступ. Multi-tenant: ваши данные физически изолированы от других клубов. RLS-политики на уровне базы данных, ролевая проверка на каждом запросе. Аудит-лог сохраняет каждое действие.',
  },
  {
    question: 'Есть ли пробный период?',
    answer:
      'Первая точка — 2 недели бесплатно с полным доступом ко всем функциям. Если не подойдёт — все ваши данные можно выгрузить в Excel и забрать с собой. Никаких обязательств.',
  },
  {
    question: 'Как обновляется?',
    answer:
      'Веб-админка — автоматически. Кассовая программа — auto-update при следующем запуске. Все обновления бесплатные, в том числе новые AI-функции.',
  },
]

// ─────────────────────── РЕЗУЛЬТАТ ───────────────────────

const outcomes = [
  'Видите прибыль клуба каждый вечер, а не 5-го числа следующего месяца',
  'Понимаете причины движений выручки благодаря AI',
  'Закрытие смен — 30 секунд вместо 30 минут',
  'Расхождения в кассе находите сразу, а не на ревизии',
  'Зарплата считается сама, без споров с операторами',
]

// ─────────────────────── СТРАНИЦА ───────────────────────

export default async function MarketingHomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_20%),linear-gradient(180deg,#050816_0%,#0a1020_48%,#050816_100%)] text-white">
      <WebsiteStructuredData />
      <FaqStructuredData faq={faqItems} />

      {/* ────────── Шапка ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 pb-10 pt-8 sm:px-8 lg:px-10">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-base font-bold text-slate-950">
              ◇
            </div>
            <div>
              <div className="text-lg font-semibold">{SITE_NAME}</div>
              <div className="text-xs text-slate-400">Финансы и смены клуба</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden sm:inline-flex text-slate-200">
              <Link href="#pillars">Возможности</Link>
            </Button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex text-slate-200">
              <Link href="#pricing">Цены</Link>
            </Button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild className="bg-amber-500 text-slate-950 hover:bg-amber-400">
              <Link href="#contact">
                Демо за 5 минут
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ────────── Hero ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
              <Sparkles className="h-3.5 w-3.5" />
              Финансовая платформа для игровых клубов
            </div>

            <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              Видите финансы клуба
              <span className="block bg-gradient-to-r from-amber-300 via-orange-300 to-amber-100 bg-clip-text text-transparent">
                каждый день, а не 5-го числа
              </span>
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-slate-300">
              ОПиУ, EBITDA, маржа и прогноз — обновляются каждый раз когда оператор
              закрывает смену. Магазин со складом, витриной и приёмкой по AI.
              AI-помощник видит ваши цифры и объясняет где деньги утекают.
              Telegram-отчёты автоматически.
            </p>

            <div className="flex flex-wrap gap-2">
              {heroBadges.map((b) => (
                <span
                  key={b}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300"
                >
                  {b}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-amber-500 text-slate-950 hover:bg-amber-400">
                <Link href="#contact">
                  Попробовать бесплатно 2 недели
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                <Link href="#pillars">Что внутри</Link>
              </Button>
            </div>

            <div className="flex items-center gap-6 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                Без обязательств
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                Данные ваши, можно забрать
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                Помощь с переходом
              </div>
            </div>
          </div>

          {/* Визуал справа: финансовый дашборд */}
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
            <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
                <span>Финансовый дашборд</span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                  ● live
                </span>
              </div>

              {/* Метрики */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                {financialMetrics.map((m) => (
                  <div key={m.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">{m.label}</div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-xl font-semibold tabular-nums">{m.value}</span>
                      {m.label !== 'Маржа' && <span className="text-xs text-slate-500">₸</span>}
                    </div>
                    <div
                      className={`mt-1 flex items-center gap-1 text-[10px] ${
                        m.trend === 'up'
                          ? 'text-emerald-300'
                          : m.trend === 'down'
                            ? 'text-rose-300'
                            : 'text-slate-400'
                      }`}
                    >
                      {m.trend === 'up' && <ArrowUpRight className="h-3 w-3" />}
                      {m.trend === 'down' && <ArrowDownRight className="h-3 w-3" />}
                      {m.delta} к среднему
                    </div>
                  </div>
                ))}
              </div>

              {/* AI блок */}
              <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
                  <Bot className="h-3.5 w-3.5" />
                  AI-наблюдение · сейчас
                </div>
                <div className="mt-2 text-xs leading-5 text-amber-50/90">
                  Маржа упала на 3% за неделю. Главная причина: рост закупочной цены
                  на колу на 14%. Альтернативный поставщик «Тастак» предлагает дешевле —
                  экономия 42 000 ₸/мес.
                </div>
              </div>

              {/* Telegram превью */}
              <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">📲 Telegram отчёт после смены</div>
                <div className="mt-1 text-xs leading-5 text-slate-300">
                  <span className="font-semibold text-white">F16 Ramen · Ночь · Айгерим</span>
                  <br />
                  Kaspi: 194 025 ₸ · Нал: 26 000 ₸ · Мелочь: 600 ₸
                  <br />
                  <span className="text-emerald-300">✓ Расхождений нет</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ────────── Боли ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Знакомая ситуация?
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Что обычно болит у владельца клуба
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Под каждой болью — что конкретно делает OrdaOps. Без маркетинга, по существу.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {painPoints.map((p) => (
            <Card
              key={p.pain}
              className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] transition hover:border-amber-400/30"
            >
              <div className="text-3xl">{p.icon}</div>
              <h3 className="mt-3 text-base font-semibold leading-tight">{p.pain}</h3>
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <div className="text-xs leading-5 text-emerald-100/90">{p.solution}</div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── ГЛАВНЫЕ СТОЛПЫ ────────── */}
      <section id="pillars" className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Что внутри OrdaOps
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Финансы. AI. Смены. Магазин.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Это не «много фич чтобы продать» — это четыре вещи которые меняют как
            вы управляете клубом.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((p) => {
            const Icon = p.icon
            return (
              <Card
                key={p.title}
                className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)] sm:p-7"
              >
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-400/10 text-amber-200">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-2xl font-semibold tracking-[-0.02em]">{p.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{p.subtitle}</p>
                <ul className="mt-5 space-y-2.5 border-t border-white/10 pt-5">
                  {p.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm leading-6 text-slate-300">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })}
        </div>
      </section>

      {/* ────────── AI ПОМОЩНИК — БОЛЬШАЯ СЕКЦИЯ ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <Card className="overflow-hidden border-amber-400/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(255,255,255,0.03))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
                <Bot className="h-3.5 w-3.5" />
                AI-помощник
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Не «пишет тексты»,
                <br />
                а анализирует ваши цифры
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Внутри — GPT-4o (и Gemini как резерв). Видит вашу выручку, расходы,
                операторов, склад. Замечает аномалии, объясняет тренды, советует
                конкретные действия с числами.
              </p>

              <div className="mt-6 space-y-3">
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <Brain className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="text-sm leading-6 text-slate-200">
                    <strong className="text-white">Финансовая аналитика</strong> — почему упала маржа, где утечки
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="text-sm leading-6 text-slate-200">
                    <strong className="text-white">Прогнозы на 90 дней</strong> с подсветкой аномалий
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="text-sm leading-6 text-slate-200">
                    <strong className="text-white">OCR накладных</strong> — фото счёта → автоимпорт в приёмку
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Реальные подсказки которые выдаёт AI:
              </div>
              {aiExamples.map((ex) => {
                const colors = {
                  warning: { border: 'border-rose-500/30', bg: 'bg-rose-500/5', label: 'text-rose-200' },
                  insight: { border: 'border-amber-400/30', bg: 'bg-amber-400/5', label: 'text-amber-200' },
                  opportunity: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', label: 'text-emerald-200' },
                  team: { border: 'border-sky-400/30', bg: 'bg-sky-400/5', label: 'text-sky-200' },
                }[ex.type]!
                return (
                  <div
                    key={ex.title}
                    className={`rounded-2xl border ${colors.border} ${colors.bg} p-4`}
                  >
                    <div className={`text-xs font-semibold uppercase tracking-wide ${colors.label}`}>
                      {ex.title}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-200">{ex.content}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      </section>

      {/* ────────── СМЕНА ЗА 30 СЕКУНД ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Закрытие смен
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Смена за 30 секунд вместо 30 минут
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Главная боль клубов — закрытие смены. У нас оно занимает столько же времени,
            сколько проверить, не забыл ли ты выключить свет.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {shiftSteps.map((s) => (
            <Card
              key={s.step}
              className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]"
            >
              <div className="flex items-baseline justify-between">
                <div className="text-3xl font-bold text-amber-300">{s.step}</div>
                <div className="text-xs text-slate-400">{s.time}</div>
              </div>
              <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{s.text}</p>
            </Card>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 text-sm leading-6 text-emerald-100">
          <strong>Что внутри закрытия:</strong> учёт мелочи как оборотные деньги,
          раздельный Kaspi до и после полуночи, автоматическая сверка с продажами,
          подсветка расхождений, Z-отчёт в Telegram. Всё — одной кнопкой.
        </div>
      </section>

      {/* ────────── МАГАЗИН ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,rgba(16,185,129,0.08),rgba(255,255,255,0.03))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-200">
                <Boxes className="h-3.5 w-3.5" />
                Магазин при клубе
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Склад и витрина —<br />
                как независимые балансы
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Главная боль магазинов — товар на складе есть, на витрине нет.
                У нас они учитываются раздельно. Касса бьёт только витрину.
                Перенос со склада — через заявку с резервом.
              </p>

              <div className="mt-6 grid gap-3">
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <Package className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div className="text-sm leading-6 text-slate-200">
                    <strong className="text-white">Приёмка с OCR</strong> — фото счёт-фактуры → импорт
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div className="text-sm leading-6 text-slate-200">
                    <strong className="text-white">POS-касса</strong> минималистичная для оператора
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div className="text-sm leading-6 text-slate-200">
                    <strong className="text-white">Ревизия</strong> с автоматическим расчётом недостач
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div className="text-sm leading-6 text-slate-200">
                    <strong className="text-white">ABC-анализ</strong> — что приносит деньги, что лежит
                  </div>
                </div>
              </div>
            </div>

            {/* Визуал: схема склад → заявка → витрина */}
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Поток товара в системе
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/15 text-blue-300">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Приёмка от поставщика</div>
                    <div className="text-xs text-slate-400">Фото счёта → AI парсит → +Склад</div>
                  </div>
                  <div className="text-xs text-emerald-300 tabular-nums">+50 шт</div>
                </div>
              </div>

              <div className="flex justify-center">
                <ArrowRight className="h-5 w-5 rotate-90 text-slate-600" />
              </div>

              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/15 text-amber-300">
                    <ArrowRight className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Заявка склад → витрина</div>
                    <div className="text-xs text-slate-400">С резервом, не раньше получения</div>
                  </div>
                  <div className="text-xs text-amber-300 tabular-nums">10 шт</div>
                </div>
              </div>

              <div className="flex justify-center">
                <ArrowRight className="h-5 w-5 rotate-90 text-slate-600" />
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
                    <Store className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Витрина</div>
                    <div className="text-xs text-slate-400">Касса бьёт только отсюда</div>
                  </div>
                  <div className="text-xs text-emerald-300 tabular-nums">10 шт</div>
                </div>
              </div>

              <div className="flex justify-center">
                <ArrowRight className="h-5 w-5 rotate-90 text-slate-600" />
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/15 text-rose-300">
                    <Receipt className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Продажа в кассе</div>
                    <div className="text-xs text-slate-400">−Витрина · в Z-отчёт смены</div>
                  </div>
                  <div className="text-xs text-rose-300 tabular-nums">−1 шт</div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ────────── СРАВНЕНИЕ ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Чем отличается
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            OrdaOps vs Excel, 1С и POS-системы
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Excel — слишком ручная. 1С — учёт без аналитики. POS — продажи без
            финансов. OrdaOps — финансовая платформа сделанная под клуб.
          </p>
        </div>

        <Card className="mt-8 overflow-hidden border-white/10 bg-black/20 p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="px-4 py-4 text-xs uppercase tracking-wide text-slate-400">
                    Решение
                  </th>
                  {competitorColumns.map((col) => (
                    <th key={col} className="px-3 py-4 text-center text-xs uppercase tracking-wide text-slate-400">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => (
                  <tr
                    key={c.name}
                    className={`border-b border-white/5 ${
                      c.highlight ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <td className={`px-4 py-3 ${c.highlight ? 'font-semibold text-amber-200' : 'text-slate-200'}`}>
                      {c.highlight && '★ '}
                      {c.name}
                    </td>
                    {c.cells.map((cell, i) => (
                      <td
                        key={i}
                        className={`px-3 py-3 text-center font-mono text-base ${
                          cell === '✓✓'
                            ? 'text-emerald-400'
                            : cell === '✓'
                              ? 'text-emerald-300/80'
                              : cell === '△'
                                ? 'text-amber-400/70'
                                : 'text-slate-600'
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/10 bg-black/30 px-4 py-3 text-xs text-slate-400">
            ✓✓ — глубоко встроено · ✓ — есть · △ — поверхностно или вручную · — нет
          </div>
        </Card>
      </section>

      {/* ────────── Аудитории ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="grid gap-6 md:grid-cols-3">
          {audiences.map((a) => {
            const Icon = a.icon
            return (
              <Card
                key={a.title}
                className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]"
              >
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-400/10 text-amber-200">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold">{a.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{a.text}</p>
              </Card>
            )
          })}
        </div>
      </section>

      {/* ────────── Цены ────────── */}
      <section id="pricing" className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Цены
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Прозрачно. Без «свяжитесь с менеджером»
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Первая точка — 2 недели бесплатно. После — выбираете план. Меняете
            план в любой момент. Ваши данные — ваши, забираете когда хотите.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {pricingPlans.map((plan) => (
            <Card
              key={plan.name}
              className={`relative p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] ${
                plan.highlight
                  ? 'border-amber-400/40 bg-[linear-gradient(180deg,rgba(245,158,11,0.12),rgba(255,255,255,0.04))] shadow-[0_24px_70px_rgba(245,158,11,0.18)]'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              {plan.badge && (
                <span className="absolute -top-3 right-5 rounded-full bg-amber-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-950">
                  {plan.badge}
                </span>
              )}
              <div className="text-sm font-semibold uppercase tracking-wide text-amber-200">
                {plan.name}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="text-sm text-slate-400">{plan.note}</span>
              </div>
              <ul className="mt-6 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm leading-6 text-slate-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className={`mt-6 w-full ${
                  plan.highlight
                    ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                    : 'bg-white/10 text-white hover:bg-white/15'
                }`}
              >
                <Link href="#contact">{plan.cta}</Link>
              </Button>
            </Card>
          ))}
        </div>

        <div className="mt-6 text-center text-xs text-slate-500">
          Все планы включают: бесплатные обновления · поддержка в Telegram · ежедневные бэкапы
        </div>
      </section>

      {/* ────────── До / После ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-rose-500/20 bg-rose-500/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-rose-200">
              Без OrdaOps
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Финансы — задним числом, на ощущениях
            </h2>
            <div className="mt-6 grid gap-3">
              {before.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                  <div className="text-sm leading-6 text-slate-300">{item}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-emerald-500/20 bg-emerald-500/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-200">
              С OrdaOps
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Цифры в реальном времени, AI объясняет
            </h2>
            <div className="mt-6 grid gap-3">
              {after.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div className="text-sm leading-6 text-slate-200">{item}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* ────────── Результат ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <Card className="border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(255,255,255,0.03))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
                <LineChart className="h-3.5 w-3.5" />
                Что меняется в работе
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
                После внедрения через 2 недели
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Вы перестаёте догадываться о цифрах и начинаете ими управлять.
              </p>
            </div>

            <div className="grid gap-3">
              {outcomes.map((o) => (
                <div
                  key={o}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="text-sm leading-6 text-slate-200">{o}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* ────────── FAQ ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Частые вопросы
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Что обычно спрашивают перед демо
          </h2>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {faqItems.map((item) => (
            <Card
              key={item.question}
              className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]"
            >
              <h3 className="text-lg font-semibold">{item.question}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">{item.answer}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── Контакт ────────── */}
      <section id="contact" className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
              Демо за 5 минут
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
              Покажу систему на вашем примере
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              15 минут — и вы поймёте, поможет ли OrdaOps вашему клубу. Покажу
              финансовый дашборд, AI-помощник, закрытие смены и Telegram-отчёты
              на реальных данных. Подскажу с переходом если используете другую систему.
            </p>

            <div className="mt-6 space-y-3 text-sm text-slate-300">
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>Подходит если есть точки, смены, операторы и хаос в финансах</div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>Опишите кратко вашу ситуацию и оставьте Telegram или телефон</div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>Свяжемся в течение часа в рабочее время</div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-8">
            <ContactLeadForm />
          </Card>
        </div>
      </section>

      {/* ────────── Финальный CTA ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 pb-20 sm:px-8 lg:px-10">
        <Card className="overflow-hidden border-amber-400/30 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(255,255,255,0.05))] p-10 text-white shadow-[0_24px_70px_rgba(245,158,11,0.18)] sm:p-12">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">
                Хотите видеть прибыль клуба сегодня вечером, а не 5-го числа?
              </h2>
              <p className="mt-3 text-base leading-7 text-slate-200">
                2 недели бесплатно. Без обязательств. Если не подойдёт — все ваши
                данные забираете в Excel.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Button asChild size="lg" className="bg-white text-slate-950 hover:bg-slate-100">
                <Link href="#contact">
                  Записаться на демо
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10"
              >
                <Link href="/login">Уже клиент → Войти</Link>
              </Button>
            </div>
          </div>
        </Card>
      </section>

      {/* ────────── Footer ────────── */}
      <footer className="border-t border-white/5 bg-black/30">
        <div className="mx-auto grid max-w-screen-2xl gap-8 px-6 py-12 sm:px-8 md:grid-cols-4 lg:px-10">
          <div>
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500 text-sm font-bold text-slate-950">◇</div>
              <span className="font-semibold">{SITE_NAME}</span>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Финансовая платформа для игровых клубов: ОПиУ, EBITDA, AI-помощник,
              смены, магазин и Telegram-отчёты.
            </p>
            <p className="mt-3 text-xs text-slate-500">🇰🇿 Сделано в Казахстане</p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">Продукт</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li><Link href="#pillars" className="hover:text-amber-200">Возможности</Link></li>
              <li><Link href="#pricing" className="hover:text-amber-200">Цены</Link></li>
              <li><Link href="/club-management-system" className="hover:text-amber-200">Для клубов</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">Компания</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li><Link href="#contact" className="hover:text-amber-200">Контакты</Link></li>
              <li><Link href="/login" className="hover:text-amber-200">Войти</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">Юридическое</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li><span className="text-slate-500">Оферта</span></li>
              <li><span className="text-slate-500">Политика конфиденциальности</span></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/5 px-6 py-6 text-center text-xs text-slate-500 sm:px-8 lg:px-10">
          © 2026 OrdaOps · Все права защищены
        </div>
      </footer>
    </main>
  )
}
