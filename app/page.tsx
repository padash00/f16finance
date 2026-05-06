import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Boxes,
  Brain,
  Building2,
  Check,
  CheckCircle2,
  Clock4,
  Coffee,
  Cpu,
  GanttChart,
  LineChart,
  PiggyBank,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ContactLeadForm } from '@/components/public/contact-lead-form'
import { FaqStructuredData, WebsiteStructuredData } from '@/components/public/structured-data'

export const metadata: Metadata = {
  title: 'Orda Control — финансовая управляемость бизнеса без Excel и хаоса',
  description:
    'Система для продаж, смен, склада, расходов, зарплат, Telegram-отчётов и AI-аналитики. Подходит магазинам, компьютерным клубам, кафе, сервисам, студиям и бизнесам с кассой, сотрудниками и товарным учётом.',
}

const PRODUCT = 'Orda Control'

// ─────────────────────── HERO ───────────────────────

const heroBadges = [
  '💰 Прибыль и маржа каждый день',
  '🤖 AI объясняет цифры',
  '⏰ Закрытие смен с авто-сверкой',
  '📦 Склад и витрина по полочкам',
  '📲 Отчёты в Telegram',
]

// ─────────────────────── ЧТО ТАКОЕ ─────────────────────

const usageModes = [
  {
    icon: BarChart3,
    title: 'Финансовая аналитика',
    text: 'Видеть выручку, расходы, прибыль, маржу, зарплаты и расхождения каждый день.',
  },
  {
    icon: ShoppingBag,
    title: 'Программа для продаж',
    text: 'Продавать товары, вести кассу, закрывать смены и контролировать остатки.',
  },
  {
    icon: ShieldCheck,
    title: 'Управленческий контроль',
    text: 'Понимать что происходит в бизнесе каждый день, а не только после отчёта бухгалтера.',
  },
]

// ─────────────────────── ПРОБЛЕМЫ ───────────────────────

const painPoints = [
  {
    icon: '💸',
    pain: 'Вижу прибыль только после закрытия месяца бухгалтером',
    solution:
      'Отчёт о прибылях и убытках, маржа и ключевые показатели обновляются автоматически после каждой смены, продажи или операции.',
  },
  {
    icon: '📉',
    pain: 'Маржа снизилась, но непонятно почему',
    solution:
      'AI анализирует показатели и показывает причину: выросла закупочная цена, увеличились расходы, снизилась наценка или просели продажи по категории.',
  },
  {
    icon: '🚪',
    pain: 'Смена закрылась с расхождением, но непонятно где ошибка',
    solution:
      'Система сверяет продажи, кассу, Kaspi, наличные и другие способы оплаты. Расхождения подсвечиваются автоматически.',
  },
  {
    icon: '👥',
    pain: 'Зарплата сотрудников превращается в споры и ручные пересчёты',
    solution:
      'Гибкие правила расчёта: ставка за смену, процент от выручки, KPI, бонусы и штрафы. Система считает выплаты автоматически.',
  },
  {
    icon: '💳',
    pain: 'Онлайн-платежи и терминал не сходятся с отчётами',
    solution:
      'Orda Control разделяет платежи по сменам, датам и способам оплаты — выручка корректно сходится с банковскими выписками.',
  },
  {
    icon: '📲',
    pain: 'Я не на месте, но хочу понимать что происходит сейчас',
    solution:
      'После каждой смены приходит Telegram-отчёт: выручка, расходы, расхождения, сотрудники, продажи и ключевые показатели.',
  },
  {
    icon: '📦',
    pain: 'Товар есть на складе, но его нет на витрине — продажи теряются',
    solution:
      'Склад и витрина ведутся как отдельные балансы. Заявки на пополнение, история движения товаров и контроль остатков.',
  },
  {
    icon: '🧾',
    pain: 'Не успеваю вручную проверять накладные и поступления',
    solution:
      'AI распознаёт фото счёта или накладной, находит товары в каталоге и автоматически добавляет их в приёмку.',
  },
]

// ─────────────────────── 4 СТОЛПА ───────────────────────

