import type { Metadata } from 'next'
import { Fragment } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  BadgePercent,
  Banknote,
  Bot,
  Boxes,
  Brain,
  Building2,
  Calculator,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock4,
  CloudOff,
  Coffee,
  Cpu,
  Eye,
  FileCheck,
  GraduationCap,
  HelpCircle,
  Landmark,
  LineChart,
  Lock,
  MessageCircle,
  PiggyBank,
  Receipt,
  Rocket,
  Scale,
  ScanLine,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tag,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ContactLeadForm } from '@/components/public/contact-lead-form'
import { FloatingCta } from '@/components/public/floating-cta'
import { FaqStructuredData, WebsiteStructuredData } from '@/components/public/structured-data'
import { CountUp, HeroIn, LiveDot, Parallax, Reveal, Stagger, StaggerItem } from '@/components/public/landing-motion'
import { CopilotDemo, FeatureMarquee, GrowBars, InsightTicker, OfflineDemo, TelegramDemo } from '@/components/public/landing-demos'

export const metadata: Metadata = {
  title: 'Orda Control — касса, склад, зарплаты и AI-управление бизнесом',
  description:
    'Система управления точкой продаж: POS с офлайн-режимом, склад с приёмкой по фото, смены, зарплаты, Telegram-бот и AI-копилот. Для магазинов, кафе, компьютерных клубов и сервисов в Казахстане.',
}

const PRODUCT = 'Orda Control'

// ─────────── ДИЗАЙН-СИСТЕМА (светлая, Stripe/Linear-стиль) ───────────
// Белый фон, navy-заголовки (#0f2038), зелёный акцент (#16a34a), оранжевый — вторичный.
// Композиция по разбору дизайнера: контейнер 1200px, заголовки по центру, без пустот.

const eyebrowClass =
  'inline-flex items-center gap-2 rounded-full border border-[#16a34a]/25 bg-[#16a34a]/[0.07] px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#15803d]'
const h1Class =
  'font-display text-[44px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[#0f2038] sm:text-[56px] lg:text-[64px]'
const h2Class =
  'font-display text-balance text-[32px] font-bold leading-[1.1] tracking-[-0.02em] text-[#0f2038] sm:text-[40px] lg:text-[44px]'
const h3RowClass =
  'font-display text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-[#0f2038] sm:text-[30px]'
const leadClass = 'text-pretty text-[18px] leading-[1.6] text-[#56657d] sm:text-[20px]'
const sectionClass = 'mx-auto max-w-[1200px] px-6 py-20 sm:px-10 lg:py-24 lg:px-10'
const sectionHeadClass = 'mx-auto max-w-[720px] text-center'
const cardClass = 'rounded-[20px] border border-[#d6dde8] bg-white p-7 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]'
const btnPrimary =
  'rounded-[14px] bg-gradient-to-br from-[#1db955] to-[#15803d] px-8 py-[16px] text-[17px] font-semibold text-white shadow-[0_12px_28px_-8px_rgba(22,163,74,0.5)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-8px_rgba(22,163,74,0.6)]'
const btnGhost =
  'rounded-[14px] border border-[#c8d1de] bg-white px-8 py-[16px] text-[17px] font-semibold text-[#0f2038] transition hover:border-[#16a34a]/40 hover:text-[#15803d]'

// ─────────────── ДАННЫЕ ───────────────

const heroInsights = [
  'Маржа ↓ 1,4% — выросла закупка «напитки» на 14%. Альтернатива дешевле на 11% — экономия ~42 000 ₸/мес.',
  'Выручка сегодня идёт на +8% к среднему вторнику. Пик — с 18:00 до 21:00.',
  'По товару «энергетики» осталось на 3 дня продаж. В план закупа добавлено 4 упаковки.',
  'Смена закрыта без расхождений: наличные, Kaspi и система сошлись до тенге.',
]

const marqueeFeatures = [
  'Чеки ККМ и ОФД', 'Печать ценников', 'Сканер штрихкодов', 'Промокоды и акции', 'Бонусные баллы',
  'План закупа', 'Приёмка по фото', 'Срок годности', 'ABC-анализ', 'Слепые ревизии',
  'График смен', 'Авторасчёт зарплат', 'AI-квизы для новичков', 'Задачи и чек-листы', 'Экран покупателя',
  'Налоги ИП и форма 910', 'Cash Flow', 'Оценка бизнеса', 'Финмодель новой точки', 'Журнал аудита',
]

const painPoints = [
  { pain: 'Прибыль видно только после закрытия месяца', solution: 'P&L и маржа считаются автоматически после каждой смены.' },
  { pain: 'Подозреваю недостачи, но доказать не могу', solution: 'Слепые ревизии: система сама находит расхождение и виновного.' },
  { pain: 'Интернет пропал — торговля встала', solution: 'Касса работает офлайн: продажи копятся и синхронизируются сами.' },
  { pain: 'Смена закрылась с расхождением', solution: 'Автосверка нал / безнал / онлайн — расхождение видно сразу.' },
  { pain: 'Зарплата — споры и ручные пересчёты', solution: 'Авторасчёт: ставка, процент, KPI, бонусы, штрафы и долги.' },
  { pain: 'Накладные некогда вбивать руками', solution: 'Фото накладной в Telegram — AI сам создаёт приёмку на склад.' },
  { pain: 'Не на месте, но хочу видеть цифры', solution: 'Telegram-бот: итоги дня, аномалии и ответы на любые вопросы.' },
  { pain: 'Непонятно, что и сколько закупать', solution: 'План закупа на неделю по продажам и остаткам — с точкой дозаказа.' },
]

const steps = [
  { icon: Cpu, title: 'Подключаете точку', text: 'Настроим кассу и кабинет за день — без своих серверов и баз.', tone: 'green' as const },
  { icon: LineChart, title: 'Видите финансы каждый день', text: 'Прибыль, маржа, смены и расхождения — в реальном времени.', tone: 'green' as const },
  { icon: Bot, title: 'Решаете по цифрам', text: 'AI подсказывает, где теряете деньги и где можно заработать.', tone: 'orange' as const },
]

