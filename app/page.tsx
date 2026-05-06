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

// ─────────────────────── DESIGN TOKENS (CLASSES) ───────────────────────
// Применяем premium B2B SaaS design system:
// - Заголовки: Manrope (font-display)
// - Текст/UI: Inter (font-sans, по умолчанию)
// - Палитра: глубокий тёмно-синий + amber/orange основной + teal вторичный
// - Радиусы: cards 24px, buttons 18px, chips 14px
// - Воздух: section py 96-120px

const eyebrowClass =
  'inline-flex items-center gap-2 rounded-full border border-[var(--color-accent-gold)]/25 bg-[var(--color-accent-gold)]/10 px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent-gold)]'

const h1Class =
  'font-display text-[44px] font-extrabold leading-[1.02] tracking-[-0.04em] text-[var(--color-text-primary)] sm:text-[56px] lg:text-[72px]'

const h2Class =
  'font-display text-[34px] font-bold leading-[1.06] tracking-[-0.03em] text-[var(--color-text-primary)] sm:text-[44px] lg:text-[48px]'

const leadClass =
  'text-[18px] leading-[1.6] text-[var(--color-text-secondary)] sm:text-[20px] lg:text-[22px]'

const sectionClass = 'mx-auto max-w-[1320px] px-6 py-20 sm:px-10 lg:py-28 lg:px-12'

// ─────────────────────── HERO ───────────────────────

