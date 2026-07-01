import type { Metadata } from 'next'
import { Fragment } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  BadgePercent,
  Bot,
  Boxes,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudOff,
  Eye,
  FileCheck,
  GraduationCap,
  HelpCircle,
  LineChart,
  Scale,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  Wallet,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ContactLeadForm } from '@/components/public/contact-lead-form'
import { FloatingCta } from '@/components/public/floating-cta'
import { FaqStructuredData, WebsiteStructuredData } from '@/components/public/structured-data'
import { CountUp, HeroIn, LiveDot, Reveal, Stagger, StaggerItem } from '@/components/public/landing-motion'
import { CopilotDemo, FeatureMarquee, GrowBars, InsightTicker, OfflineDemo, ScrollProgress, TelegramDemo } from '@/components/public/landing-demos'

export const metadata: Metadata = {
  title: 'Orda Control — касса, склад, зарплаты и AI-управление бизнесом',
  description:
    'Система управления точкой продаж: POS с офлайн-режимом, склад с приёмкой по фото, смены, зарплаты, Telegram-бот и AI-копилот. Для магазинов, кафе, компьютерных клубов и сервисов в Казахстане.',
}

const PRODUCT = 'Orda Control'

// ─────────── ДИЗАЙН-СИСТЕМА v2: широкий экран, плотная bento-сетка ───────────
// Белый фон, navy #0f2038, зелёный #16a34a. Контейнер 1500px, компактные секции.

const container = 'mx-auto w-full max-w-[1500px] px-5 sm:px-8 lg:px-12'
const eyebrowClass =
  'inline-flex items-center gap-2 rounded-full border border-[#16a34a]/25 bg-[#16a34a]/[0.07] px-4 py-1.5 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-[#15803d]'
const h2Class =
  'font-display text-balance text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-[#0f2038] sm:text-[38px] lg:text-[42px]'
const leadClass = 'text-pretty text-[17px] leading-[1.55] text-[#56657d] sm:text-[19px]'
const bentoCard =
  'relative flex h-full flex-col overflow-hidden rounded-[22px] border border-[#dbe3ee] bg-white p-6 shadow-[0_10px_30px_-18px_rgba(15,32,56,0.2)] transition duration-300 hover:border-[#16a34a]/35 sm:p-7'
const bentoTitle = 'font-display text-[19px] font-bold leading-[1.25] tracking-[-0.01em] text-[#0f2038] sm:text-[21px]'
const bentoText = 'mt-1.5 text-[14px] leading-[1.55] text-[#56657d]'
const btnPrimary =
  'rounded-[14px] bg-gradient-to-br from-[#1db955] to-[#15803d] px-8 py-[15px] text-[16.5px] font-semibold text-white shadow-[0_12px_28px_-8px_rgba(22,163,74,0.5)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-8px_rgba(22,163,74,0.6)]'
const btnGhost =
  'rounded-[14px] border border-[#c8d1de] bg-white px-8 py-[15px] text-[16.5px] font-semibold text-[#0f2038] transition hover:border-[#16a34a]/40 hover:text-[#15803d]'

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

const audiences = ['Магазины', 'Компьютерные клубы', 'Кафе и точки еды', 'Сервисные центры', 'Студии услуг', 'Склады и точки']

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
  { criterion: 'Контроль недостач', values: { excel: 'Вручную', oneC: '—', poster: '—', orda: 'Слепые ревизии' } },
  { criterion: 'Расчёт зарплат', values: { excel: 'Руками', oneC: 'Настройка', poster: 'Интеграции', orda: 'Ставка · % · KPI' } },
  { criterion: 'AI-анализ и действия', values: { excel: '—', oneC: '—', poster: 'Минимально', orda: 'Анализ + копилот' } },
  { criterion: 'Telegram-бот', values: { excel: '—', oneC: '—', poster: '—', orda: 'Отчёты и управление' } },
]