const pillars = [
  {
    icon: PiggyBank,
    title: 'Финансы бизнеса',
    subtitle: 'Каждый день, а не только в конце месяца',
    points: [
      'Отчёт о прибылях и убытках на основе продаж и расходов',
      'EBITDA, маржа и прибыль по точкам и по сети',
      'Раздельный учёт: наличные, Kaspi, онлайн, карта',
      'Сверка комиссий Kaspi с банковской выпиской',
      'Понятная картина: сколько бизнес заработал, а не просто продал',
    ],
  },
  {
    icon: Brain,
    title: 'AI-помощник',
    subtitle: 'Объясняет показатели простым языком',
    points: [
      'Анализирует выручку, расходы, маржу, сотрудников и склад',
      'Подсвечивает аномалии: например, недостача 8 200 ₸',
      'Объясняет тренды: что выросло и что снизилось',
      'Даёт рекомендации: где сэкономить и что усилить',
      'Распознаёт накладные и помогает добавлять товары в приёмку',
    ],
  },
  {
    icon: Clock4,
    title: 'Смены без хаоса',
    subtitle: 'Открытие, закрытие и Z-отчёт',
    points: [
      'Открытие смены со стартовой кассовой мелочью',
      'Автоматическая сверка продаж и кассы при закрытии',
      'Оборотные деньги учитываются отдельно',
      'Понятный Z-отчёт в формате кассового чека',
      'Telegram-уведомление с итогами после смены',
    ],
  },
  {
    icon: Boxes,
    title: 'Продажи, склад и витрина',
    subtitle: 'Товар, остатки, приёмка и ревизия',
    points: [
      'POS-продажи с автоматическим списанием товара',
      'Склад и витрина — независимые балансы',
      'Заявки со склада на витрину с резервированием',
      'Приёмка от поставщика с AI-распознаванием накладных',
      'Ревизия с автоматическим расчётом недостачи',
      'История каждого движения товара',
    ],
  },
]

// ─────────────────────── AI ПРИМЕРЫ ───────────────────────

const aiExamples = [
  {
    type: 'warning' as const,
    title: 'Аномалия в кассе',
    content:
      'Сегодня наличных в кассе на 8 200 ₸ меньше расчётной суммы по продажам. Возможные причины: ошибка кассира, незакрытый возврат или недостача. Рекомендуется проверить смену сотрудника за период 14:00–18:00.',
  },
  {
    type: 'insight' as const,
    title: 'Что снижает прибыль',
    content:
      'За последние 7 дней маржа снизилась на 3,2%. Главная причина — рост закупочной цены по одной из товарных категорий на 14%. Альтернативный поставщик предлагает цену на 11% ниже. Потенциальная экономия — около 42 000 ₸ в месяц.',
  },
  {
    type: 'opportunity' as const,
    title: 'Где есть потенциал роста',
    content:
      'Категория товаров даёт 18% выручки, занимая только 4% ассортимента. Топовые позиции продаются в среднем за 1,8 дня. Рекомендуется расширить ассортимент этой категории. Потенциальный рост выручки — 6–8%.',
  },
  {
    type: 'team' as const,
    title: 'Аналитика по сотрудникам',
    content:
      'Один из сотрудников показывает средний чек на 48% выше, чем остальные. Конверсия в дополнительные позиции также выше средней. Рекомендуется использовать его подход как пример для обучения команды.',
  },
]

// ─────────────────────── ДЛЯ КОГО ───────────────────────

const audiences = [
  {
    icon: ShoppingBag,
    title: 'Магазины',
    text: 'Продажи, касса, остатки, склад, витрина, расходы, смены и отчёты.',
  },
  {
    icon: Cpu,
    title: 'Компьютерные клубы',
    text: 'Смены, операторы, Kaspi, наличные, бар, склад, зарплаты, отчёты и контроль нескольких зон.',
    href: '/club-management-system',
  },
  {
    icon: Coffee,
    title: 'Кафе и точки еды',
    text: 'Продажи, закуп, списания, расходы, маржа, сотрудники и ежедневная выручка.',
  },
  {
    icon: Wrench,
    title: 'Сервисные центры',
    text: 'Клиенты, оплаты, расходы, материалы, сотрудники и управленческая аналитика.',
  },
  {
    icon: Sparkles,
    title: 'Студии услуг',
    text: 'Записи, оплаты, зарплаты специалистов, расходы и финансовые показатели.',
  },
  {
    icon: Truck,
    title: 'Склады и торговые точки',
    text: 'Остатки, перемещения, заявки, приёмка, продажи и контроль товара.',
  },
]