const moduleRows: Array<{
  eyebrow: string
  icon: any
  title: string
  lead: string
  bullets: Array<{ icon: any; text: string }>
  visual: 'pos' | 'store' | 'team' | 'finance'
}> = [
  {
    eyebrow: 'Касса',
    icon: ShoppingBag,
    title: 'POS, который не останавливает торговлю',
    lead: 'Полноценная касса на Windows и в браузере: штрихкоды, смешанная оплата, лояльность — и полный офлайн-режим.',
    bullets: [
      { icon: CloudOff, text: 'Работает без интернета: продажи, возвраты и отчёты уходят в очередь и синхронизируются сами' },
      { icon: FileCheck, text: 'Чеки с фискальными реквизитами ККМ и ОФД — по требованиям приказа МФ РК №626' },
      { icon: BadgePercent, text: 'Скидки, промокоды, бонусные баллы и смешанная оплата (наличные + Kaspi + карта)' },
      { icon: ScanLine, text: 'Сканер штрихкодов, отложенные чеки, экран покупателя с вашей рекламой' },
    ],
    visual: 'pos',
  },
  {
    eyebrow: 'Склад и закуп',
    icon: Boxes,
    title: 'Склад, который сам говорит, что закупать',
    lead: 'От приёмки по фото накладной до плана закупа на неделю — товарный учёт без ручного ввода.',
    bullets: [
      { icon: Camera, text: 'AI распознаёт фото или PDF накладной и сопоставляет позиции с каталогом' },
      { icon: TrendingUp, text: 'План закупа по продажам и остаткам + автозаявки поставщикам по точке дозаказа' },
      { icon: Truck, text: 'Поставщики, долги по накладным и напоминания о сроках оплаты' },
      { icon: Clock4, text: 'Срок годности, списания, ABC-анализ и печать ценников со штрихкодами' },
    ],
    visual: 'store',
  },
  {
    eyebrow: 'Команда',
    icon: Users,
    title: 'Смены, зарплата и обучение — без споров',
    lead: 'График, авторасчёт зарплаты и кабинет сотрудника в телефоне: каждый видит свои смены, задачи и деньги.',
    bullets: [
      { icon: Wallet, text: 'Зарплата: ставка, процент от оборота, KPI, бонусы за стаж, штрафы и авансы' },
      { icon: Smartphone, text: 'Кабинет оператора на телефоне: свои смены, задачи и расчёт зарплаты' },
      { icon: CalendarDays, text: 'График смен с напоминаниями, задачи с уведомлениями, командный чат' },
      { icon: GraduationCap, text: 'База знаний с обязательным подтверждением и AI-квизами для новичков' },
    ],
    visual: 'team',
  },
  {
    eyebrow: 'Финансы владельца',
    icon: PiggyBank,
    title: 'Цифры уровня финдиректора — каждый день',
    lead: 'ОПиУ, денежный поток, налоги и инструменты для роста: от оценки бизнеса до финмодели новой точки.',
    bullets: [
      { icon: LineChart, text: 'P&L, EBITDA и маржа по каждой точке — сравнение периодов и точек между собой' },
      { icon: Banknote, text: 'Cash Flow: движение денег и баланс нарастающим итогом' },
      { icon: Calculator, text: 'Налоги ИП Казахстана: упрощёнка, форма 910, соцплатежи — посчитаны заранее' },
      { icon: Building2, text: 'Оценка бизнеса для инвестора и финмодель новой точки с окупаемостью' },
    ],
    visual: 'finance',
  },
]

const aiCapabilities = [
  { icon: Brain, title: 'AI-финдиректор', text: 'Health Score бизнеса, точка безубыточности, сценарии «что если» и план действий.' },
  { icon: LineChart, title: 'Прогноз на 3 месяца', text: 'Доход, расход и прибыль — с сезонностью, аномалиями и тремя сценариями.' },
  { icon: Receipt, title: 'Накладные по фото', text: 'Фото счёта превращается в приёмку: позиции, цены и категории расходов.' },
  { icon: Users, title: 'Разборы: команда, расходы, магазин', text: 'Кто из сотрудников звезда, где утекают деньги, какой товар — мёртвый груз.' },
]

const telegramFeatures = [
  { icon: Receipt, text: 'Фото накладной → готовая приёмка на склад' },
  { icon: LineChart, text: 'Итоги дня: выручка, прибыль, аномалии — каждое утро' },
  { icon: Wallet, text: 'Зарплатный расчёт каждому сотруднику в личку по воскресеньям' },
  { icon: MessageCircle, text: 'Вопросы своими словами: «сколько заработали за неделю?»' },
  { icon: AlertCircle, text: 'Алерты: просроченные долги поставщикам, товары на исходе, напоминания о сменах' },
]

const controlFeatures = [
  { icon: Eye, title: 'Слепые ревизии', text: 'Оператор считает, не видя системный остаток. В двойном режиме двое считают независимо — расхождение видно сразу.' },
  { icon: Wallet, title: 'Недостача — долгом', text: 'Подтверждённая недостача автоматически вешается долгом на ответственного и удерживается из зарплаты.' },
  { icon: AlertCircle, title: 'Сигнал о воровстве', text: 'Три и больше недостач по товару за месяц — система сама предупреждает владельца в Telegram.' },
  { icon: ShieldCheck, title: 'Автосверка каждой смены', text: 'Наличные, Kaspi и система сверяются при закрытии смены. Расхождение не спрятать.' },
  { icon: Lock, title: 'Права и роли', text: 'Каждый видит только своё: должности, персональные права, страница «Доступ» под вашим контролем.' },
  { icon: FileCheck, title: 'Журнал аудита', text: 'Каждое действие записано: кто изменил расход, удалил продажу или выдал аванс — видно всегда.' },
]

const numbers = [
  { value: 110, suffix: '+', label: 'действий выполняет AI-копилот' },
  { value: 90, suffix: '+', label: 'экранов управления бизнесом' },
  { value: 9, suffix: '', label: 'формул бизнес-аналитики: ABC, RFM, EOQ…' },
  { value: 24, suffix: '/7', label: 'Telegram-бот на связи' },
]

const audiences = [
  { icon: ShoppingBag, title: 'Магазины', text: 'Касса, склад, витрина, смены.' },
  { icon: Cpu, title: 'Компьютерные клубы', text: 'Операторы, зоны, бар, ночные смены.', href: '/club-management-system' },
  { icon: Coffee, title: 'Кафе и точки еды', text: 'Закуп, списания, маржа, выручка.' },
  { icon: Wrench, title: 'Сервисные центры', text: 'Клиенты, оплаты, материалы, аналитика.' },
  { icon: Sparkles, title: 'Студии услуг', text: 'Записи, оплаты, зарплаты, расходы.' },
  { icon: Truck, title: 'Склады и точки', text: 'Остатки, перемещения, приёмка.' },
]