const heroBadges = [
  'Прибыль и маржа каждый день',
  'AI объясняет цифры',
  'Закрытие смен с авто-сверкой',
  'Склад и витрина по полочкам',
  'Отчёты в Telegram',
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
    pain: 'Вижу прибыль только после закрытия месяца бухгалтером',
    solution:
      'Отчёт о прибылях и убытках, маржа и ключевые показатели обновляются автоматически после каждой смены, продажи или операции.',
  },
  {
    pain: 'Маржа снизилась, но непонятно почему',
    solution:
      'AI анализирует показатели и показывает причину: выросла закупочная цена, увеличились расходы, снизилась наценка или просели продажи по категории.',
  },
  {
    pain: 'Смена закрылась с расхождением, но непонятно где ошибка',
    solution:
      'Система сверяет продажи, кассу, Kaspi, наличные и другие способы оплаты. Расхождения подсвечиваются автоматически.',
  },
  {
    pain: 'Зарплата сотрудников превращается в споры и ручные пересчёты',
    solution:
      'Гибкие правила расчёта: ставка за смену, процент от выручки, KPI, бонусы и штрафы. Система считает выплаты автоматически.',
  },
  {
    pain: 'Онлайн-платежи и терминал не сходятся с отчётами',
    solution:
      'Orda Control разделяет платежи по сменам, датам и способам оплаты — выручка корректно сходится с банковскими выписками.',
  },
  {
    pain: 'Я не на месте, но хочу понимать что происходит сейчас',
    solution:
      'После каждой смены приходит Telegram-отчёт: выручка, расходы, расхождения, сотрудники, продажи и ключевые показатели.',
  },
  {
    pain: 'Товар есть на складе, но его нет на витрине — продажи теряются',
    solution:
      'Склад и витрина ведутся как отдельные балансы. Заявки на пополнение, история движения товаров и контроль остатков.',
  },
  {
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
    title: 'Telegram-отчёты',
    text:
      'Подключаются отдельно. Отчёты по сменам, продажам, расходам, зарплатам и расхождениям приходят в Telegram.',
  },
  {
    title: 'AI-аналитика',
    text:
      'Доступна начиная со средних тарифов. Помогает искать причины проблем в цифрах, а не просто показывает графики.',
  },
  {
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,156,87,0.10),transparent_28%),linear-gradient(180deg,#050a14_0%,#07101d_55%,#050a14_100%)] text-[var(--color-text-primary)]">
      <WebsiteStructuredData />
      <FaqStructuredData faq={faqItems} />

      {/* ────────── Шапка ────────── */}
      <header className="mx-auto max-w-[1320px] px-6 pb-8 pt-8 sm:px-10 lg:px-12">
        <div className="flex items-center justify-between rounded-[20px] border border-white/[0.08] bg-[#0d1626]/70 px-6 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[14px] bg-gradient-to-br from-[#ffb25c] to-[#ff7b4d] text-base font-bold text-[#0a0f18]">
              ◇
            </div>
            <div>
              <div className="font-display text-[18px] font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
                {PRODUCT}
              </div>
              <div className="text-[12px] font-medium text-[var(--color-text-muted)]">
                Финансы, продажи и смены
              </div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" className="hidden rounded-[12px] text-[15px] font-medium text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-white sm:inline-flex">
              <Link href="#features">Возможности</Link>
            </Button>
            <Button asChild variant="ghost" className="hidden rounded-[12px] text-[15px] font-medium text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-white sm:inline-flex">
              <Link href="#pricing">Тарифы</Link>
            </Button>
            <Button asChild variant="ghost" className="hidden rounded-[12px] text-[15px] font-medium text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-white sm:inline-flex">
              <Link href="/login">Войти</Link>
            </Button>
            <Button
              asChild
              className="rounded-[14px] bg-gradient-to-br from-[#ffb25c] to-[#ff7b4d] px-5 py-2.5 text-[15px] font-semibold text-[#0a0f18] shadow-[0_8px_24px_rgba(255,140,70,0.22)] hover:from-[#ffbe6e] hover:to-[#ff8a5c]"
            >
              <Link href="#contact">
                Попробовать
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* ────────── 1. HERO ────────── */}
      <section className="mx-auto max-w-[1320px] px-6 pb-24 pt-8 sm:px-10 lg:pb-32 lg:pt-12 lg:px-12">
        <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="space-y-8 max-w-[680px]">
            <div className={eyebrowClass}>
              <Sparkles className="h-3.5 w-3.5" />
              Финансовая управляемость для бизнеса
            </div>

            <h1 className={h1Class}>
              {PRODUCT} — финансовая управляемость бизнеса{' '}
              <span className="bg-gradient-to-br from-[#ffb25c] via-[#ff9c57] to-[#ff7b4d] bg-clip-text text-transparent">
                без Excel, хаоса и ручных пересчётов
              </span>
            </h1>

            <p className={`${leadClass} max-w-[620px]`}>
              Система для продаж, смен, склада, расходов, зарплат, Telegram-отчётов и AI-аналитики.
              Подходит магазинам, компьютерным клубам, кафе, сервисам, студиям и бизнесам с кассой,
              сотрудниками и товарным учётом.
            </p>

            <div className="flex flex-wrap gap-2.5">
              {heroBadges.map((b) => (
                <span
                  key={b}
                  className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[15px] font-medium text-[var(--color-text-soft)]"
                >
                  {b}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                asChild
                size="lg"
                className="rounded-[18px] bg-gradient-to-br from-[#ffb25c] to-[#ff7b4d] px-7 py-[18px] text-[18px] font-semibold text-[#0a0f18] shadow-[0_10px_30px_rgba(255,140,70,0.22)] transition hover:from-[#ffbe6e] hover:to-[#ff8a5c] hover:shadow-[0_12px_36px_rgba(255,140,70,0.32)]"
              >
                <Link href="#contact">
                  Попробовать {PRODUCT}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-[18px] border-white/[0.08] bg-white/[0.03] px-7 py-[18px] text-[18px] font-medium text-[var(--color-text-primary)] hover:bg-white/[0.06]"
              >
                <Link href="#features">Посмотреть возможности</Link>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-[14px] font-medium text-[var(--color-text-muted)]">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-[var(--color-accent-teal)]" />
                Без обязательств
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-[var(--color-accent-teal)]" />
                Данные ваши, можно забрать
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-[var(--color-accent-teal)]" />
                Помощь с внедрением
              </div>
            </div>
          </div>

          {/* Визуал справа: финансовый дашборд */}
          <Card className="overflow-hidden rounded-[24px] border-white/[0.08] bg-[#0d1626]/80 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.40)]">
            <div className="rounded-[20px] border border-white/[0.06] bg-[#101b2e] p-5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Финансовый дашборд
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-accent-teal)]/30 bg-[var(--color-accent-teal)]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent-teal)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-teal)]" />
                  live
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <Metric label="Выручка за день" value="412 800" unit="₸" delta="+8%" trend="up" />
                <Metric label="Маржа" value="38%" delta="-1.4%" trend="down" />
                <Metric label="Прибыль за месяц" value="1 960 000" unit="₸" delta="+12%" trend="up" />
                <Metric label="ФОТ" value="540 000" unit="₸" delta="0%" trend="flat" />
              </div>

              <div className="mt-4 rounded-[16px] border border-[var(--color-accent-gold)]/25 bg-[var(--color-accent-gold)]/[0.07] p-4">
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent-gold)]">
                  <Bot className="h-4 w-4" />
                  AI-наблюдение · сейчас
                </div>
                <div className="mt-2.5 text-[14px] leading-[1.55] text-[var(--color-text-secondary)]">
                  Маржа снизилась на 1,4% за неделю. Причина — рост закупочной цены по категории
                  «напитки» на 14%. Альтернативный поставщик предлагает на 11% ниже —
                  экономия около 42 000 ₸/мес.
                </div>
              </div>

              <div className="mt-3 rounded-[16px] border border-white/[0.06] bg-black/30 p-4">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                  Telegram-отчёт после смены
                </div>
                <div className="mt-1.5 text-[14px] leading-[1.55] text-[var(--color-text-secondary)]">
                  <span className="font-semibold text-[var(--color-text-primary)]">Точка №1 · Дневная смена</span>
                  <br />
                  Онлайн: 194 025 ₸ · Наличные: 26 000 ₸ · Возвраты: 600 ₸
                  <br />
                  <span className="text-[var(--color-accent-success)]">✓ Расхождений нет</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ────────── 2. ЧТО ТАКОЕ ────────── */}
      <section className={sectionClass}>
        <div className="max-w-[720px]">
          <div className={eyebrowClass}>Что такое {PRODUCT}</div>
          <h2 className={`mt-5 ${h2Class}`}>
            Система для контроля денег, продаж и операционной работы
          </h2>
          <p className={`mt-5 ${leadClass}`}>
            {PRODUCT} можно использовать тремя способами — выберите тот, что нужен бизнесу.
            Подключаются вместе или по отдельности.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {usageModes.map((mode) => {
            const Icon = mode.icon
            return (
              <Card
                key={mode.title}
                className="rounded-[24px] border-white/[0.08] bg-[#0d1626]/70 p-8 shadow-[0_18px_48px_rgba(0,0,0,0.20)]"
              >
                <div className="grid h-12 w-12 place-items-center rounded-[16px] bg-[var(--color-accent-gold)]/10 text-[var(--color-accent-gold)]">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-6 font-display text-[22px] font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
                  {mode.title}
                </h3>
                <p className="mt-3 text-[15px] leading-[1.6] text-[var(--color-text-secondary)]">
                  {mode.text}
                </p>
              </Card>
            )
          })}
        </div>
      </section>

      {/* ────────── 3. ПРОБЛЕМЫ ────────── */}
      <section className={sectionClass}>
        <div className="max-w-[720px]">
          <div className={eyebrowClass}>Знакомая ситуация?</div>
          <h2 className={`mt-5 ${h2Class}`}>
            Что чаще всего мешает владельцу бизнеса видеть реальные деньги
          </h2>
          <p className={`mt-5 ${leadClass}`}>
            Под каждой проблемой — конкретное решение. Без лишнего маркетинга, только по делу.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {painPoints.map((p) => (
            <Card
              key={p.pain}
              className="group rounded-[24px] border-white/[0.08] bg-[#0d1626]/60 p-7 shadow-[0_18px_48px_rgba(0,0,0,0.18)] transition hover:border-[var(--color-accent-gold)]/30 hover:bg-[#101b2e]/80"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[var(--color-accent-negative)]/10 text-[var(--color-accent-negative)]">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <h3 className="mt-4 font-display text-[17px] font-bold leading-[1.3] tracking-[-0.01em] text-[var(--color-text-primary)]">
                {p.pain}
              </h3>
              <div className="mt-5 flex items-start gap-2.5 rounded-[14px] border border-[var(--color-accent-teal)]/20 bg-[var(--color-accent-teal)]/[0.06] p-3.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-teal)]" />
                <div className="text-[13px] leading-[1.55] text-[var(--color-text-secondary)]">{p.solution}</div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── 4. ЧЕТЫРЕ СТОЛПА ────────── */}
      <section id="features" className={sectionClass}>
        <div className="max-w-[720px]">
          <div className={eyebrowClass}>Что внутри {PRODUCT}</div>
          <h2 className={`mt-5 ${h2Class}`}>
            Финансы. AI. Смены. Продажи.
          </h2>
          <p className={`mt-5 ${leadClass}`}>
            Не набор функций ради продажи, а четыре ключевых блока, которые меняют управление бизнесом.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((pillar) => {
            const Icon = pillar.icon
            return (
              <Card
                key={pillar.title}
                className="rounded-[24px] border-white/[0.08] bg-[#0d1626]/70 p-8 shadow-[0_18px_48px_rgba(0,0,0,0.22)]"
              >
                <div className="grid h-12 w-12 place-items-center rounded-[16px] bg-[var(--color-accent-gold)]/10 text-[var(--color-accent-gold)]">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-6 font-display text-[22px] font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
                  {pillar.title}
                </h3>
                <p className="mt-1.5 text-[14px] leading-[1.45] text-[var(--color-text-muted)]">
                  {pillar.subtitle}
                </p>
                <ul className="mt-6 space-y-3 border-t border-white/[0.06] pt-6">
                  {pillar.points.map((point) => (
                    <li
                      key={point}
                      className="flex items-start gap-2.5 text-[14px] leading-[1.55] text-[var(--color-text-secondary)]"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-gold)]" />
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
      <section className={sectionClass}>
        <Card className="overflow-hidden rounded-[28px] border-[var(--color-accent-gold)]/20 bg-[linear-gradient(135deg,rgba(245,184,75,0.10),rgba(13,22,38,0.6))] p-10 shadow-[0_30px_80px_rgba(0,0,0,0.36)] sm:p-12">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <div className={eyebrowClass}>
                <Bot className="h-3.5 w-3.5" />
                AI-помощник
              </div>
              <h2 className={`mt-5 ${h2Class}`}>
                AI, который работает с цифрами,
                <br />
                а не с красивыми текстами
              </h2>
              <p className={`mt-5 ${leadClass}`}>
                AI анализирует выручку, расходы, работу сотрудников и складские данные.
                Находит аномалии, объясняет тренды и предлагает конкретные действия на основе цифр.
              </p>

              <div className="mt-8 space-y-3">
                <AICapability icon={LineChart} title="Финансовая аналитика" text="Почему снизилась маржа и где теряются деньги" />
                <AICapability icon={Activity} title="Прогноз выручки на 90 дней" text="С подсветкой аномалий и ожидаемых отклонений" />
                <AICapability icon={Receipt} title="AI-распознавание накладных" text="Фото счёта автоматически попадает в приёмку" />
                <AICapability icon={Users} title="Анализ сотрудников" text="Средний чек, продажи, смены, эффективность" />
                <AICapability icon={GanttChart} title="Рекомендации" text="По закупу, расходам, остаткам и прибыльности" />
              </div>
            </div>

            <div className="space-y-3.5">
              <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                Реальные подсказки, которые выдаёт AI
              </div>
              {aiExamples.map((ex) => {
                const colors = {
                  warning: { border: 'border-[var(--color-accent-negative)]/30', bg: 'bg-[var(--color-accent-negative)]/[0.06]', label: 'text-[var(--color-accent-negative)]', Icon: AlertTriangle },
                  insight: { border: 'border-[var(--color-accent-gold)]/30', bg: 'bg-[var(--color-accent-gold)]/[0.06]', label: 'text-[var(--color-accent-gold)]', Icon: Brain },
                  opportunity: { border: 'border-[var(--color-accent-teal)]/30', bg: 'bg-[var(--color-accent-teal)]/[0.06]', label: 'text-[var(--color-accent-teal)]', Icon: Sparkles },
                  team: { border: 'border-[#7da9ff]/30', bg: 'bg-[#7da9ff]/[0.06]', label: 'text-[#7da9ff]', Icon: Users },
                }[ex.type]
                const Icon = colors.Icon
                return (
                  <div key={ex.title} className={`rounded-[20px] border ${colors.border} ${colors.bg} p-5`}>
                    <div className={`flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${colors.label}`}>
                      <Icon className="h-4 w-4" />
                      {ex.title}
                    </div>
                    <p className="mt-2.5 text-[15px] leading-[1.6] text-[var(--color-text-secondary)]">
                      {ex.content}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      </section>

      {/* ────────── 6. ДЛЯ КОГО ────────── */}
      <section className={sectionClass}>
        <div className="max-w-[720px]">
          <div className={eyebrowClass}>Для кого подходит</div>
          <h2 className={`mt-5 ${h2Class}`}>
            Для бизнеса, где есть деньги, касса, сотрудники и товары
          </h2>
          <p className={`mt-5 ${leadClass}`}>
            {PRODUCT} подстраивается под формат бизнеса — от одной точки до сети филиалов.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {audiences.map((aud) => {
            const Icon = aud.icon
            const Wrapper: any = aud.href ? Link : 'div'
            const wrapperProps = aud.href ? { href: aud.href } : {}
            return (
              <Wrapper key={aud.title} {...wrapperProps}>
                <Card
                  className={`group rounded-[24px] border-white/[0.08] bg-[#0d1626]/60 p-7 shadow-[0_18px_48px_rgba(0,0,0,0.18)] transition ${
                    aud.href ? 'cursor-pointer hover:border-[var(--color-accent-gold)]/30 hover:bg-[#101b2e]/70' : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-[var(--color-accent-gold)]/10 text-[var(--color-accent-gold)]">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-[20px] font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
                        {aud.title}
                      </h3>
                      <p className="mt-2.5 text-[14px] leading-[1.6] text-[var(--color-text-secondary)]">
                        {aud.text}
                      </p>
                      {aud.href ? (
                        <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent-gold)] transition group-hover:gap-2">
                          Подробнее <ArrowRight className="h-3.5 w-3.5" />
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
      <section className={sectionClass}>
        <div className="max-w-[720px]">
          <div className={eyebrowClass}>Сравнение</div>
          <h2 className={`mt-5 ${h2Class}`}>
            {PRODUCT} заменяет хаос из разных программ
          </h2>
          <p className={`mt-5 ${leadClass}`}>
            Вместо того чтобы вести бизнес одновременно в Excel, мессенджерах, кассовой программе,
            складской таблице и заметках сотрудника — {PRODUCT} собирает всё в одной системе.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {comparisons.map((item) => (
            <Card
              key={item.name}
              className={
                item.tone === 'highlight'
                  ? 'rounded-[24px] border-[var(--color-accent-gold)]/40 bg-[linear-gradient(135deg,rgba(245,184,75,0.18),rgba(245,184,75,0.04))] p-7 shadow-[0_24px_60px_rgba(245,184,75,0.18)]'
                  : 'rounded-[24px] border-white/[0.08] bg-[#0d1626]/60 p-7 shadow-[0_18px_48px_rgba(0,0,0,0.16)]'
              }
            >
              <div className="flex items-center gap-2.5">
                <h3
                  className={`font-display text-[20px] font-bold tracking-[-0.02em] ${
                    item.tone === 'highlight' ? 'text-[var(--color-accent-gold)]' : 'text-[var(--color-text-primary)]'
                  }`}
                >
                  {item.name}
                </h3>
                {item.tone === 'highlight' ? (
                  <span className="rounded-full border border-[var(--color-accent-gold)]/30 bg-[var(--color-accent-gold)]/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-accent-gold)]">
                    Выбор
                  </span>
                ) : null}
              </div>
              <p className="mt-3.5 text-[14px] leading-[1.6] text-[var(--color-text-secondary)]">{item.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── 8. ТАРИФЫ ────────── */}
      <section id="pricing" className={sectionClass}>
        <div className="max-w-[720px]">
          <div className={eyebrowClass}>Тарифы</div>
          <h2 className={`mt-5 ${h2Class}`}>
            Подключайте только то, что нужно бизнесу
          </h2>
          <p className={`mt-5 ${leadClass}`}>
            От базовых финансовых показателей до полноценной системы продаж и сетевого учёта.
            Тариф можно менять по мере роста бизнеса.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pricingPlans.map((plan) => (
            <Card
              key={plan.name}
              className={
                plan.highlight
                  ? 'relative rounded-[24px] border-[var(--color-accent-gold)]/40 bg-[linear-gradient(180deg,rgba(245,184,75,0.16),rgba(13,22,38,0.6))] p-8 shadow-[0_30px_70px_rgba(245,184,75,0.18)]'
                  : 'rounded-[24px] border-white/[0.08] bg-[#0d1626]/70 p-8 shadow-[0_18px_48px_rgba(0,0,0,0.20)]'
              }
            >
              {plan.highlight && plan.badge ? (
                <span className="absolute right-5 top-5 rounded-full border border-[var(--color-accent-gold)]/40 bg-[var(--color-accent-gold)]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-accent-gold)]">
                  {plan.badge}
                </span>
              ) : null}
              <div className="font-display text-[26px] font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
                {plan.name}
              </div>
              <p className="mt-2.5 text-[14px] leading-[1.6] text-[var(--color-text-secondary)]">
                {plan.description}
              </p>
              <ul className="mt-6 space-y-3 border-t border-white/[0.06] pt-6">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 text-[14px] leading-[1.55] text-[var(--color-text-secondary)]"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-gold)]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className={
                  plan.highlight
                    ? 'mt-7 w-full rounded-[14px] bg-gradient-to-br from-[#ffb25c] to-[#ff7b4d] py-[14px] text-[15px] font-semibold text-[#0a0f18] shadow-[0_10px_30px_rgba(255,140,70,0.22)] hover:from-[#ffbe6e] hover:to-[#ff8a5c]'
                    : 'mt-7 w-full rounded-[14px] bg-white/[0.06] py-[14px] text-[15px] font-semibold text-[var(--color-text-primary)] hover:bg-white/[0.10]'
                }
              >
                <Link href="#contact">{plan.cta}</Link>
              </Button>
            </Card>
          ))}
        </div>

        {/* Дополнительные модули */}
        <div className="mt-14">
          <div className={eyebrowClass}>Дополнительные модули</div>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {addOns.map((addon) => (
              <Card
                key={addon.title}
                className="rounded-[20px] border-white/[0.08] bg-[#0d1626]/60 p-6 shadow-[0_12px_32px_rgba(0,0,0,0.16)]"
              >
                <h3 className="font-display text-[17px] font-bold tracking-[-0.01em] text-[var(--color-text-primary)]">
                  {addon.title}
                </h3>
                <p className="mt-2.5 text-[14px] leading-[1.6] text-[var(--color-text-secondary)]">
                  {addon.text}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ────────── 9. ОТДЕЛЬНАЯ СТРАНИЦА ДЛЯ КЛУБОВ ────────── */}
      <section className={sectionClass}>
        <Card className="rounded-[28px] border-[var(--color-accent-teal)]/20 bg-[linear-gradient(135deg,rgba(16,214,194,0.08),rgba(13,22,38,0.6))] p-10 shadow-[0_24px_70px_rgba(0,0,0,0.30)] sm:p-12">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-accent-teal)]/30 bg-[var(--color-accent-teal)]/10 px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent-teal)]">
                <Cpu className="h-3.5 w-3.5" />
                Версия для компьютерных клубов
              </div>
              <h2 className={`mt-5 ${h2Class}`}>
                Управляете компьютерным клубом?
              </h2>
              <p className={`mt-4 ${leadClass}`}>
                Для клубов есть отдельная версия со специфическими функциями: операторы, ночные смены,
                учёт нескольких зон, бар при клубе, Kaspi с раздельным учётом до и после полуночи и
                Telegram-отчёты для владельца.
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="rounded-[18px] bg-[var(--color-accent-teal)] px-7 py-[18px] text-[18px] font-semibold text-[#062a26] shadow-[0_10px_30px_rgba(16,214,194,0.22)] hover:bg-[#21eddc] lg:self-center"
            >
              <Link href="/club-management-system">
                Открыть страницу клубов
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </Card>
      </section>

      {/* ────────── FAQ ────────── */}
      <section className={sectionClass}>
        <div className="max-w-[720px]">
          <div className={eyebrowClass}>Частые вопросы</div>
          <h2 className={`mt-5 ${h2Class}`}>
            Что владельцы спрашивают чаще всего
          </h2>
        </div>

        <div className="mt-10 grid gap-3.5 md:grid-cols-2">
          {faqItems.map((item) => (
            <Card
              key={item.question}
              className="rounded-[20px] border-white/[0.08] bg-[#0d1626]/60 p-6 shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
            >
              <h3 className="font-display text-[17px] font-bold leading-[1.35] tracking-[-0.01em] text-[var(--color-text-primary)]">
                {item.question}
              </h3>
              <p className="mt-3 text-[14px] leading-[1.65] text-[var(--color-text-secondary)]">
                {item.answer}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── 10. ФИНАЛЬНЫЙ CTA ────────── */}
      <section
        id="contact"
        className="mx-auto max-w-[1320px] px-6 pb-28 pt-12 sm:px-10 lg:px-12"
      >
        <Card className="rounded-[28px] border-[var(--color-accent-gold)]/30 bg-[linear-gradient(135deg,rgba(245,184,75,0.18),rgba(13,22,38,0.6))] p-10 shadow-[0_30px_80px_rgba(0,0,0,0.36)] sm:p-14">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <div>
              <div className={eyebrowClass}>
                <Sparkles className="h-3.5 w-3.5" />
                Начните сегодня
              </div>
              <h2 className={`mt-5 ${h2Class}`}>
                Начните видеть реальные деньги бизнеса каждый день
              </h2>
              <p className={`mt-5 ${leadClass}`}>
                {PRODUCT} помогает контролировать продажи, смены, расходы, склад, зарплаты и прибыль
                в одной системе. Оставьте контакты — покажем как это работает на ваших данных.
              </p>

              <div className="mt-8 space-y-3">
                <CTAFeature icon={Wallet} text="Прибыль и маржа в реальном времени" />
                <CTAFeature icon={Bot} text="AI объясняет цифры простым языком" />
                <CTAFeature icon={Building2} text="Несколько точек на одной системе" />
                <CTAFeature icon={ShieldCheck} text="Данные изолированы, журнал аудита, бэкапы" />
              </div>
            </div>

            <div className="rounded-[24px] border border-white/[0.08] bg-[#0d1626]/80 p-7 sm:p-8">
              <div className="mb-5">
                <h3 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
                  Получить консультацию
                </h3>
                <p className="mt-1.5 text-[14px] leading-[1.55] text-[var(--color-text-soft)]">
                  Покажем как {PRODUCT} работает на ваших данных и подскажем тариф.
                </p>
              </div>
              <ContactLeadForm />
            </div>
          </div>
        </Card>
      </section>

      {/* ────────── ФУТЕР ────────── */}
      <footer className="mx-auto max-w-[1320px] px-6 pb-12 sm:px-10 lg:px-12">
        <div className="rounded-[20px] border border-white/[0.06] bg-[#0d1626]/60 px-7 py-6 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-[14px] bg-gradient-to-br from-[#ffb25c] to-[#ff7b4d] text-base font-bold text-[#0a0f18]">
                ◇
              </div>
              <div>
                <div className="font-display text-[16px] font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
                  {PRODUCT}
                </div>
                <div className="text-[12px] text-[var(--color-text-muted)]">
                  © 2026 — все права защищены
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] font-medium text-[var(--color-text-muted)]">
              <Link href="/offer" className="transition hover:text-[var(--color-accent-gold)]">
                Договор оферты
              </Link>
              <Link href="/privacy" className="transition hover:text-[var(--color-accent-gold)]">
                Политика конфиденциальности
              </Link>
              <Link href="/club-management-system" className="transition hover:text-[var(--color-accent-gold)]">
                Для компьютерных клубов
              </Link>
              <Link href="/login" className="transition hover:text-[var(--color-accent-gold)]">
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
    <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-display text-[26px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-text-primary)] tabular-nums">
          {value}
        </span>
        {unit ? <span className="text-[12px] text-[var(--color-text-muted)]">{unit}</span> : null}
      </div>
      <div
        className={`mt-1 text-[11px] font-semibold ${
          trend === 'up'
            ? 'text-[var(--color-accent-success)]'
            : trend === 'down'
              ? 'text-[var(--color-accent-negative)]'
              : 'text-[var(--color-text-muted)]'
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
    <div className="flex items-start gap-3 rounded-[16px] border border-white/[0.06] bg-black/20 px-5 py-3.5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-accent-gold)]" />
      <div className="text-[14px] leading-[1.55] text-[var(--color-text-secondary)]">
        <strong className="font-semibold text-[var(--color-text-primary)]">{title}</strong> — {text}
      </div>
    </div>
  )
}

function CTAFeature({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[16px] border border-white/[0.08] bg-black/25 px-5 py-3.5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-accent-gold)]" />
      <div className="text-[15px] leading-[1.55] text-[var(--color-text-primary)]">{text}</div>
    </div>
  )
}