// ─────────────────────── СРАВНЕНИЕ ───────────────────────

const comparisons = [
  {
    name: 'Excel',
    text:
      'Подходит для простых таблиц, но быстро превращается в ручной хаос: ошибки, разные версии файлов, нет автоматических отчётов и контроля смен.',
    tone: 'muted' as const,
  },
  {
    name: '1С',
    text:
      'Мощная система для бухгалтерского и товарного учёта, но часто сложная, тяжёлая и требует настройки под каждую задачу.',
    tone: 'muted' as const,
  },
  {
    name: 'Poster / Wipon',
    text:
      'Хороши для продаж и отдельных ниш, но не всегда дают владельцу полную управленческую картину: прибыль, смены, расходы, зарплаты, AI-анализ и Telegram-контроль в одном месте.',
    tone: 'muted' as const,
  },
  {
    name: 'Orda Control',
    text:
      'Создан для ежедневного контроля бизнеса: продажи, смены, финансы, склад, зарплаты, Telegram-отчёты и AI-аналитика в одной системе.',
    tone: 'highlight' as const,
  },
]

// ─────────────────────── ТАРИФЫ ───────────────────────

const pricingPlans = [
  {
    name: 'Start',
    description: 'Для владельцев, которым нужно видеть основные финансовые показатели.',
    features: [
      'Финансовый дашборд',
      'Доходы и расходы',
      'Базовые показатели',
      'Отчёты по периодам',
      'Контроль прибыли и маржи',
    ],
    cta: 'Попробовать',
    highlight: false,
  },
  {
    name: 'Business',
    description: 'Для бизнеса, где есть сотрудники, смены и ежедневная операционная работа.',
    features: [
      'Всё из Start',
      'Закрытие смен',
      'Контроль расхождений',
      'Учёт сотрудников',
      'Расчёт зарплат',
      'Расширенная аналитика',
      'AI-анализ показателей',
    ],
    cta: 'Выбрать Business',
    highlight: true,
    badge: 'Популярный',
  },
  {
    name: 'Pro',
    description: 'Для бизнеса, которому нужна полноценная система продаж, склада и автоматизации.',
    features: [
      'Всё из Business',
      'POS / продажи',
      'Товары и категории',
      'Склад и витрина',
      'Перемещения товаров',
      'Заявки на пополнение',
      'Приёмка с AI-распознаванием',
      'Расширенный AI и интеграции',
    ],
    cta: 'Выбрать Pro',
    highlight: false,
  },
  {
    name: 'Enterprise',
    description: 'Для сетей, нескольких филиалов и бизнеса с индивидуальными процессами.',
    features: [
      'Несколько компаний и точек',
      'Роли и доступы',
      'Индивидуальная настройка',
      'Расширенные отчёты',
      'Интеграции',
      'Персональное внедрение',
    ],
    cta: 'Связаться',
    highlight: false,
  },
]

const addOns = [
  {
    icon: '📲',
    title: 'Telegram-отчёты',
    text:
      'Подключаются отдельно. Отчёты по сменам, продажам, расходам, зарплатам и расхождениям приходят в Telegram.',
  },
  {
    icon: '🤖',
    title: 'AI-аналитика',
    text:
      'Доступна начиная со средних тарифов. Помогает искать причины проблем в цифрах, а не просто показывает графики.',
  },
  {
    icon: '🛍',
    title: 'Модуль магазина',
    text:
      'Подключается, если хотите использовать Orda Control как программу для продаж: товары, остатки, касса, склад, витрина и приёмка.',
  },
]

// ─────────────────────── FAQ ───────────────────────