const pricingPlans = [
  { name: 'Start', levelLabel: 'Базовый', description: 'Видеть основные финансовые показатели.', features: ['Финансовый дашборд', 'Доходы и расходы', 'Отчёты по периодам', 'Telegram-отчёты владельцу'], cta: 'Попробовать', highlight: false },
  { name: 'Business', levelLabel: 'Оптимальный', description: 'Сотрудники, смены и ежедневная работа.', features: ['Всё из Start', 'Смены и сверка кассы', 'Зарплата: ставка, %, KPI', 'AI-разборы показателей'], cta: 'Выбрать Business', highlight: true, badge: 'Популярный' },
  { name: 'Pro', levelLabel: 'Продвинутый', description: 'Полноценная система продаж и склада.', features: ['Всё из Business', 'POS с офлайн-режимом', 'Склад и приёмка по фото', 'Ревизии и лояльность', 'AI-копилот и AI-финдиректор'], cta: 'Выбрать Pro', highlight: false },
  { name: 'Enterprise', levelLabel: 'Индивидуальный', description: 'Сети и несколько филиалов.', features: ['Несколько точек', 'Роли и права', 'Настройка модулей', 'Персональное внедрение'], cta: 'Связаться', highlight: false },
]

const faqItems = [
  { question: 'Работает ли касса без интернета?', answer: 'Да. При потере сети касса продолжает продавать: продажи, возвраты и отчёты копятся в локальную очередь и синхронизируются, когда интернет вернётся. Чек печатается и офлайн.' },
  { question: 'Чеки легальны для налоговой?', answer: 'Чеки печатаются с фискальными реквизитами ККМ по требованиям приказа МФ РК №626: БИН/ИИН, номера ККМ, НДС, ОФД. Плюс встроенный калькулятор налогов ИП: упрощёнка и форма 910.' },
  { question: `Чем ${PRODUCT} отличается от 1С и Poster?`, answer: `1С — учёт для бухгалтерии, Poster — касса. ${PRODUCT} — управление бизнесом целиком: касса, склад, смены, зарплаты, AI и Telegram в одной системе. Можно работать и в дополнение к ним.` },
  { question: 'AI правда работает?', answer: 'AI видит ваши данные: выручку, расходы, маржу, склад. Отвечает на вопросы, находит аномалии и выполняет действия: премии, промокоды, приёмки по фото накладной. Всё с учётом прав и записью в журнал.' },
  { question: 'Что нужно установить?', answer: `На кассе (Windows) — наше приложение, оно обновляется само. У владельца и сотрудников — ничего: кабинет открывается в браузере и на телефоне. ${PRODUCT} полностью облачный.` },
  { question: 'Есть пробный период?', answer: 'Первая точка — 2 недели бесплатно с полным доступом. Не подойдёт — данные можно выгрузить. Без обязательств.' },
]

// ─────────────────────── СТРАНИЦА ───────────────────────

