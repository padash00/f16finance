import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  CreditCard,
  Crown,
  FileText,
  MonitorSmartphone,
  Receipt,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Wallet,
  Workflow,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ContactLeadForm } from '@/components/public/contact-lead-form'
import { FaqStructuredData, WebsiteStructuredData } from '@/components/public/structured-data'
import { SITE_NAME } from '@/lib/core/site'

export const metadata: Metadata = {
  title: 'OrdaOps — система управления игровым клубом',
  description:
    'Касса, склад, операторы, финансы и AI в одной системе для игровых клубов Казахстана. Telegram-отчёты, киоск самообслуживания, минималистичный POS.',
}

// ───────────────────────── HERO ─────────────────────────

const heroBadges = [
  '🪟 Windows-касса',
  '📺 Киоск',
  '📱 Telegram-отчёты',
  '🤖 AI-помощник',
]

const heroStats = [
  { label: 'Контуров в одной системе', value: '8+' },
  { label: 'Real-time терминалов', value: 'Касса · Киоск · Веб' },
  { label: 'Автоматических отчётов', value: 'Telegram' },
]

// ─────────────────────── ПЭЙН-ПОИНТЫ ───────────────────────

const painPoints = [
  {
    icon: '🚪',
    pain: 'Кассир ушёл с разницей и непонятно откуда она',
    solution: 'Z-отчёт по смене с автоматической сверкой нал/Kaspi и подсветкой расхождений',
  },
  {
    icon: '📦',
    pain: 'На складе товар есть, на витрине — нет, продать не получается',
    solution: 'Склад и витрина — независимые балансы. Касса бьёт только витрину',
  },
  {
    icon: '💸',
    pain: 'К концу месяца не понимаю, сколько заработал и где деньги',
    solution: 'Дашборд с маржой, прогноз на 90 дней, AI объясняет почему просели',
  },
  {
    icon: '👥',
    pain: 'Зарплата операторов — каждый месяц спор и ручной пересчёт',
    solution: 'Гибкие правила: % от выручки, KPI, бонусы, штрафы — считаются автоматом',
  },
  {
    icon: '📸',
    pain: 'Не успеваю смотреть фотки накладных от поставщиков',
    solution: 'AI парсит фото счёт-фактуры, находит товары в каталоге, импортирует в приёмку',
  },
  {
    icon: '📲',
    pain: 'Я в одном городе, клуб в другом — что там сейчас происходит?',
    solution: 'Telegram-отчёты автоматом: закрытие смены, итоги дня, недостачи',
  },
]

// ─────────────────────── ДЕМО ЭКРАНОВ ───────────────────────

const productScreens = [
  {
    title: 'Минималистичная касса оператора',
    badge: 'Operator Desktop',
    points: [
      'Поиск по штрихкоду или названию, Enter — товар в чеке',
      'Корзина в центре, кнопка ОПЛАТИТЬ внизу',
      'Подтверждение перед каждой продажей — защита от случайного клика',
      'Чек открывается внутри программы, не в отдельном окне',
      'Адаптируется к экрану от 10" планшета до 34" монитора',
      'Работает оффлайн при обрыве интернета',
    ],
  },
  {
    title: 'Склад и витрина — независимо',
    badge: 'Inventory v2',
    points: [
      'Касса бьёт только витрину — никаких скрытых автотрансферов',
      'Заявка склад→витрина с резервированием',
      'Приёмка от поставщика → только склад',
      'История каждого движения товара',
      'Health-check каждый день: расхождения сразу в Telegram',
      'Универсальный товар для разовых продаж не из каталога',
    ],
  },
  {
    title: 'Финансы и AI-помощник',
    badge: 'AI Insights',
    points: [
      'Дашборд: выручка, маржа, ТОП-операторы — за день/неделю/месяц',
      'Прогноз на 90 дней с подсветкой аномалий',
      'AI-консультант видит ваши цифры и даёт рекомендации',
      'OCR накладных: фото → автоимпорт в приёмку',
      'ОПиУ и EBITDA по календарным суткам с раздельным учётом Kaspi',
      'Интеграция с Kaspi-терминалом и сверка комиссий',
    ],
  },
  {
    title: 'Telegram — мозг операционной',
    badge: 'Real-time контроль',
    points: [
      'Закрытие смены — сводка с разницей',
      'Утром — итоги вчерашнего дня по точкам',
      'В понедельник — AI-отчёт за неделю с прогнозом',
      'Алерт при регулярной недостаче товара',
      'Уведомление о просроченных долгах',
      'Сообщения в личку оператору и каналы для команды',
    ],
  },
]