const faqItems = [
  {
    question: `Чем ${PRODUCT} отличается от 1С?`,
    answer:
      `1С — учётная система для бухгалтерии и товара. ${PRODUCT} — операционно-финансовая платформа: смены, касса, AI-аналитика, Telegram-отчёты. Главное отличие — вы видите финансы каждый день в реальном времени с понятными объяснениями, а не закрываете месяц задним числом.`,
  },
  {
    question: 'А если я уже использую Wipon или Poster?',
    answer:
      `Они хороши как POS, но не дают управленческую картину уровня владельца. С нами можно работать в дополнение: касса остаётся в Wipon, а закрытие смен и финансы — в ${PRODUCT}. Или полностью перейти — поможем с миграцией каталога.`,
  },
  {
    question: 'AI правда работает или это маркетинг?',
    answer:
      'AI видит ваши данные: выручка, расходы, маржа, сотрудники, склад. Прогнозирует, объясняет тренды, находит аномалии. Не «пишет тексты» — анализирует цифры и даёт конкретные рекомендации с числами.',
  },
  {
    question: 'Что нужно установить?',
    answer:
      `На кассовом компьютере (Windows) — наше приложение для продаж. На вашем телефоне или ноутбуке — ничего, веб-кабинет открывается в браузере. Своих серверов и баз данных у вас не должно быть — ${PRODUCT} полностью облачный.`,
  },
  {
    question: 'Работает без интернета?',
    answer:
      'Кассовая программа — да. Сохраняет операции локально и синхронизируется когда сеть вернётся. Веб-кабинет требует интернет, но дашборд кэшируется на сутки.',
  },
  {
    question: 'Кто видит мои финансовые данные?',
    answer:
      'Только вы и те, кому вы дали доступ. Данные каждой компании изолированы от других — даже на уровне базы. Защита прав на каждый запрос. Все действия записываются в журнал аудита.',
  },
  {
    question: 'Есть ли пробный период?',
    answer:
      'Первая точка — 2 недели бесплатно с полным доступом ко всем функциям. Если не подойдёт — все ваши данные можно выгрузить в Excel и забрать с собой. Без обязательств.',
  },
  {
    question: 'Подходит ли только для компьютерных клубов?',
    answer:
      `Нет, ${PRODUCT} — универсальная система. Подходит магазинам, кафе, сервисным центрам, студиям, складам и любому бизнесу с кассой, сотрудниками и товарным учётом. Для компьютерных клубов есть отдельная версия с операторами, ночными сменами и контролем зон.`,
  },
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
              <div className="text-lg font-semibold">{PRODUCT}</div>
              <div className="text-xs text-slate-400">Финансы, продажи и смены бизнеса</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden sm:inline-flex text-slate-200">
              <Link href="#features">Возможности</Link>
            </Button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex text-slate-200">
              <Link href="#pricing">Тарифы</Link>
            </Button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild className="bg-amber-500 text-slate-950 hover:bg-amber-400">
              <Link href="#contact">
                Попробовать
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ────────── 1. HERO ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
              <Sparkles className="h-3.5 w-3.5" />
              Финансовая управляемость для бизнеса
            </div>

            <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              {PRODUCT} — финансовая управляемость бизнеса
              <span className="block bg-gradient-to-r from-amber-300 via-orange-300 to-amber-100 bg-clip-text text-transparent">
                без Excel, хаоса и ручных пересчётов
              </span>
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-slate-300">
              Система для продаж, смен, склада, расходов, зарплат, Telegram-отчётов и AI-аналитики.
              Подходит магазинам, компьютерным клубам, кафе, сервисам, студиям и бизнесам с кассой,
              сотрудниками и товарным учётом.
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
                  Попробовать {PRODUCT}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                <Link href="#features">Посмотреть возможности</Link>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
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
                Помощь с внедрением
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

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric label="Выручка за день" value="412 800" unit="₸" delta="+8%" trend="up" />
                <Metric label="Маржа" value="38%" delta="-1.4%" trend="down" />
                <Metric label="Прибыль за месяц" value="1 960 000" unit="₸" delta="+12%" trend="up" />
                <Metric label="ФОТ" value="540 000" unit="₸" delta="0%" trend="flat" />
              </div>

              <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
                  <Bot className="h-3.5 w-3.5" />
                  AI-наблюдение · сейчас
                </div>
                <div className="mt-2 text-xs leading-5 text-amber-50/90">
                  Маржа снизилась на 1,4% за неделю. Причина — рост закупочной цены по категории
                  «напитки» на 14%. Альтернативный поставщик предлагает на 11% ниже — экономия около 42 000 ₸/мес.
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">📲 Telegram-отчёт после смены</div>
                <div className="mt-1 text-xs leading-5 text-slate-300">
                  <span className="font-semibold text-white">Точка №1 · Дневная смена</span>
                  <br />
                  Онлайн: 194 025 ₸ · Наличные: 26 000 ₸ · Возвраты: 600 ₸
                  <br />
                  <span className="text-emerald-300">✓ Расхождений нет</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ────────── 2. ЧТО ТАКОЕ ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Что такое {PRODUCT}
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Система для контроля денег, продаж и операционной работы
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            {PRODUCT} можно использовать тремя способами — выберите тот, что нужен бизнесу. Подключаются вместе или по отдельности.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {usageModes.map((mode) => {
            const Icon = mode.icon
            return (
              <Card
                key={mode.title}
                className="border-white/10 bg-white/5 p-7 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]"
              >
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-400/10 text-amber-200">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">{mode.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{mode.text}</p>
              </Card>
            )
          })}
        </div>
      </section>

      {/* ────────── 3. ПРОБЛЕМЫ ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Знакомая ситуация?
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Что чаще всего мешает владельцу бизнеса видеть реальные деньги
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Под каждой проблемой — конкретное решение. Без лишнего маркетинга, только по делу.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {painPoints.map((p) => (
            <Card
              key={p.pain}
              className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] transition hover:border-amber-400/30"
            >
              <div className="text-3xl">{p.icon}</div>
              <h3 className="mt-3 text-base font-semibold leading-snug">{p.pain}</h3>
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <div className="text-xs leading-5 text-emerald-100/90">{p.solution}</div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── 4. ЧЕТЫРЕ СТОЛПА ────────── */}
      <section id="features" className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Что внутри {PRODUCT}
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Финансы. AI. Смены. Продажи.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Не набор функций ради продажи, а четыре ключевых блока, которые меняют управление бизнесом.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((pillar) => {
            const Icon = pillar.icon
            return (
              <Card
                key={pillar.title}
                className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)] sm:p-7"
              >
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-400/10 text-amber-200">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">{pillar.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{pillar.subtitle}</p>
                <ul className="mt-5 space-y-2.5 border-t border-white/10 pt-5">
                  {pillar.points.map((point) => (
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

      {/* ────────── 5. AI ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <Card className="overflow-hidden border-amber-400/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(255,255,255,0.03))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
                <Bot className="h-3.5 w-3.5" />
                AI-помощник
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                AI, который работает с цифрами,
                <br />
                а не с красивыми текстами
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                AI анализирует выручку, расходы, работу сотрудников и складские данные.
                Находит аномалии, объясняет тренды и предлагает конкретные действия на основе цифр.
              </p>

              <div className="mt-6 space-y-3">
                <AICapability icon={LineChart} title="Финансовая аналитика" text="Почему снизилась маржа и где теряются деньги" />
                <AICapability icon={Activity} title="Прогноз выручки на 90 дней" text="С подсветкой аномалий и ожидаемых отклонений" />
                <AICapability icon={Receipt} title="AI-распознавание накладных" text="Фото счёта автоматически попадает в приёмку" />
                <AICapability icon={Users} title="Анализ сотрудников" text="Средний чек, продажи, смены, эффективность" />
                <AICapability icon={GanttChart} title="Рекомендации" text="По закупу, расходам, остаткам и прибыльности" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Реальные подсказки, которые выдаёт AI
              </div>
              {aiExamples.map((ex) => {
                const colors = {
                  warning: { border: 'border-rose-500/30', bg: 'bg-rose-500/5', label: 'text-rose-200', Icon: AlertTriangle },
                  insight: { border: 'border-amber-400/30', bg: 'bg-amber-400/5', label: 'text-amber-200', Icon: Brain },
                  opportunity: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', label: 'text-emerald-200', Icon: Sparkles },
                  team: { border: 'border-sky-400/30', bg: 'bg-sky-400/5', label: 'text-sky-200', Icon: Users },
                }[ex.type]
                const Icon = colors.Icon
                return (
                  <div key={ex.title} className={`rounded-2xl border ${colors.border} ${colors.bg} p-4`}>
                    <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${colors.label}`}>
                      <Icon className="h-3.5 w-3.5" />
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

      {/* ────────── 6. ДЛЯ КОГО ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Для кого подходит
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Для бизнеса, где есть деньги, касса, сотрудники и товары
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            {PRODUCT} подстраивается под формат бизнеса — от одной точки до сети филиалов.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {audiences.map((aud) => {
            const Icon = aud.icon
            const Wrapper: any = aud.href ? Link : 'div'
            const wrapperProps = aud.href ? { href: aud.href } : {}
            return (
              <Wrapper key={aud.title} {...wrapperProps}>
                <Card
                  className={`group border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] transition ${
                    aud.href ? 'cursor-pointer hover:border-amber-400/30 hover:bg-white/10' : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-400/10 text-amber-200">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold">{aud.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{aud.text}</p>
                      {aud.href ? (
                        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-amber-300 transition group-hover:gap-2">
                          Подробнее <ArrowRight className="h-3 w-3" />
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </Wrapper>
            )
          })}
        </div>
      </section>

      {/* ────────── 7. СРАВНЕНИЕ ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Сравнение
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            {PRODUCT} заменяет хаос из разных программ
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Вместо того чтобы вести бизнес одновременно в Excel, мессенджерах, кассовой программе,
            складской таблице и заметках сотрудника — {PRODUCT} собирает всё в одной системе.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {comparisons.map((item) => (
            <Card
              key={item.name}
              className={
                item.tone === 'highlight'
                  ? 'border-amber-400/40 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(245,158,11,0.04))] p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.32)]'
                  : 'border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.18)]'
              }
            >
              <div className="flex items-center gap-2">
                <h3
                  className={`text-lg font-semibold ${
                    item.tone === 'highlight' ? 'text-amber-100' : 'text-white'
                  }`}
                >
                  {item.name}
                </h3>
                {item.tone === 'highlight' ? (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                    Выбор владельца
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{item.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── 8. ТАРИФЫ ────────── */}
      <section id="pricing" className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Тарифы
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Подключайте только то, что нужно бизнесу
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            От базовых финансовых показателей до полноценной системы продаж и сетевого учёта.
            Тариф можно менять по мере роста бизнеса.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pricingPlans.map((plan) => (
            <Card
              key={plan.name}
              className={
                plan.highlight
                  ? 'relative border-amber-400/40 bg-[linear-gradient(180deg,rgba(245,158,11,0.16),rgba(245,158,11,0.04))] p-7 text-white shadow-[0_28px_70px_rgba(0,0,0,0.34)]'
                  : 'border-white/10 bg-white/5 p-7 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]'
              }
            >
              {plan.highlight && plan.badge ? (
                <span className="absolute right-5 top-5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
                  {plan.badge}
                </span>
              ) : null}
              <div className="text-2xl font-semibold tracking-[-0.02em]">{plan.name}</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">{plan.description}</p>
              <ul className="mt-5 space-y-2.5 border-t border-white/10 pt-5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm leading-6 text-slate-200">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className={
                  plan.highlight
                    ? 'mt-6 w-full bg-amber-500 text-slate-950 hover:bg-amber-400'
                    : 'mt-6 w-full bg-white/10 text-white hover:bg-white/15'
                }
              >
                <Link href="#contact">{plan.cta}</Link>
              </Button>
            </Card>
          ))}
        </div>

        {/* Дополнительные модули */}
        <div className="mt-10">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Дополнительные модули
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {addOns.map((addon) => (
              <Card
                key={addon.title}
                className="border-white/10 bg-white/5 p-5 text-white shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
              >
                <div className="text-2xl">{addon.icon}</div>
                <h3 className="mt-2 text-base font-semibold">{addon.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{addon.text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ────────── 9. ОТДЕЛЬНАЯ СТРАНИЦА ДЛЯ КЛУБОВ ────────── */}
      <section className="mx-auto max-w-screen-2xl px-6 py-16 sm:px-8 lg:px-10">
        <Card className="border-fuchsia-500/20 bg-[linear-gradient(135deg,rgba(168,85,247,0.10),rgba(255,255,255,0.03))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.32)] sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-fuchsia-200">
                <Cpu className="h-3.5 w-3.5" />
                Версия для компьютерных клубов
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Управляете компьютерным клубом?
              </h2>
              <p className="mt-3 text-base leading-7 text-slate-300">
                Для клубов есть отдельная версия со специфическими функциями: операторы, ночные смены,
                учёт нескольких зон, бар при клубе, Kaspi с раздельным учётом до и после полуночи и
                Telegram-отчёты для владельца.
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="bg-fuchsia-500 text-white hover:bg-fuchsia-400 lg:self-center"
            >
              <Link href="/club-management-system">
                Открыть страницу клубов
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
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
            Что владельцы спрашивают чаще всего
          </h2>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {faqItems.map((item) => (
            <Card
              key={item.question}
              className="border-white/10 bg-white/5 p-5 text-white shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
            >
              <h3 className="text-base font-semibold leading-snug">{item.question}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{item.answer}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── 10. ФИНАЛЬНЫЙ CTA ────────── */}
      <section
        id="contact"
        className="mx-auto max-w-screen-2xl px-6 pb-20 pt-16 sm:px-8 lg:px-10"
      >
        <Card className="border-amber-400/30 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(255,255,255,0.04))] p-8 text-white shadow-[0_28px_80px_rgba(0,0,0,0.36)] sm:p-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
                <Sparkles className="h-3.5 w-3.5" />
                Начните сегодня
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Начните видеть реальные деньги бизнеса каждый день
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-200/90">
                {PRODUCT} помогает контролировать продажи, смены, расходы, склад, зарплаты и прибыль
                в одной системе. Оставьте контакты — покажем как это работает на ваших данных.
              </p>

              <div className="mt-6 space-y-3">
                <CTAFeature icon={Wallet} text="Прибыль и маржа в реальном времени" />
                <CTAFeature icon={Bot} text="AI объясняет цифры простым языком" />
                <CTAFeature icon={Building2} text="Несколько точек на одной системе" />
                <CTAFeature icon={ShieldCheck} text="Данные изолированы, журнал аудита, бэкапы" />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-6 sm:p-7">
              <ContactLeadForm
                title="Получить консультацию"
                subtitle="Покажем как Orda Control работает на ваших данных и подскажем тариф"
              />
            </div>
          </div>
        </Card>
      </section>

      {/* ────────── ФУТЕР ────────── */}
      <footer className="mx-auto max-w-screen-2xl px-6 pb-12 sm:px-8 lg:px-10">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-6 py-6 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-base font-bold text-slate-950">
                ◇
              </div>
              <div>
                <div className="text-base font-semibold">{PRODUCT}</div>
                <div className="text-xs text-slate-400">© 2026 — все права защищены</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
              <Link href="/offer" className="transition hover:text-amber-300">
                Договор оферты
              </Link>
              <Link href="/privacy" className="transition hover:text-amber-300">
                Политика конфиденциальности
              </Link>
              <Link href="/club-management-system" className="transition hover:text-amber-300">
                Для компьютерных клубов
              </Link>
              <Link href="/login" className="transition hover:text-amber-300">
                Войти в кабинет
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}

// ─────────────────────── ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ───────────────────────

function Metric({
  label,
  value,
  unit,
  delta,
  trend,
}: {
  label: string
  value: string
  unit?: string
  delta: string
  trend: 'up' | 'down' | 'flat'
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {unit ? <span className="text-xs text-slate-500">{unit}</span> : null}
      </div>
      <div
        className={`mt-1 text-[10px] ${
          trend === 'up'
            ? 'text-emerald-300'
            : trend === 'down'
              ? 'text-rose-300'
              : 'text-slate-400'
        }`}
      >
        {delta} к среднему
      </div>
    </div>
  )
}

function AICapability({
  icon: Icon,
  title,
  text,
}: {
  icon: any
  title: string
  text: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
      <div className="text-sm leading-6 text-slate-200">
        <strong className="text-white">{title}</strong> — {text}
      </div>
    </div>
  )
}

function CTAFeature({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
      <div className="text-sm leading-6 text-slate-200">{text}</div>
    </div>
  )
}