export default async function MarketingHomePage() {
  return (
    <main className="min-h-screen bg-white pb-[76px] text-[#0f2038] sm:pb-0">
      <WebsiteStructuredData />
      <FaqStructuredData faq={faqItems} />
      <ScrollProgress />

      {/* Шапка */}
      <header className="sticky top-0 z-50 border-b border-[#e2e8f0] bg-white/80 backdrop-blur-xl">
        <div className={`${container} flex items-center justify-between py-3`}>
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

      {/* HERO — по центру, широкая живая панель снизу */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(15,32,56,0.08) 1px, transparent 1px)',
              backgroundSize: '26px 26px',
              maskImage: 'radial-gradient(75% 65% at 50% 0%, black, transparent)',
              WebkitMaskImage: 'radial-gradient(75% 65% at 50% 0%, black, transparent)',
            }}
          />
          <div className="absolute -top-32 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-[#16a34a]/[0.09] blur-[130px]" />
        </div>
        <div className={`${container} relative pb-14 pt-14 lg:pb-20 lg:pt-20`}>
          <HeroIn className="mx-auto max-w-[860px] text-center">
            <div className={eyebrowClass}><Sparkles className="h-3.5 w-3.5" />Система управления бизнесом</div>
            <h1 className="mt-6 font-display text-[42px] font-extrabold leading-[1.04] tracking-[-0.03em] text-[#0f2038] sm:text-[58px] lg:text-[72px]">
              Весь бизнес <span className="bg-gradient-to-r from-[#16a34a] to-[#22c55e] bg-clip-text text-transparent">под контролем</span>
            </h1>
            <p className={`mx-auto mt-5 max-w-[640px] ${leadClass}`}>
              Касса с офлайн-режимом, склад, смены, зарплаты, Telegram-бот и AI-копилот — в одной системе. Прибыль видна каждый день.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className={btnPrimary}><Link href="#contact">Начать бесплатно<ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
              <Button asChild size="lg" variant="outline" className={btnGhost}><Link href="#features">Возможности</Link></Button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[14px] font-medium text-[#5b6b82]">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />2 недели бесплатно</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />Касса работает без интернета</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />Чеки по требованиям РК</span>
            </div>
          </HeroIn>

          {/* Широкая live-панель */}
          <HeroIn delay={0.15} className="mt-12 lg:mt-16">
            <div className="mx-auto max-w-[1240px] rounded-[24px] border border-[#d6dde8] bg-white p-4 shadow-[0_40px_90px_-36px_rgba(15,32,56,0.45)] sm:p-5">
              <div className="rounded-[18px] border border-[#e2e8f0] bg-[#eef2f8] p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">Финансовый дашборд</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#16a34a]/[0.1] px-2.5 py-1 text-[11px] font-semibold uppercase text-[#15803d]">
                    <LiveDot className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />live
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Выручка за день" value={412800} unit="₸" delta="+8%" up />
                  <StatCard label="Маржа" value={38} suffix="%" delta="−1.4%" />
                  <StatCard label="Прибыль за месяц" value={1960000} unit="₸" delta="+12%" up />
                  <StatCard label="ФОТ" value={540000} unit="₸" delta="0%" />
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
                  <div className="rounded-[14px] border border-[#e2e8f0] bg-white p-4">
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
                  <div className="rounded-[14px] border border-[#16a34a]/20 bg-[#16a34a]/[0.05] p-4">
                    <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#15803d]"><Bot className="h-4 w-4" />AI-наблюдение</div>
                    <InsightTicker items={heroInsights} className="mt-2 min-h-[62px]" />
                  </div>
                </div>
              </div>
            </div>
          </HeroIn>
        </div>
      </section>

      {/* СОЦ-ДОКАЗАТЕЛЬСТВО + MARQUEE */}
      <div className="border-y border-[#e2e8f0] bg-[#f7f9fc] py-5">
        <Reveal className={`${container} flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[14.5px] font-medium text-[#5b6b82]`}>
          <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
          Уже считает финансы сети <span className="font-bold text-[#0f2038]">F16</span>
          <span className="text-[#cbd3e0]">·</span>
          <span className="font-semibold text-[#475569]">Arena · Ramen · Extra</span>
        </Reveal>
        <div className="mt-4"><FeatureMarquee items={marqueeFeatures} /></div>
      </div>

      {/* BENTO: вся система на одном экране */}
      <section id="features" className="scroll-mt-20">
        <div className={`${container} py-16 lg:py-20`}>
          <Reveal className="mx-auto max-w-[760px] text-center">
            <div className={eyebrowClass}><Boxes className="h-3.5 w-3.5" />Что внутри</div>
            <h2 className={`mt-4 ${h2Class}`}>Одна система вместо пяти программ</h2>
            <p className={`mt-3 ${leadClass}`}>Касса, склад, команда, финансы и AI связаны между собой: продажа сразу меняет остатки, смену и прибыль.</p>
          </Reveal>

          <Stagger className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-12">
            {/* AI-копилот — большая карта */}
            <StaggerItem className="md:col-span-2 lg:col-span-7">
              <div className={bentoCard}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className={bentoTitle}>AI-копилот: не советует — делает</h3>
                    <p className={bentoText}>Напишите как человеку: начислит премию, создаст промокод, оприходует накладную, объяснит падение маржи.</p>
                  </div>
                  <span className="hidden shrink-0 rounded-full bg-[#16a34a]/10 px-3 py-1.5 text-[12px] font-bold text-[#15803d] sm:block"><CountUp value={110} suffix="+" /> действий</span>
                </div>
                <div className="mt-5 flex-1"><CopilotDemo /></div>
              </div>
            </StaggerItem>

            {/* Telegram — высокая карта */}
            <StaggerItem className="md:col-span-2 lg:col-span-5 lg:row-span-2">
              <div className={bentoCard}>
                <h3 className={bentoTitle}>Telegram-бот: бизнес в мессенджере</h3>
                <p className={bentoText}>Фото накладной → готовая приёмка. Итоги дня — каждое утро. Зарплата — сотрудникам в личку. Вопросы — своими словами.</p>
                <div className="mt-5 flex-1"><TelegramDemo /></div>
              </div>
            </StaggerItem>

            {/* Офлайн-касса */}
            <StaggerItem className="lg:col-span-4">
              <div className={bentoCard}>
                <div className="flex items-center gap-2 text-[#15803d]"><CloudOff className="h-5 w-5" /></div>
                <h3 className={`mt-3 ${bentoTitle}`}>Касса без интернета</h3>
                <p className={bentoText}>Сеть упала — торговля идёт. Продажи копятся в очередь и синхронизируются сами. Чеки ККМ и ОФД по приказу МФ РК №626.</p>
                <div className="mt-4"><OfflineDemo /></div>
              </div>
            </StaggerItem>

            {/* Контроль — тёмная карта */}
            <StaggerItem className="lg:col-span-3">
              <div className="relative flex h-full flex-col overflow-hidden rounded-[22px] border border-[#0f2038] bg-[#0f2038] p-6 shadow-[0_10px_30px_-18px_rgba(15,32,56,0.5)] sm:p-7">
                <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
                <div className="relative">
                  <ShieldCheck className="h-5 w-5 text-[#4ade80]" />
                  <h3 className="mt-3 font-display text-[19px] font-bold leading-[1.25] text-white sm:text-[21px]">Недостачу не спрятать</h3>
                  <ul className="mt-4 space-y-3">
                    {[
                      { icon: Eye, text: 'Слепые ревизии: считают, не видя остаток' },
                      { icon: Wallet, text: 'Недостача — долгом из зарплаты' },
                      { icon: AlertCircle, text: 'Сигнал о воровстве владельцу' },
                      { icon: FileCheck, text: 'Журнал аудита: кто что менял' },
                    ].map((f) => {
                      const Icon = f.icon
                      return (
                        <li key={f.text} className="flex items-start gap-2.5 text-[13.5px] leading-[1.5] text-[#c3d0e2]">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#4ade80]" />{f.text}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            </StaggerItem>

            {/* Склад и закуп */}
            <StaggerItem className="lg:col-span-4">
              <div className={bentoCard}>
                <div className="flex items-center gap-2 text-[#15803d]"><Camera className="h-5 w-5" /></div>
                <h3 className={`mt-3 ${bentoTitle}`}>Склад сам говорит, что закупать</h3>
                <p className={bentoText}>AI распознаёт фото накладной. План закупа — по продажам и остаткам, с автозаявками поставщикам.</p>
                <div className="mt-4 space-y-2">
                  {[
                    { name: 'Энергетик 0,45 л', note: 'осталось на 3 дня', qty: '4 уп.' },
                    { name: 'Вода 0,5 л', note: 'точка дозаказа', qty: '6 уп.' },
                    { name: 'Жев. резинка', note: 'спрос +18%', qty: '2 уп.' },
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
            </StaggerItem>

            {/* Команда и зарплата */}
            <StaggerItem className="lg:col-span-4">
              <div className={bentoCard}>
                <div className="flex items-center gap-2 text-[#15803d]"><Smartphone className="h-5 w-5" /></div>
                <h3 className={`mt-3 ${bentoTitle}`}>Зарплата и смены — без споров</h3>
                <p className={bentoText}>Ставка, процент, KPI, бонусы и штрафы считаются сами. У сотрудника — кабинет в телефоне.</p>
                <div className="mt-4 rounded-[14px] border border-[#e2e8f0] bg-[#f7f9fc] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748b]">К выплате за неделю</div>
                  <div className="mt-1 font-display text-[24px] font-extrabold text-[#0f2038] tabular-nums">86 400 ₸</div>
                  <div className="mt-0.5 text-[11.5px] text-[#64748b]">5 смен · бонус за оборот · −1 долг</div>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-[11px] bg-[#f7f9fc] px-3.5 py-2.5 text-[13px]">
                  <span className="font-semibold text-[#0f2038]">Смена завтра · 09:00</span>
                  <span className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#15803d]">Подтверждена</span>
                </div>
              </div>
            </StaggerItem>

            {/* Финансы владельца */}
            <StaggerItem className="lg:col-span-4">
              <div className={bentoCard}>
                <div className="flex items-center gap-2 text-[#15803d]"><LineChart className="h-5 w-5" /></div>
                <h3 className={`mt-3 ${bentoTitle}`}>Цифры уровня финдиректора</h3>
                <p className={bentoText}>ОПиУ, Cash Flow, налоги ИП (форма 910), оценка бизнеса и финмодель новой точки.</p>
                <div className="mt-4 space-y-2">
                  {[
                    { name: 'Выручка', sum: '12 480 000 ₸', strong: false },
                    { name: 'Расходы и ФОТ', sum: '−10 520 000 ₸', strong: false },
                    { name: 'Чистая прибыль', sum: '1 960 000 ₸', strong: true },
                  ].map((l) => (
                    <div key={l.name} className={`flex items-center justify-between rounded-[11px] px-3.5 py-2.5 text-[13px] ${l.strong ? 'bg-[#16a34a]/[0.07] font-bold text-[#15803d]' : 'bg-[#f7f9fc] text-[#0f2038]'}`}>
                      <span>{l.name}</span>
                      <span className="font-semibold tabular-nums">{l.sum}</span>
                    </div>
                  ))}
                </div>
              </div>
            </StaggerItem>

            {/* Лояльность */}
            <StaggerItem className="lg:col-span-4">
              <div className={bentoCard}>
                <div className="flex items-center gap-2 text-[#15803d]"><BadgePercent className="h-5 w-5" /></div>
                <h3 className={`mt-3 ${bentoTitle}`}>Клиенты возвращаются</h3>
                <p className={bentoText}>Бонусные баллы, промокоды, акции и смешанная оплата. Сегментация клиентов — кого удерживать, кого возвращать.</p>
                <div className="mt-4 flex items-center justify-between rounded-[14px] border border-[#e2e8f0] bg-[#f7f9fc] p-4 text-[13px]">
                  <div>
                    <div className="font-semibold text-[#0f2038]">Чек 3 640 ₸ · нал + Kaspi</div>
                    <div className="mt-0.5 text-[11.5px] text-[#15803d]">Клиенту начислено 36 бонусов</div>
                  </div>
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[#16a34a]" />
                </div>
              </div>
            </StaggerItem>

            {/* Обучение команды */}
            <StaggerItem className="lg:col-span-4">
              <div className={bentoCard}>
                <div className="flex items-center gap-2 text-[#15803d]"><GraduationCap className="h-5 w-5" /></div>
                <h3 className={`mt-3 ${bentoTitle}`}>Новички учатся сами</h3>
                <p className={bentoText}>База знаний с обязательным подтверждением, AI-квизы по правилам, чек-листы смены с авто-штрафами и премиями.</p>
                <div className="mt-4 flex items-center justify-between rounded-[14px] border border-[#e2e8f0] bg-[#f7f9fc] p-4 text-[13px]">
                  <div>
                    <div className="font-semibold text-[#0f2038]">Квиз по стандартам смены</div>
                    <div className="mt-0.5 text-[11.5px] text-[#64748b]">5 вопросов · сгенерирован AI</div>
                  </div>
                  <span className="rounded-full bg-[#16a34a]/10 px-2.5 py-1 text-[11.5px] font-bold text-[#15803d]">5/5</span>
                </div>
              </div>
            </StaggerItem>
          </Stagger>

          {/* Цифры-факты */}
          <Stagger className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { value: 110, suffix: '+', label: 'действий AI-копилота' },
              { value: 90, suffix: '+', label: 'экранов управления' },
              { value: 9, suffix: '', label: 'формул аналитики: ABC, RFM, EOQ…' },
              { value: 24, suffix: '/7', label: 'Telegram-бот на связи' },
            ].map((n) => (
              <StaggerItem key={n.label}>
                <div className="flex h-full items-center gap-4 rounded-[18px] border border-[#dbe3ee] bg-[#f7f9fc] px-5 py-4">
                  <span className="font-display text-[30px] font-extrabold tracking-[-0.02em] text-[#15803d] sm:text-[34px]"><CountUp value={n.value} suffix={n.suffix} /></span>
                  <span className="text-[13px] font-medium leading-[1.35] text-[#56657d]">{n.label}</span>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* СРАВНЕНИЕ */}
      <section className="border-y border-[#e2e8f0] bg-[#f7f9fc]">
        <div className={`${container} py-16 lg:py-20`}>
          <Reveal className="mx-auto max-w-[760px] text-center">
            <div className={eyebrowClass}><Scale className="h-3.5 w-3.5" />Сравнение</div>
            <h2 className={`mt-4 ${h2Class}`}>Excel, 1С и кассы решают по куску</h2>
            <p className={`mt-3 ${leadClass}`}>Orda собирает всё в одном месте — и подходит: {audiences.join(' · ').toLowerCase()}.</p>
          </Reveal>
          <Reveal className="mt-10 hidden overflow-hidden rounded-[18px] border border-[#d6dde8] bg-white lg:block">
            <div className="grid" style={{ gridTemplateColumns: `minmax(220px,1.2fr) repeat(${comparisonColumns.length}, minmax(150px,1fr))` }}>
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
          <Stagger className="mt-10 grid gap-3 sm:grid-cols-2 lg:hidden">
            {comparisonColumns.map((col) => (
              <StaggerItem key={col.key}>
                <div className={col.highlight ? 'h-full rounded-[18px] border-2 border-[#16a34a]/40 bg-white p-5' : 'h-full rounded-[18px] border border-[#d6dde8] bg-white p-5'}>
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
      <section id="pricing" className="scroll-mt-20">
        <div className={`${container} py-16 lg:py-20`}>
          <Reveal className="mx-auto max-w-[760px] text-center">
            <div className={eyebrowClass}><Tag className="h-3.5 w-3.5" />Тарифы</div>
            <h2 className={`mt-4 ${h2Class}`}>Подключайте только нужное</h2>
            <p className={`mt-3 ${leadClass}`}>Цена зависит от числа точек и модулей — посчитаем индивидуально за 5 минут.</p>
          </Reveal>
          <Stagger className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {pricingPlans.map((plan) => (
              <StaggerItem key={plan.name}>
                <div className={plan.highlight
                  ? 'relative flex h-full flex-col rounded-[20px] border-2 border-[#16a34a]/45 bg-white p-7 shadow-[0_24px_54px_-18px_rgba(22,163,74,0.45)] transition-transform duration-300 hover:-translate-y-3 xl:-translate-y-2'
                  : 'flex h-full flex-col rounded-[20px] border border-[#d6dde8] bg-white p-7 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)] transition duration-300 hover:-translate-y-1'}>
                  {plan.highlight && plan.badge ? <span className="absolute right-5 top-5 rounded-full bg-gradient-to-br from-[#fb923c] to-[#f97316] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_6px_16px_-6px_rgba(249,115,22,0.6)]">{plan.badge}</span> : null}
                  <div className={'text-[11px] font-semibold uppercase tracking-[0.12em] ' + (plan.highlight ? 'text-[#15803d]' : 'text-[#64748b]')}>{plan.levelLabel}</div>
                  <div className="mt-1.5 font-display text-[26px] font-bold text-[#0f2038]">{plan.name}</div>
                  <p className="mt-2 text-[14px] leading-[1.5] text-[#56657d]">{plan.description}</p>
                  <ul className="mt-5 flex-1 space-y-2.5 border-t border-[#e2e8f0] pt-5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[14px] leading-[1.5] text-[#475569]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" /><span>{f}</span></li>
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
        </div>
      </section>

      {/* FAQ + CTA в одном экране */}
      <section id="contact" className="scroll-mt-20 border-t border-[#e2e8f0] bg-[#f7f9fc]">
        <div className={`${container} py-16 lg:py-20`}>
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
            <div>
              <Reveal>
                <div className={eyebrowClass}><HelpCircle className="h-3.5 w-3.5" />Частые вопросы</div>
                <h2 className={`mt-4 ${h2Class}`}>Что спрашивают чаще всего</h2>
              </Reveal>
              <Stagger className="mt-8 space-y-3">
                {faqItems.map((item) => (
                  <StaggerItem key={item.question}>
                    <details className="group rounded-[16px] border border-[#d6dde8] bg-white px-5 py-4 transition-colors duration-300 hover:border-[#16a34a]/30 open:border-[#16a34a]/30 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                        <h3 className="font-display text-[16px] font-bold leading-[1.35] text-[#0f2038]">{item.question}</h3>
                        <ChevronDown className="h-5 w-5 shrink-0 text-[#16a34a] transition-transform duration-300 group-open:rotate-180" />
                      </summary>
                      <p className="mt-2.5 text-[14px] leading-[1.6] text-[#56657d]">{item.answer}</p>
                    </details>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>
            <Reveal delay={0.1}>
              <div className="lg:sticky lg:top-24">
                <div className="rounded-[22px] border border-[#16a34a]/25 bg-white p-7 shadow-[0_24px_60px_-28px_rgba(22,163,74,0.4)] sm:p-8">
                  <div className={eyebrowClass}><Sparkles className="h-3.5 w-3.5" />Начните сегодня</div>
                  <h3 className="mt-4 font-display text-[24px] font-bold leading-[1.2] text-[#0f2038] sm:text-[27px]">Покажем систему на ваших данных</h3>
                  <p className="mt-2 text-[14px] leading-[1.55] text-[#56657d]">Оставьте контакты — ответим в течение рабочего дня и подскажем тариф. Без спама и звонков-роботов.</p>
                  <div className="mt-5"><ContactLeadForm /></div>
                  <div className="mt-5 space-y-2 border-t border-[#e2e8f0] pt-4">
                    {[
                      { icon: Wallet, text: 'Прибыль и маржа в реальном времени' },
                      { icon: CloudOff, text: 'Касса работает даже без интернета' },
                      { icon: Building2, text: 'Несколько точек на одной системе' },
                      { icon: ShieldCheck, text: 'Данные изолированы, журнал аудита' },
                    ].map((f) => {
                      const Icon = f.icon
                      return (
                        <div key={f.text} className="flex items-center gap-2.5 text-[13px] font-medium text-[#475569]">
                          <Icon className="h-4 w-4 shrink-0 text-[#16a34a]" />{f.text}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ФУТЕР */}
      <footer className="border-t border-[#e2e8f0] bg-white">
        <div className={`${container} py-10`}>
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