type ComparisonColumnKey = 'excel' | 'oneC' | 'poster' | 'orda'
const comparisonColumns: Array<{ key: ComparisonColumnKey; label: string; subtitle: string; highlight?: boolean }> = [
  { key: 'excel', label: 'Excel', subtitle: 'Таблицы' },
  { key: 'oneC', label: '1С', subtitle: 'Бухучёт' },
  { key: 'poster', label: 'Poster / Wipon', subtitle: 'POS' },
  { key: 'orda', label: 'Orda Control', subtitle: 'Управление', highlight: true },
]
const comparisonRows: Array<{ criterion: string; values: Record<ComparisonColumnKey, string> }> = [
  { criterion: 'Финансы в реальном времени', values: { excel: 'Вручную', oneC: 'Задним числом', poster: 'Частично', orda: 'Каждый день' } },
  { criterion: 'Касса без интернета', values: { excel: '—', oneC: 'Нет', poster: 'Частично', orda: 'Полный офлайн' } },
  { criterion: 'Сверка кассы по сменам', values: { excel: 'Нет', oneC: 'Сложно', poster: 'Базово', orda: 'Авто-сверка' } },
  { criterion: 'Расчёт зарплат', values: { excel: 'Руками', oneC: 'Настройка', poster: 'Интеграции', orda: 'Ставка · % · KPI' } },
  { criterion: 'Контроль недостач', values: { excel: 'Вручную', oneC: '—', poster: '—', orda: 'Слепые ревизии' } },
  { criterion: 'AI-анализ и действия', values: { excel: '—', oneC: '—', poster: 'Минимально', orda: 'Анализ + копилот' } },
  { criterion: 'Telegram-бот', values: { excel: '—', oneC: '—', poster: '—', orda: 'Отчёты и управление' } },
  { criterion: 'Лояльность и промокоды', values: { excel: '—', oneC: '—', poster: 'Есть', orda: 'Баллы · промо · сегменты' } },
  { criterion: 'Склад / витрина', values: { excel: 'Ручной', oneC: 'Модуль', poster: 'Базовый', orda: 'Раздельные балансы' } },
]

const pricingPlans = [
  { name: 'Start', levelLabel: 'Базовый', description: 'Видеть основные финансовые показатели.', features: ['Финансовый дашборд', 'Доходы и расходы', 'Отчёты по периодам', 'Telegram-отчёты владельцу'], cta: 'Попробовать', highlight: false },
  { name: 'Business', levelLabel: 'Оптимальный', description: 'Сотрудники, смены и ежедневная работа.', features: ['Всё из Start', 'Смены и сверка кассы', 'Зарплата: ставка, %, KPI', 'График, задачи, чат', 'AI-разборы показателей'], cta: 'Выбрать Business', highlight: true, badge: 'Популярный' },
  { name: 'Pro', levelLabel: 'Продвинутый', description: 'Полноценная система продаж и склада.', features: ['Всё из Business', 'POS с офлайн-режимом', 'Склад, приёмка по фото', 'Лояльность и промокоды', 'Ревизии и контроль недостач', 'AI-копилот и AI-финдиректор'], cta: 'Выбрать Pro', highlight: false },
  { name: 'Enterprise', levelLabel: 'Индивидуальный', description: 'Сети и несколько филиалов.', features: ['Несколько точек в одном кабинете', 'Роли и персональные права', 'Индивидуальная настройка модулей', 'Персональное внедрение'], cta: 'Связаться', highlight: false },
]

const faqItems = [
  { question: 'Работает ли касса без интернета?', answer: 'Да. При потере сети касса продолжает продавать: продажи, возвраты и отчёты копятся в локальную очередь и автоматически синхронизируются, когда интернет вернётся. Чек печатается и офлайн.' },
  { question: 'Чеки легальны для налоговой?', answer: 'Чеки печатаются с фискальными реквизитами ККМ по требованиям приказа МФ РК №626: БИН/ИИН, номера ККМ, НДС, ОФД. Плюс встроенный калькулятор налогов ИП: упрощёнка и форма 910.' },
  { question: `Чем ${PRODUCT} отличается от 1С?`, answer: `1С — учёт для бухгалтерии. ${PRODUCT} — операционно-финансовая платформа: смены, касса, AI, Telegram. Вы видите финансы каждый день, а не закрываете месяц задним числом.` },
  { question: 'А если я уже использую Wipon или Poster?', answer: `Можно работать в дополнение: касса в Wipon, а финансы и смены — в ${PRODUCT}. Или перейти полностью — поможем с миграцией.` },
  { question: 'AI правда работает?', answer: 'AI видит ваши данные: выручку, расходы, маржу, склад. Отвечает на вопросы, находит аномалии и выполняет действия: премии, промокоды, приёмки по фото накладной. Каждое действие — с учётом прав и записью в журнал.' },
  { question: 'Что нужно установить?', answer: `На кассе (Windows) — наше приложение, оно обновляется само. У владельца и сотрудников — ничего: кабинет открывается в браузере и на телефоне. ${PRODUCT} полностью облачный.` },
  { question: 'Кто видит мои данные?', answer: 'Только вы и те, кому вы дали доступ. Данные каждой компании изолированы. Журнал аудита на каждое действие.' },
  { question: 'Есть пробный период?', answer: 'Первая точка — 2 недели бесплатно с полным доступом. Не подойдёт — данные можно выгрузить. Без обязательств.' },
]

// ─────────────────────── СТРАНИЦА ───────────────────────