// ─────────────────────── ФИЧИ-СЕТКА ───────────────────────

const featureGrid = [
  { icon: Receipt, title: 'POS касса', text: 'Минималистичный UI, штрихкод, оффлайн' },
  { icon: Boxes, title: 'Склад v2', text: 'Независимый учёт склада и витрины' },
  { icon: Bot, title: 'AI помощник', text: 'GPT-4o + прогнозы и анализ' },
  { icon: ScanLine, title: 'OCR накладных', text: 'Фото → автоматический импорт' },
  { icon: Wallet, title: 'Зарплата по KPI', text: 'Правила, бонусы, штрафы, история' },
  { icon: CreditCard, title: 'Kaspi сверка', text: 'Учёт с разбивкой по полуночи' },
  { icon: MonitorSmartphone, title: 'Киоск самообслуживания', text: 'Клиент сам выбирает и платит' },
  { icon: Send, title: 'Telegram-отчёты', text: '8 типов событий автоматом' },
  { icon: FileText, title: 'Чек-листы', text: 'Обязательные задачи перед сменой' },
  { icon: ShieldCheck, title: 'Инциденты и аудит', text: 'Все действия в логе' },
  { icon: Zap, title: 'Real-time', text: 'Все терминалы синхронизированы' },
  { icon: Crown, title: 'Multi-tenant SaaS', text: 'Несколько точек на одной БД' },
]

// ─────────────────────── СРАВНЕНИЕ ───────────────────────

const competitors = [
  { name: 'iCafeManager', cells: ['✓', '—', '—', '—', '—', '—', '—', '—'] },
  { name: 'SENET / SmartCafe', cells: ['✓', '—', '△', '—', '—', '—', '—', '—'] },
  { name: 'Wipon Pro', cells: ['✓✓', '✓', '—', '—', '✓', '—', '△', '—'] },
  { name: 'Poster', cells: ['✓✓', '✓', '✓', '—', '✓', '—', '—', '—'] },
  { name: 'OrdaOps', cells: ['✓✓', '✓✓', '✓✓', '✓', '✓', '✓', '✓✓', '✓'], highlight: true },
]
const competitorColumns = ['Касса', 'Склад', 'Зарплата+KPI', 'AI', 'Multi-tenant', 'Киоск', 'Telegram', 'Real-time']

// ─────────────────────── ЦЕНЫ ───────────────────────