export default async function MarketingHomePage() {
  return (
    <main className="min-h-screen bg-white pb-[76px] text-[#0f2038] sm:pb-0">
      <WebsiteStructuredData />
      <FaqStructuredData faq={faqItems} />

      {/* Шапка */}
      <header className="sticky top-0 z-50 border-b border-[#e2e8f0] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3.5 sm:px-10 lg:px-10">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#16a34a] text-[15px] font-bold text-white">◇</div>
            <div>
              <div className="font-display text-[16px] font-bold tracking-[-0.02em] text-[#0f2038]">{PRODUCT}</div>
              <div className="hidden text-[11px] font-medium text-[#64748b] sm:block">Касса, склад, финансы и AI</div>
            </div>
          </div>
          <nav className="flex items-center gap-1.5">
            <Button asChild variant="ghost" className="hidden rounded-[11px] text-[14px] font-medium text-[#56657d] hover:bg-[#f3f6fa] hover:text-[#0f2038] sm:inline-flex">
              <Link href="#features">Возможности</Link>
            </Button>
            <Button asChild variant="ghost" className="hidden rounded-[11px] text-[14px] font-medium text-[#56657d] hover:bg-[#f3f6fa] hover:text-[#0f2038] sm:inline-flex">
              <Link href="#pricing">Тарифы</Link>
            </Button>
            <Button asChild variant="ghost" className="rounded-[11px] text-[14px] font-medium text-[#56657d] hover:bg-[#f3f6fa] hover:text-[#0f2038]">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild className="rounded-[12px] bg-none bg-[#16a34a] px-5 py-2 text-[14px] font-semibold text-white hover:bg-[#15803d]">
              <Link href="#contact">Попробовать<ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden bg-[radial-gradient(60%_60%_at_50%_0%,rgba(22,163,74,0.06),transparent)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <Parallax distance={50} className="absolute inset-0">
            <div className="absolute -top-24 right-[-6%] h-[440px] w-[440px] rounded-full bg-[#16a34a]/[0.08] blur-[130px]" />
            <div className="absolute top-[18%] left-[-8%] h-[380px] w-[380px] rounded-full bg-[#f97316]/[0.06] blur-[130px]" />
          </Parallax>
        </div>
        <div className="relative mx-auto max-w-[1200px] px-6 pb-16 pt-14 sm:px-10 lg:px-10 lg:pb-20 lg:pt-20">
          <div className="grid gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-14">
            <HeroIn>
              <div className={eyebrowClass}><Sparkles className="h-3.5 w-3.5" />Система управления бизнесом</div>
              <h1 className={`mt-6 ${h1Class}`}>
                Весь бизнес <span className="bg-gradient-to-r from-[#16a34a] to-[#22c55e] bg-clip-text text-transparent">под контролем</span>
              </h1>
              <p className={`mt-5 max-w-[520px] ${leadClass}`}>
                Касса с офлайн-режимом, склад, смены, зарплаты, Telegram-бот и AI-копилот — в одной системе. Прибыль видна каждый день.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className={btnPrimary}><Link href="#contact">Начать бесплатно<ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
                <Button asChild size="lg" variant="outline" className={btnGhost}><Link href="#features">Возможности</Link></Button>
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px] font-medium text-[#5b6b82]">
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />2 недели бесплатно</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />Касса работает без интернета</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />Чеки по требованиям РК</span>
              </div>
            </HeroIn>

            {/* Живой дашборд */}
            <HeroIn delay={0.15}>
              <div className="rounded-[22px] border border-[#d6dde8] bg-white p-5 shadow-[0_30px_70px_-26px_rgba(15,32,56,0.4)]">
                <div className="rounded-[18px] border border-[#e2e8f0] bg-[#eef2f8] p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">Финансовый дашборд</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#16a34a]/[0.1] px-2.5 py-1 text-[11px] font-semibold uppercase text-[#15803d]">
                      <LiveDot className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />live
                    </span>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <StatCard label="Выручка за день" value={412800} unit="₸" delta="+8%" up />
                    <StatCard label="Маржа" value={38} suffix="%" delta="−1.4%" />
                    <StatCard label="Прибыль за месяц" value={1960000} unit="₸" delta="+12%" up />
                    <StatCard label="ФОТ" value={540000} unit="₸" delta="0%" />
                  </div>
                  <div className="mt-3.5 rounded-[14px] border border-[#e2e8f0] bg-white p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748b]">Выручка · 7 дней</span>
                      <span className="text-[11px] font-semibold text-[#16a34a]">+8%</span>
                    </div>
                    <div className="mt-3"><GrowBars values={[42, 55, 38, 64, 48, 72, 80]} /></div>
                    <div className="mt-1.5 flex gap-1.5 text-[9px] font-medium text-[#94a3b8]">
                      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
                        <span key={d} className="flex-1 text-center">{d}</span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3.5 rounded-[14px] border border-[#16a34a]/20 bg-[#16a34a]/[0.05] p-4">
                    <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#15803d]"><Bot className="h-4 w-4" />AI-наблюдение</div>
                    <InsightTicker items={heroInsights} className="mt-2 min-h-[62px]" />
                  </div>
                </div>
              </div>
            </HeroIn>
          </div>
        </div>
      </section>

      {/* СОЦ-ДОКАЗАТЕЛЬСТВО + МАРКИ ВОЗМОЖНОСТЕЙ */}
      <div className="border-y border-[#e2e8f0] bg-white py-6">
        <Reveal className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-6 text-center text-[15px] font-medium text-[#5b6b82] sm:px-10">
          <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
          Уже считает финансы сети <span className="font-bold text-[#0f2038]">F16</span>
          <span className="text-[#cbd3e0]">·</span>
          <span className="font-semibold text-[#475569]">Arena · Ramen · Extra</span>
        </Reveal>
        <div className="mt-5">
          <FeatureMarquee items={marqueeFeatures} />
        </div>
      </div>

      {/* ПРОБЛЕМЫ */}
      <section className="bg-[#eef2f8]">
        <div className={sectionClass}>
          <Reveal className={sectionHeadClass}>
            <div className={eyebrowClass}><AlertCircle className="h-3.5 w-3.5" />Знакомая ситуация?</div>
            <h2 className={`mt-5 ${h2Class}`}>Что мешает видеть реальные деньги</h2>
            <p className={`mt-4 ${leadClass}`}>Восемь ситуаций, в которых прибыль утекает незаметно — и как Orda закрывает каждую.</p>
          </Reveal>
          <Stagger className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {painPoints.map((p) => (
              <StaggerItem key={p.pain}>
                <div className={`group h-full ${cardClass} !p-6 transition duration-300 hover:-translate-y-1 hover:border-[#16a34a]/30`}>
                  <h3 className="font-display text-[17px] font-bold leading-[1.3] text-[#0f2038]">{p.pain}</h3>
                  <div className="mt-4 flex items-start gap-2.5 rounded-[12px] bg-[#16a34a]/[0.06] p-3.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" />
                    <span className="text-[13.5px] leading-[1.5] text-[#475569]">{p.solution}</span>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* КАК ЭТО РАБОТАЕТ */}
      <section className={sectionClass}>
        <Reveal>
          <div className="overflow-hidden rounded-[28px] border border-[#d6dde8] bg-[linear-gradient(160deg,#f1f8f3,#f5f7fb)] p-8 shadow-[0_24px_60px_-28px_rgba(15,32,56,0.22)] sm:p-12 lg:p-14">
            <div className={sectionHeadClass}>
              <div className={eyebrowClass}><Rocket className="h-3.5 w-3.5" />Как это работает</div>
              <h2 className={`mt-5 ${h2Class}`}>От хаоса к цифрам — за 3&nbsp;шага</h2>
              <p className={`mt-4 ${leadClass}`}>Без своих серверов и интеграторов — запуск за день, результат уже с первой смены.</p>
            </div>
            <div className="relative mt-10">
              <div aria-hidden className="absolute inset-x-[14%] top-[50px] hidden h-[2px] bg-gradient-to-r from-[#16a34a]/45 via-[#cbd3e0] to-[#f97316]/45 md:block" />
              <Stagger className="relative z-10 grid gap-5 md:grid-cols-3">
                {steps.map((s, i) => {
                  const Icon = s.icon
                  const isOrange = s.tone === 'orange'
                  return (
                    <StaggerItem key={s.title}>
                      <div className={`group relative h-full ${cardClass} transition duration-300 hover:-translate-y-1 hover:border-[#16a34a]/30`}>
                        <div className="flex items-center justify-between">
                          <span className={`grid h-11 w-11 place-items-center rounded-full text-[18px] font-extrabold text-white ${isOrange ? 'bg-gradient-to-br from-[#fb923c] to-[#f97316]' : 'bg-gradient-to-br from-[#1db955] to-[#15803d]'}`}>{i + 1}</span>
                          <Icon className={`h-7 w-7 ${isOrange ? 'text-[#f97316]' : 'text-[#16a34a]'}`} />
                        </div>
                        <h3 className="mt-5 font-display text-[20px] font-bold tracking-[-0.01em] text-[#0f2038]">{s.title}</h3>
                        <p className="mt-2 text-[15px] leading-[1.5] text-[#56657d]">{s.text}</p>
                      </div>
                    </StaggerItem>
                  )
                })}
              </Stagger>
            </div>
          </div>
        </Reveal>
      </section>

      {/* МОДУЛИ: 4 ряда с чередованием сторон */}
      <section id="features" className="scroll-mt-20 border-y border-[#e2e8f0] bg-[#eef2f8]">
        <div className={sectionClass}>
          <Reveal className={sectionHeadClass}>
            <div className={eyebrowClass}><Boxes className="h-3.5 w-3.5" />Что внутри</div>
            <h2 className={`mt-5 ${h2Class}`}>Одна система вместо пяти программ</h2>
            <p className={`mt-4 ${leadClass}`}>Касса, склад, команда и финансы — связаны между собой: продажа сразу меняет остатки, смену и прибыль.</p>
          </Reveal>
          <div className="mt-14 space-y-16 lg:space-y-20">
            {moduleRows.map((row, idx) => {
              const Icon = row.icon
              const textFirst = idx % 2 === 0
              return (
                <Reveal key={row.title}>
                  <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
                    <div className={textFirst ? '' : 'lg:order-2'}>
                      <div className={eyebrowClass}><Icon className="h-3.5 w-3.5" />{row.eyebrow}</div>
                      <h3 className={`mt-4 ${h3RowClass}`}>{row.title}</h3>
                      <p className="mt-3 text-[16px] leading-[1.6] text-[#56657d]">{row.lead}</p>
                      <ul className="mt-6 space-y-3">
                        {row.bullets.map((b) => {
                          const BIcon = b.icon
                          return (
                            <li key={b.text} className="flex items-start gap-3">
                              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[#16a34a]/[0.1] text-[#16a34a]"><BIcon className="h-4 w-4" /></span>
                              <span className="text-[14.5px] leading-[1.55] text-[#475569]">{b.text}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                    <div className={textFirst ? '' : 'lg:order-1'}>
                      <ModuleVisual kind={row.visual} />
                    </div>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* AI-КОПИЛОТ */}
      <section className="border-b border-[#e2e8f0] bg-[#edf5ef]">
        <div className={sectionClass}>
          <Reveal className={sectionHeadClass}>
            <div className={eyebrowClass}><Bot className="h-3.5 w-3.5" />AI-помощник</div>
            <h2 className={`mt-5 ${h2Class}`}>AI, который не только советует — он делает</h2>
            <p className={`mt-4 ${leadClass}`}>Напишите копилоту как человеку: он начислит премию, создаст промокод, оприходует накладную и объяснит, почему упала маржа. 110+ действий.</p>
          </Reveal>
          <div className="mt-12 grid items-start gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
            <Reveal><CopilotDemo /></Reveal>
            <Stagger className="grid gap-3 sm:grid-cols-2">
              {aiCapabilities.map((c) => {
                const Icon = c.icon
                return (
                  <StaggerItem key={c.title}>
                    <div className="h-full rounded-[16px] border border-[#e2e8f0] bg-white p-5 transition duration-300 hover:-translate-y-0.5 hover:border-[#16a34a]/30">
                      <Icon className="h-5 w-5 text-[#16a34a]" />
                      <div className="mt-2.5 text-[15px] font-bold text-[#0f2038]">{c.title}</div>
                      <div className="mt-1 text-[13.5px] leading-[1.5] text-[#5b6b82]">{c.text}</div>
                    </div>
                  </StaggerItem>
                )
              })}
            </Stagger>
          </div>
        </div>
      </section>

      {/* TELEGRAM */}
      <section className={sectionClass}>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <div className={eyebrowClass}><MessageCircle className="h-3.5 w-3.5" />Telegram-бот</div>
            <h2 className={`mt-5 ${h2Class}`}>Бизнес управляется из мессенджера</h2>
            <p className={`mt-4 ${leadClass}`}>Не нужно открывать программы: бот сам присылает главное и понимает вопросы своими словами.</p>
            <ul className="mt-7 space-y-3">
              {telegramFeatures.map((f) => {
                const Icon = f.icon
                return (
                  <li key={f.text} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[#16a34a]/[0.1] text-[#16a34a]"><Icon className="h-4 w-4" /></span>
                    <span className="text-[14.5px] leading-[1.55] text-[#475569]">{f.text}</span>
                  </li>
                )
              })}
            </ul>
          </Reveal>
          <Reveal delay={0.1}><TelegramDemo /></Reveal>
        </div>
      </section>

      {/* КОНТРОЛЬ И ЧЕСТНОСТЬ — тёмная секция */}
      <section className="bg-[#0f2038]">
        <div className={sectionClass}>
          <Reveal className={sectionHeadClass}>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/40 bg-[#16a34a]/[0.15] px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#4ade80]">
              <ShieldCheck className="h-3.5 w-3.5" />Контроль и честность
            </div>
            <h2 className="mt-5 font-display text-balance text-[32px] font-bold leading-[1.1] tracking-[-0.02em] text-white sm:text-[40px] lg:text-[44px]">
              Деньги и товар перестают «испаряться»
            </h2>
            <p className="mt-4 text-pretty text-[18px] leading-[1.6] text-[#9fb0c7] sm:text-[20px]">
              Система устроена так, что недостачу не спрятать: ревизии вслепую, автосверка смен и журнал каждого действия.
            </p>
          </Reveal>
          <Stagger className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {controlFeatures.map((f) => {
              const Icon = f.icon
              return (
                <StaggerItem key={f.title}>
                  <div className="h-full rounded-[18px] border border-white/10 bg-white/[0.04] p-6 transition duration-300 hover:border-[#4ade80]/30 hover:bg-white/[0.07]">
                    <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#16a34a]/20 text-[#4ade80]"><Icon className="h-5 w-5" /></span>
                    <h3 className="mt-4 font-display text-[19px] font-bold text-white">{f.title}</h3>
                    <p className="mt-2 text-[14px] leading-[1.55] text-[#9fb0c7]">{f.text}</p>
                  </div>
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      </section>

      {/* ЦИФРЫ */}
      <section className="border-b border-[#e2e8f0] bg-white">
        <div className="mx-auto max-w-[1200px] px-6 py-14 sm:px-10 lg:px-10">
          <Stagger className="grid grid-cols-2 gap-8 text-center lg:grid-cols-4">
            {numbers.map((n) => (
              <StaggerItem key={n.label}>
                <div className="font-display text-[40px] font-extrabold tracking-[-0.02em] text-[#0f2038] sm:text-[48px]">
                  <CountUp value={n.value} suffix={n.suffix} />
                </div>
                <div className="mt-1 text-[13.5px] font-medium leading-[1.4] text-[#5b6b82]">{n.label}</div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ДЛЯ КОГО */}
      <section className={sectionClass}>
        <Reveal className={sectionHeadClass}>
          <div className={eyebrowClass}><Users className="h-3.5 w-3.5" />Для кого</div>
          <h2 className={`mt-5 ${h2Class}`}>Бизнесу с кассой, людьми и товаром</h2>
          <p className={`mt-4 ${leadClass}`}>Если есть касса, сотрудники и товар — Orda подстраивается под вашу нишу.</p>
        </Reveal>
        <Stagger className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {audiences.map((aud) => {
            const Icon = aud.icon
            const Wrapper: any = aud.href ? Link : 'div'
            const wp = aud.href ? { href: aud.href } : {}
            return (
              <StaggerItem key={aud.title}>
                <Wrapper {...wp} className="block h-full">
                  <div className={`group flex h-full items-start gap-4 ${cardClass} ${aud.href ? 'cursor-pointer transition duration-300 hover:-translate-y-1 hover:border-[#16a34a]/30' : 'transition duration-300 hover:border-[#16a34a]/25'}`}>
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-[#16a34a]/[0.1] text-[#16a34a]"><Icon className="h-5 w-5" /></div>
                    <div className="min-w-0">
                      <h3 className="font-display text-[19px] font-bold tracking-[-0.01em] text-[#0f2038]">{aud.title}</h3>
                      <p className="mt-1.5 text-[14.5px] leading-[1.5] text-[#56657d]">{aud.text}</p>
                      {aud.href ? <span className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-semibold text-[#16a34a]">Подробнее <ArrowRight className="h-3.5 w-3.5" /></span> : null}
                    </div>
                  </div>
                </Wrapper>
              </StaggerItem>
            )
          })}
        </Stagger>
      </section>

      {/* СРАВНЕНИЕ */}
      <section className="border-y border-[#e2e8f0] bg-[#eef2f8]">
        <div className={sectionClass}>
          <Reveal className={sectionHeadClass}>
            <div className={eyebrowClass}><Scale className="h-3.5 w-3.5" />Сравнение</div>
            <h2 className={`mt-5 ${h2Class}`}>Вместо пяти программ — одна</h2>
            <p className={`mt-4 ${leadClass}`}>Excel, 1С и кассовые программы решают по куску. Orda собирает всё в одном месте.</p>
          </Reveal>
          <Reveal className="mt-10 hidden overflow-hidden rounded-[18px] border border-[#d6dde8] bg-white lg:block">
            <div className="grid" style={{ gridTemplateColumns: `minmax(200px,1.1fr) repeat(${comparisonColumns.length}, minmax(140px,1fr))` }}>
              <div className="border-b border-[#e2e8f0] px-5 py-4"><span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">Критерий</span></div>
              {comparisonColumns.map((col) => (
                <div key={col.key} className={'border-b border-l border-[#e2e8f0] px-5 py-4 ' + (col.highlight ? 'bg-[#16a34a]/[0.06]' : '')}>
                  <div className={'font-display text-[16px] font-bold ' + (col.highlight ? 'text-[#15803d]' : 'text-[#0f2038]')}>{col.label}</div>
                  <div className="mt-0.5 text-[11px] text-[#64748b]">{col.subtitle}</div>
                </div>
              ))}
              {comparisonRows.map((row, ri) => (
                <Fragment key={row.criterion}>
                  <div className={'px-5 py-4 text-[13.5px] font-semibold text-[#0f2038] ' + (ri < comparisonRows.length - 1 ? 'border-b border-[#e2e8f0]' : '')}>{row.criterion}</div>
                  {comparisonColumns.map((col) => (
                    <div key={col.key} className={'border-l border-[#e2e8f0] px-5 py-4 text-[13px] ' + (ri < comparisonRows.length - 1 ? 'border-b ' : '') + (col.highlight ? 'bg-[#16a34a]/[0.04] font-medium text-[#0f2038]' : 'text-[#56657d]')}>
                      {col.highlight ? <span className="inline-flex items-start gap-1.5"><CheckCircle2 className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#16a34a]" />{row.values[col.key]}</span> : row.values[col.key]}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </Reveal>
          <Stagger className="mt-10 grid gap-3 lg:hidden">
            {comparisonColumns.map((col) => (
              <StaggerItem key={col.key}>
                <div className={col.highlight ? 'rounded-[18px] border-2 border-[#16a34a]/40 bg-white p-5' : 'rounded-[18px] border border-[#d6dde8] bg-white p-5'}>
                  <div className={'font-display text-[18px] font-bold ' + (col.highlight ? 'text-[#15803d]' : 'text-[#0f2038]')}>{col.label}</div>
                  <dl className="mt-3 grid gap-2 border-t border-[#e2e8f0] pt-3">
                    {comparisonRows.map((row) => (
                      <div key={row.criterion} className="grid grid-cols-[1fr_auto] gap-3">
                        <dt className="text-[12px] text-[#64748b]">{row.criterion}</dt>
                        <dd className="text-right text-[12.5px] text-[#0f2038]">{row.values[col.key]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ТАРИФЫ */}
      <section id="pricing" className={`${sectionClass} scroll-mt-20`}>
        <Reveal className={sectionHeadClass}>
          <div className={eyebrowClass}><Tag className="h-3.5 w-3.5" />Тарифы</div>
          <h2 className={`mt-5 ${h2Class}`}>Подключайте только нужное</h2>
          <p className={`mt-4 ${leadClass}`}>Цена зависит от числа точек и модулей — посчитаем индивидуально за 5 минут.</p>
        </Reveal>
        <Stagger className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pricingPlans.map((plan) => (
            <StaggerItem key={plan.name}>
              <div className={plan.highlight
                ? 'relative flex h-full flex-col rounded-[20px] border-2 border-[#16a34a]/45 bg-white p-7 shadow-[0_24px_54px_-18px_rgba(22,163,74,0.45)] transition-transform duration-300 hover:-translate-y-4 lg:-translate-y-3'
                : `flex h-full flex-col ${cardClass} transition duration-300 hover:-translate-y-1`}>
                {plan.highlight && plan.badge ? <span className="absolute right-5 top-5 rounded-full bg-gradient-to-br from-[#fb923c] to-[#f97316] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_6px_16px_-6px_rgba(249,115,22,0.6)]">{plan.badge}</span> : null}
                <div className={'text-[11px] font-semibold uppercase tracking-[0.12em] ' + (plan.highlight ? 'text-[#15803d]' : 'text-[#64748b]')}>{plan.levelLabel}</div>
                <div className="mt-1.5 font-display text-[26px] font-bold text-[#0f2038]">{plan.name}</div>
                <p className="mt-2 text-[14.5px] leading-[1.5] text-[#56657d]">{plan.description}</p>
                <ul className="mt-5 flex-1 space-y-2.5 border-t border-[#e2e8f0] pt-5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[14.5px] leading-[1.5] text-[#475569]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" /><span>{f}</span></li>
                  ))}
                </ul>
                <Button asChild className={plan.highlight
                  ? 'mt-6 w-full rounded-[12px] bg-none bg-[#16a34a] py-3 text-[14px] font-semibold text-white hover:bg-[#15803d]'
                  : 'mt-6 w-full rounded-[12px] bg-none bg-[#f3f6fa] py-3 text-[14px] font-semibold text-[#0f2038] hover:bg-[#e9eef4]'}>
                  <Link href="#contact">{plan.cta}</Link>
                </Button>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* FAQ */}
      <section className="border-y border-[#e2e8f0] bg-[#eef2f8]">
        <div className={sectionClass}>
          <Reveal className={sectionHeadClass}>
            <div className={eyebrowClass}><HelpCircle className="h-3.5 w-3.5" />Частые вопросы</div>
            <h2 className={`mt-5 ${h2Class}`}>Что спрашивают чаще всего</h2>
          </Reveal>
          <Stagger className="mt-10 grid gap-3 md:grid-cols-2">
            {faqItems.map((item) => (
              <StaggerItem key={item.question}>
                <details className="group h-full rounded-[20px] border border-[#d6dde8] bg-white px-6 py-5 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)] transition-colors duration-300 hover:border-[#16a34a]/30 open:border-[#16a34a]/30 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <h3 className="font-display text-[17px] font-bold leading-[1.35] text-[#0f2038]">{item.question}</h3>
                    <ChevronDown className="h-5 w-5 shrink-0 text-[#16a34a] transition-transform duration-300 group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-[14.5px] leading-[1.6] text-[#56657d]">{item.answer}</p>
                </details>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* CTA + ФОРМА */}
      <section id="contact" className={`${sectionClass} scroll-mt-20`}>
        <Reveal>
          <div className="overflow-hidden rounded-[26px] border border-[#16a34a]/20 bg-[linear-gradient(135deg,rgba(22,163,74,0.10),rgba(249,115,22,0.07)_58%,rgba(255,255,255,1))] p-9 shadow-[0_24px_60px_-28px_rgba(15,32,56,0.3)] sm:p-12">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
              <div>
                <div className={eyebrowClass}><Sparkles className="h-3.5 w-3.5" />Начните сегодня</div>
                <h2 className={`mt-5 ${h2Class}`}>Видеть реальные деньги бизнеса каждый день</h2>
                <p className={`mt-4 ${leadClass}`}>Оставьте контакты — покажем, как {PRODUCT} работает на ваших данных, и подскажем тариф.</p>
                <div className="mt-7 space-y-2.5">
                  <CtaFeature icon={Wallet} text="Прибыль и маржа в реальном времени" />
                  <CtaFeature icon={CloudOff} text="Касса работает даже без интернета" />
                  <CtaFeature icon={Bot} text="AI-копилот выполняет рутину за вас" />
                  <CtaFeature icon={Building2} text="Несколько точек на одной системе" />
                  <CtaFeature icon={ShieldCheck} text="Данные изолированы, журнал аудита, бэкапы" />
                </div>
              </div>
              <div className="rounded-[20px] border border-[#d6dde8] bg-white p-7 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
                <h3 className="font-display text-[20px] font-bold text-[#0f2038]">Получить консультацию</h3>
                <p className="mt-1.5 text-[13.5px] text-[#5b6b82]">Ответим в течение рабочего дня. Без спама и звонков-роботов.</p>
                <div className="mt-5"><ContactLeadForm /></div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ФУТЕР */}
      <footer className="border-t border-[#e2e8f0] bg-white">
        <div className="mx-auto max-w-[1200px] px-6 py-10 sm:px-10 lg:px-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-[340px]">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#16a34a] text-[15px] font-bold text-white">◇</div>
                <div className="font-display text-[16px] font-bold text-[#0f2038]">{PRODUCT}</div>
              </div>
              <p className="mt-3 text-[14px] leading-[1.5] text-[#5b6b82]">Касса, склад, финансы и AI — в одной системе. Прибыль видна каждый день.</p>
            </div>
            <div className="flex flex-wrap gap-x-14 gap-y-7">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">Продукт</div>
                <div className="mt-3.5 flex flex-col gap-2.5 text-[14px] font-medium text-[#5b6b82]">
                  <Link href="#features" className="transition-colors hover:text-[#16a34a]">Возможности</Link>
                  <Link href="#pricing" className="transition-colors hover:text-[#16a34a]">Тарифы</Link>
                  <Link href="/club-management-system" className="transition-colors hover:text-[#16a34a]">Для клубов</Link>
                  <Link href="/login" className="transition-colors hover:text-[#16a34a]">Войти</Link>
                </div>
              </div>
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">Документы</div>
                <div className="mt-3.5 flex flex-col gap-2.5 text-[14px] font-medium text-[#5b6b82]">
                  <Link href="/offer" className="transition-colors hover:text-[#16a34a]">Оферта</Link>
                  <Link href="/privacy" className="transition-colors hover:text-[#16a34a]">Политика</Link>
                  <Link href="/terms" className="transition-colors hover:text-[#16a34a]">Соглашение</Link>
                  <Link href="/sla" className="transition-colors hover:text-[#16a34a]">SLA</Link>
                </div>
              </div>
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">Связь</div>
                <div className="mt-3.5 flex flex-col gap-2.5 text-[14px] font-medium text-[#5b6b82]">
                  <Link href="#contact" className="transition-colors hover:text-[#16a34a]">Оставить заявку</Link>
                  <Link href="/cookies" className="transition-colors hover:text-[#16a34a]">Cookies</Link>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-9 border-t border-[#eef2f8] pt-6 text-[12px] text-[#64748b]">© 2026 {PRODUCT} — все права защищены</div>
        </div>
      </footer>

      <FloatingCta />
    </main>
  )
}

// ─────────────── ВСПОМОГАТЕЛЬНЫЕ ───────────────

function StatCard({ label, value, unit, suffix, delta, up }: { label: string; value: number; unit?: string; suffix?: string; delta: string; up?: boolean }) {
  return (
    <div className="rounded-[13px] border border-[#e2e8f0] bg-white p-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#64748b]">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-display text-[23px] font-extrabold tracking-[-0.02em] text-[#0f2038] tabular-nums"><CountUp value={value} suffix={suffix} /></span>
        {unit ? <span className="text-[12px] text-[#64748b]">{unit}</span> : null}
      </div>
      <div className={'mt-1 text-[11px] font-semibold ' + (up ? 'text-[#16a34a]' : 'text-[#94a3b8]')}>{delta} к среднему</div>
    </div>
  )
}

function CtaFeature({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#d6dde8] bg-white px-4 py-3">
      <Icon className="h-5 w-5 shrink-0 text-[#16a34a]" />
      <span className="text-[14px] font-medium text-[#0f2038]">{text}</span>
    </div>
  )
}

/** Визуалы модульных рядов: макеты продукта (данные — образец интерфейса). */
function ModuleVisual({ kind }: { kind: 'pos' | 'store' | 'team' | 'finance' }) {
  if (kind === 'pos') {
    return (
      <div className="space-y-4">
        <div className="rounded-[20px] border border-[#d6dde8] bg-white p-5 shadow-[0_20px_50px_-24px_rgba(15,32,56,0.3)]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">Чек · касса</span>
            <span className="rounded-full bg-[#16a34a]/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase text-[#15803d]">ККМ · ОФД</span>
          </div>
          <div className="mt-4 space-y-2.5 border-b border-dashed border-[#d6dde8] pb-4">
            {[
              { name: 'Вода 0,5 л', qty: '×2', sum: '640 ₸' },
              { name: 'Шоколад молочный', qty: '×1', sum: '890 ₸' },
              { name: 'Энергетик 0,45 л', qty: '×3', sum: '2 110 ₸' },
            ].map((l) => (
              <div key={l.name} className="flex items-center justify-between text-[13.5px]">
                <span className="text-[#0f2038]">{l.name} <span className="text-[#94a3b8]">{l.qty}</span></span>
                <span className="font-semibold text-[#0f2038] tabular-nums">{l.sum}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-[13px]">
            <span className="text-[#64748b]">Наличные 2 000 ₸ + Kaspi 1 640 ₸</span>
            <span className="font-display text-[18px] font-extrabold text-[#0f2038] tabular-nums">3 640 ₸</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-[#15803d]">
            <BadgePercent className="h-3.5 w-3.5" />Клиенту начислено 36 бонусов
          </div>
        </div>
        <OfflineDemo />
      </div>
    )
  }
  if (kind === 'store') {
    return (
      <div className="space-y-4">
        <div className="rounded-[20px] border border-[#d6dde8] bg-white p-5 shadow-[0_20px_50px_-24px_rgba(15,32,56,0.3)]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">Приёмка по фото</span>
            <Camera className="h-4 w-4 text-[#16a34a]" />
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-[13px] bg-[#eef2f8] p-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-white text-[#64748b]"><Receipt className="h-5 w-5" /></span>
            <div className="min-w-0 text-[13px] leading-[1.45]">
              <div className="font-semibold text-[#0f2038]">Накладная от «Асель-Трейд»</div>
              <div className="text-[#64748b]">14 позиций · 182 400 ₸ · сопоставлено с каталогом</div>
            </div>
            <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-[#16a34a]" />
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[12px] text-[#64748b]">
            <AlertCircle className="h-3.5 w-3.5 text-[#f97316]" />Закупочная цена «сок 1 л» выросла на 9% — система подсветила
          </div>
        </div>
        <div className="rounded-[20px] border border-[#d6dde8] bg-white p-5 shadow-[0_20px_50px_-24px_rgba(15,32,56,0.3)]">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">План закупа на неделю</span>
          <div className="mt-3.5 space-y-2.5">
            {[
              { name: 'Энергетик 0,45 л', note: 'осталось на 3 дня', qty: '4 уп.' },
              { name: 'Вода 0,5 л', note: 'точка дозаказа пройдена', qty: '6 уп.' },
              { name: 'Жев. резинка', note: 'растущий спрос +18%', qty: '2 уп.' },
            ].map((l) => (
              <div key={l.name} className="flex items-center justify-between rounded-[11px] bg-[#f7f9fc] px-3.5 py-2.5 text-[13px]">
                <div>
                  <div className="font-semibold text-[#0f2038]">{l.name}</div>
                  <div className="text-[11.5px] text-[#94a3b8]">{l.note}</div>
                </div>
                <span className="font-semibold text-[#15803d] tabular-nums">{l.qty}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'team') {
    return (
      <div className="mx-auto max-w-[340px]">
        <div className="rounded-[30px] border border-[#d6dde8] bg-white p-3 shadow-[0_30px_70px_-26px_rgba(15,32,56,0.4)]">
          <div className="rounded-[22px] border border-[#e2e8f0] bg-[#eef2f8] p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">Кабинет оператора</span>
              <Smartphone className="h-4 w-4 text-[#16a34a]" />
            </div>
            <div className="mt-4 rounded-[14px] bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748b]">К выплате за неделю</div>
              <div className="mt-1 font-display text-[26px] font-extrabold text-[#0f2038] tabular-nums">86 400 ₸</div>
              <div className="mt-1 text-[11.5px] text-[#64748b]">5 смен · бонус за оборот · −1 долг</div>
            </div>
            <div className="mt-3 rounded-[14px] bg-white p-4">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-semibold text-[#0f2038]">Смена завтра · 09:00</span>
                <span className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#15803d]">Подтверждена</span>
              </div>
            </div>
            <div className="mt-3 rounded-[14px] bg-white p-4">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-semibold text-[#0f2038]">Задача: выложить новинки</span>
                <span className="rounded-full bg-[#f97316]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#c2570c]">В работе</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  // finance
  return (
    <div className="rounded-[20px] border border-[#d6dde8] bg-white p-5 shadow-[0_20px_50px_-24px_rgba(15,32,56,0.3)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">ОПиУ · месяц</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#16a34a]/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase text-[#15803d]"><TrendingUp className="h-3 w-3" />+12%</span>
      </div>
      <div className="mt-4 space-y-2">
        {[
          { name: 'Выручка', sum: '12 480 000 ₸', strong: false },
          { name: 'Себестоимость', sum: '−7 730 000 ₸', strong: false },
          { name: 'Расходы и ФОТ', sum: '−2 790 000 ₸', strong: false },
          { name: 'Чистая прибыль', sum: '1 960 000 ₸', strong: true },
        ].map((l) => (
          <div key={l.name} className={`flex items-center justify-between rounded-[11px] px-3.5 py-2.5 text-[13.5px] ${l.strong ? 'bg-[#16a34a]/[0.07] font-bold text-[#15803d]' : 'bg-[#f7f9fc] text-[#0f2038]'}`}>
            <span>{l.name}</span>
            <span className="font-semibold tabular-nums">{l.sum}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-[13px] border border-[#e2e8f0] p-3.5">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#0f2038]"><Landmark className="h-4 w-4 text-[#16a34a]" />Налог по упрощёнке (910)</div>
        <span className="text-[13px] font-semibold text-[#0f2038] tabular-nums">посчитан заранее</span>
      </div>
    </div>
  )
}