const pricingPlans = [
  {
    name: 'Базовый',
    price: '25 000',
    note: '/мес за точку',
    features: [
      'Касса оператора (Windows)',
      'Склад и витрина с заявками',
      'Закрытие смены + Z-отчёт',
      'Telegram-отчёты автоматом',
      'До 3 операторов на точку',
      'Поддержка через Telegram',
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
      'AI-помощник для финансов',
      'OCR накладных через AI',
      'Прогноз выручки на 90 дней',
      'KPI и расчёт зарплаты',
      'Киоск самообслуживания',
      'Без ограничений на операторов',
    ],
    cta: 'Выбрать Pro',
    highlight: true,
    badge: 'Популярно',
  },
  {
    name: 'Сеть',
    price: 'Договорно',
    note: 'для нескольких точек',
    features: [
      'Всё из Pro',
      'Несколько точек на одной БД',
      'Структура компании',
      'Кастомизация под бизнес',
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
    text: 'Видеть выручку, маржу, ОПиУ и EBITDA как живую картину по точкам, а не в конце месяца ручкой.',
  },
  {
    icon: Workflow,
    title: 'Управляющему',
    text: 'Управлять сменами, операторами, складом и долгами в одном контуре, без чатов и таблиц.',
  },
  {
    icon: Store,
    title: 'Оператору на точке',
    text: 'Быстрая касса, понятный экран, ясные правила зарплаты. Минимум клик — максимум скорости.',
  },
]

// ─────────────────────── СРАВНЕНИЕ ДО / ПОСЛЕ ───────────────────────

const before = [
  'Смены закрываются в WhatsApp, отчёты теряются',
  'Ночной Kaspi не сходится с выпиской и ОПиУ',
  'Зарплата, долги, авансы — в разных таблицах',
  'Telegram = чат, а не часть процесса',
  'Касса и склад живут параллельно — продаётся то чего нет',
]

const after = [
  'Точка, Telegram, зарплата и финансы — одна система',
  'Ночной Kaspi автоматически делится по полуночи',
  'Долги, выплаты, KPI, премии — в одном месте',
  'Telegram интегрирован: отчёты, алерты, управление',
  'Касса бьёт только витрину — никаких сюрпризов',
]

// ─────────────────────── FAQ ───────────────────────

const faqItems = [
  {
    question: 'Подходит ли это только для игровых клубов?',
    answer:
      'Основа продукта подходит для любого бизнеса с точками, сменами, кассой и складом — кофейни, бары, барбершопы. Но узкие фичи (биллинг времени, киоск, аренда станций) сделаны под игровые клубы и компьютерные залы.',
  },
  {
    question: 'Что нужно чтобы начать?',
    answer:
      'Если у вас уже есть кассовый компьютер на Windows — просто скачайте Operator Desktop и зарегистрируйте точку. Веб-админка — на ordaops.kz. Никакого сервера у вас не надо.',
  },
  {
    question: 'Работает ли без интернета?',
    answer:
      'Да. Кассовая программа сохраняет операции локально и синхронизируется когда интернет вернётся. Витрина показывается из кэша мгновенно.',
  },
  {
    question: 'Можно ли перейти с Wipon, iCafe или Poster?',
    answer:
      'Да. Импортируем каталог товаров через Excel, переносим клиентов, настраиваем Kaspi-интеграцию. Помогаем с переходом и обучением операторов.',
  },
  {
    question: 'Кто видит мои финансовые данные?',
    answer:
      'Только вы и те кому вы дали доступ. Multi-tenant архитектура: ваши данные изолированы от других клубов на уровне базы. RLS-политики Supabase + ролевые проверки на каждом запросе.',
  },
  {
    question: 'Есть ли пробный период?',
    answer:
      'Первая точка — две недели бесплатно. Если не подойдёт — никаких обязательств. Все ваши данные можно выгрузить в Excel и забрать.',
  },
  {
    question: 'Как происходят обновления?',
    answer:
      'Веб-админка обновляется автоматически. Кассовая программа — при следующем запуске auto-update подхватит новую версию. Все обновления бесплатные.',
  },
  {
    question: 'Где сервер и насколько защищены данные?',
    answer:
      'Supabase Cloud (на инфраструктуре AWS). Бэкапы каждый день. Шифрование в покое и в передаче. Аудит каждой операции.',
  },
]

// ─────────────────────── РЕЗУЛЬТАТ ───────────────────────

const outcomes = [
  'Меньше ручных пересылок и сверок в конце смены',
  'Видно сразу: кто сколько должен и кому сколько платить',
  'Telegram становится частью процесса, а не дополнительным костылём',
  'Управленка собирается из тех же данных, на которых работает касса',
  'Расхождения находит health-check, а не вы при ревизии',
]

// ─────────────────────── СТРАНИЦА ───────────────────────

export default async function MarketingHomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_20%),linear-gradient(180deg,#050816_0%,#0a1020_48%,#050816_100%)] text-white">
      <WebsiteStructuredData />
      <FaqStructuredData faq={faqItems} />

      {/* ────────── Шапка ────────── */}
      <section className="mx-auto max-w-7xl px-6 pb-10 pt-8 sm:px-8 lg:px-10">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-base font-bold text-slate-950">
              ◇
            </div>
            <div>
              <div className="text-lg font-semibold">{SITE_NAME}</div>
              <div className="text-xs text-slate-400">Управление игровым клубом</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden sm:inline-flex text-slate-200">
              <Link href="#features">Возможности</Link>
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
      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
              <Sparkles className="h-3.5 w-3.5" />
              Для игровых клубов Казахстана
            </div>

            <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              Игровой клуб
              <span className="block bg-gradient-to-r from-amber-300 via-orange-300 to-amber-100 bg-clip-text text-transparent">
                без хаоса в кассе
              </span>
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-slate-300">
              Касса, склад, операторы и финансы в одной системе. С AI-помощником.
              С отчётами в Telegram. С киоском самообслуживания.
              Чтобы вы видели всё, не открывая ноутбук.
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
                  Попробовать бесплатно
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                <Link href="#screens">Посмотреть как работает</Link>
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {heroStats.map((s) => (
                <div key={s.label} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                  <div className="text-lg font-semibold text-amber-200">{s.value}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Визуал справа: имитация админки */}
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
            <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
                <span>Дашборд OrdaOps</span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                  ● live
                </span>
              </div>

              {/* Цифры */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Сегодня</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">220 625 ₸</div>
                  <div className="mt-1 text-[10px] text-emerald-300">+18% к среднему</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Маржа</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">42%</div>
                  <div className="mt-1 text-[10px] text-amber-300">стабильно</div>
                </div>
              </div>

              {/* AI блок */}
              <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
                  <Bot className="h-3.5 w-3.5" />
                  AI-наблюдение
                </div>
                <div className="mt-2 text-xs leading-5 text-amber-50/90">
                  За 7 дней маржа -3%. Главная причина: рост закупочной цены на колу
                  у поставщика «Алматы-Дрим» на 14%. Рекомендую найти альтернативу.
                </div>
              </div>

              {/* Telegram превью */}
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">📲 Telegram отчёт</div>
                <div className="mt-1 text-xs leading-5 text-slate-300">
                  <div className="font-semibold text-white">F16 Ramen · Ночь · Айгерим</div>
                  <div>Kaspi: 194 025 ₸ · Нал: 26 000 ₸</div>
                  <div className="text-emerald-300">✓ Без расхождений</div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ────────── Боли ────────── */}
      <section id="features" className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Каждый вечер одно и то же?
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Боли владельцев игровых клубов — и как мы их закрываем
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Ниже — реальные жалобы которые мы слышим от собственников. Под каждой —
            что конкретно делает OrdaOps.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {painPoints.map((p) => (
            <Card
              key={p.pain}
              className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] transition hover:border-amber-400/30"
            >
              <div className="text-3xl">{p.icon}</div>
              <h3 className="mt-3 text-lg font-semibold leading-tight">{p.pain}</h3>
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <div className="text-xs leading-5 text-emerald-100/90">{p.solution}</div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── Демо экранов ────────── */}
      <section id="screens" className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Что внутри
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Не «возможности», а конкретные экраны и сценарии
          </h2>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {productScreens.map((s) => (
            <Card
              key={s.title}
              className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)]"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-semibold">{s.title}</h3>
                <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                  {s.badge}
                </span>
              </div>
              <ul className="mt-5 space-y-2.5">
                {s.points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm leading-6 text-slate-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>

      {/* ────────── Сетка фич ────────── */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            12 контуров
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Полнее любого аналога в Казахстане
          </h2>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {featureGrid.map((f) => {
            const Icon = f.icon
            return (
              <Card
                key={f.title}
                className="border-white/10 bg-white/5 p-5 text-white transition hover:border-amber-400/30 hover:bg-white/[0.07]"
              >
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400/10 text-amber-200">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-4 text-sm font-semibold">{f.title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-400">{f.text}</div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* ────────── Сравнение ────────── */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Чем отличается от других
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Сравнение с популярными системами в Казахстане
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Большинство — либо узкие игровые (старые), либо общие POS (без специфики
            клуба). OrdaOps — единственный кто закрывает оба.
          </p>
        </div>

        <Card className="mt-8 overflow-hidden border-white/10 bg-black/20 p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="px-4 py-4 text-xs uppercase tracking-wide text-slate-400">
                    Система
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
                              ? c.highlight
                                ? 'text-emerald-300'
                                : 'text-emerald-300/70'
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
            ✓✓ — глубоко · ✓ — есть · △ — частично · — нет
          </div>
        </Card>
      </section>

      {/* ────────── Аудитории ────────── */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
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
      <section id="pricing" className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Цены
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Прозрачно, без «свяжитесь с менеджером для всех планов»
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Первая точка — две недели бесплатно. После — выберите подходящий план.
            Меняйте план в любой момент.
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
          Все планы включают: бесплатные обновления · поддержка через Telegram · ежедневные бэкапы
        </div>
      </section>

      {/* ────────── До / После ────────── */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-rose-500/20 bg-rose-500/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-rose-200">
              Без OrdaOps
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Процессы расползаются по чатам и таблицам
            </h2>
            <div className="mt-6 grid gap-3">
              {before.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-slate-300"
                >
                  ❌ {item}
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-emerald-500/20 bg-emerald-500/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-200">
              С OrdaOps
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Касса, склад, финансы и Telegram — одна экосистема
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
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <Card className="border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(255,255,255,0.03))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
                <TrendingUp className="h-3.5 w-3.5" />
                Что меняется
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
                Меньше хаоса, быстрее решения, понятные цифры
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                После внедрения у команды меньше ручной суеты, у владельца — больше контроля.
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
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
            Частые вопросы
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Всё что обычно спрашивают перед демо
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
      <section id="contact" className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
              Демо за 5 минут
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
              Покажу систему лично, по вашему случаю
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              15 минут — и вы поймёте подходит ли OrdaOps для вашего клуба.
              Покажу кассу, дашборд, Telegram-отчёты на реальных данных.
              Подскажу с переходом если уже используете другую систему.
            </p>

            <div className="mt-6 space-y-3 text-sm text-slate-300">
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>Подходит если есть точки, смены, операторы и хаос в отчётах</div>
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
      <section className="mx-auto max-w-7xl px-6 pb-20 sm:px-8 lg:px-10">
        <Card className="overflow-hidden border-amber-400/30 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(255,255,255,0.05))] p-10 text-white shadow-[0_24px_70px_rgba(245,158,11,0.18)] sm:p-12">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">
                Готовы избавиться от хаоса в кассе?
              </h2>
              <p className="mt-3 text-base leading-7 text-slate-200">
                Две недели бесплатно. Без обязательств. Если не подойдёт — заберёте
                все ваши данные в Excel.
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
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 sm:px-8 md:grid-cols-4 lg:px-10">
          <div>
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500 text-sm font-bold text-slate-950">◇</div>
              <span className="font-semibold">{SITE_NAME}</span>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Система управления игровым клубом. Касса, склад, финансы, AI и Telegram в одной системе.
            </p>
            <p className="mt-3 text-xs text-slate-500">🇰🇿 Сделано в Казахстане</p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">Продукт</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li><Link href="#features" className="hover:text-amber-200">Возможности</Link></li>
              <li><Link href="#screens" className="hover:text-amber-200">Экраны</Link></li>
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
