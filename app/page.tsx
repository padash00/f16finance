import type { Metadata } from 'next'
import { Fragment } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  Brain,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock4,
  Coffee,
  Cpu,
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
import { ContactLeadForm } from '@/components/public/contact-lead-form'
import { FloatingCta } from '@/components/public/floating-cta'
import { FaqStructuredData, WebsiteStructuredData } from '@/components/public/structured-data'
import { CountUp, Floating, HeroIn, LiveDot, Reveal, Stagger, StaggerItem } from '@/components/public/landing-motion'

export const metadata: Metadata = {
  title: 'Orda Control — финансовая управляемость бизнеса без Excel и хаоса',
  description:
    'Система для продаж, смен, склада, расходов, зарплат, Telegram-отчётов и AI-аналитики. Подходит магазинам, компьютерным клубам, кафе, сервисам, студиям и бизнесам с кассой, сотрудниками и товарным учётом.',
}

const PRODUCT = 'Orda Control'

// ─────────── СВЕТЛАЯ ДИЗАЙН-СИСТЕМА (Stripe/Linear-style) ───────────
// Белый фон, navy-заголовки (#0f2038), зелёный акцент (#16a34a), мягкие серые блоки.

const eyebrowClass =
  'inline-flex items-center gap-2 rounded-full border border-[#16a34a]/25 bg-[#16a34a]/[0.07] px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#15803d]'
const h1Class =
  'font-display text-[46px] font-extrabold leading-[1.04] tracking-[-0.03em] text-[#0f2038] sm:text-[60px] lg:text-[72px]'
const h2Class =
  'font-display text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-[#0f2038] sm:text-[42px] lg:text-[48px]'
const leadClass = 'text-[19px] leading-[1.6] text-[#56657d] sm:text-[21px]'
const sectionClass = 'mx-auto max-w-[1600px] px-6 py-20 sm:px-10 lg:py-24 lg:px-14'
const cardClass = 'rounded-[20px] border border-[#d6dde8] bg-white p-7 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]'
const btnPrimary =
  'rounded-[14px] bg-gradient-to-br from-[#1db955] to-[#15803d] px-8 py-[16px] text-[17px] font-semibold text-white shadow-[0_12px_28px_-8px_rgba(22,163,74,0.5)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-8px_rgba(22,163,74,0.6)]'
const btnGhost =
  'rounded-[14px] border border-[#c8d1de] bg-white px-8 py-[16px] text-[17px] font-semibold text-[#0f2038] transition hover:border-[#16a34a]/40 hover:text-[#15803d]'

// ─────────────── ДАННЫЕ ───────────────

const painPoints = [
  { pain: 'Прибыль видно только после закрытия месяца', solution: 'P&L и маржа считаются автоматически после каждой смены.' },
  { pain: 'Маржа упала — непонятно почему', solution: 'AI показывает причину: закупка, расходы, наценка или продажи.' },
  { pain: 'Смена закрылась с расхождением', solution: 'Автосверка нал / безнал / онлайн — расхождение видно сразу.' },
  { pain: 'Зарплата — споры и ручные пересчёты', solution: 'Авторасчёт: ставка, процент, KPI, бонусы и штрафы.' },
  { pain: 'Не на месте, но хочу видеть цифры', solution: 'После каждой смены — Telegram-отчёт с итогами.' },
  { pain: 'Накладные проверять некогда', solution: 'AI распознаёт фото счёта и добавляет товары в приёмку.' },
]

const pillars = [
  { icon: PiggyBank, title: 'Финансы бизнеса', subtitle: 'P&L, маржа и прибыль каждый день, а не в конце месяца.' },
  { icon: Brain, title: 'AI-помощник', subtitle: 'Находит аномалии, объясняет тренды, даёт рекомендации.' },
  { icon: Clock4, title: 'Смены без хаоса', subtitle: 'Открытие, авто-сверка кассы и Z-отчёт после смены.' },
  { icon: Boxes, title: 'Склад и продажи', subtitle: 'POS, остатки, приёмка с AI и ревизия.' },
]

const steps = [
  { icon: Cpu, title: 'Подключаете точку', text: 'Настроим кассу и кабинет за день — без своих серверов и баз.', tone: 'green' as const },
  { icon: LineChart, title: 'Видите финансы каждый день', text: 'Прибыль, маржа, смены и расхождения — в реальном времени.', tone: 'green' as const },
  { icon: Bot, title: 'Решаете по цифрам', text: 'AI подсказывает, где теряете деньги и где можно заработать.', tone: 'orange' as const },
]

const aiCapabilities = [
  { icon: LineChart, title: 'Финансовая аналитика', text: 'почему снизилась маржа и где теряются деньги' },
  { icon: Activity, title: 'Прогноз на 90 дней', text: 'с подсветкой аномалий и отклонений' },
  { icon: Receipt, title: 'Распознавание накладных', text: 'фото счёта автоматически попадает в приёмку' },
  { icon: Users, title: 'Анализ сотрудников', text: 'средний чек, продажи, смены, эффективность' },
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
  { criterion: 'Сверка кассы по сменам', values: { excel: 'Нет', oneC: 'Сложно', poster: 'Базово', orda: 'Авто-сверка' } },
  { criterion: 'Расчёт зарплат', values: { excel: 'Руками', oneC: 'Настройка', poster: 'Интеграции', orda: 'Ставка · % · KPI' } },
  { criterion: 'AI-анализ показателей', values: { excel: '—', oneC: '—', poster: 'Минимально', orda: 'Тренды и аномалии' } },
  { criterion: 'Telegram-отчёты', values: { excel: '—', oneC: '—', poster: '—', orda: 'После смены' } },
  { criterion: 'Склад / витрина', values: { excel: 'Ручной', oneC: 'Модуль', poster: 'Базовый', orda: 'Раздельные балансы' } },
]

const pricingPlans = [
  { name: 'Start', levelLabel: 'Базовый', description: 'Видеть основные финансовые показатели.', features: ['Финансовый дашборд', 'Доходы и расходы', 'Отчёты по периодам', 'Контроль прибыли и маржи'], cta: 'Попробовать', highlight: false },
  { name: 'Business', levelLabel: 'Оптимальный', description: 'Сотрудники, смены и ежедневная работа.', features: ['Всё из Start', 'Закрытие смен', 'Учёт сотрудников', 'Расчёт зарплат', 'AI-анализ показателей'], cta: 'Выбрать Business', highlight: true, badge: 'Популярный' },
  { name: 'Pro', levelLabel: 'Продвинутый', description: 'Полноценная система продаж и склада.', features: ['Всё из Business', 'POS / продажи', 'Склад и витрина', 'Приёмка с AI', 'Расширенный AI'], cta: 'Выбрать Pro', highlight: false },
  { name: 'Enterprise', levelLabel: 'Индивидуальный', description: 'Сети и несколько филиалов.', features: ['Несколько компаний', 'Роли и доступы', 'Индивидуальная настройка', 'Персональное внедрение'], cta: 'Связаться', highlight: false },
]

const faqItems = [
  { question: `Чем ${PRODUCT} отличается от 1С?`, answer: `1С — учёт для бухгалтерии. ${PRODUCT} — операционно-финансовая платформа: смены, касса, AI, Telegram. Вы видите финансы каждый день, а не закрываете месяц задним числом.` },
  { question: 'А если я уже использую Wipon или Poster?', answer: `Можно работать в дополнение: касса в Wipon, а финансы и смены — в ${PRODUCT}. Или перейти полностью — поможем с миграцией.` },
  { question: 'AI правда работает?', answer: 'AI видит ваши данные: выручку, расходы, маржу, склад. Находит аномалии, объясняет тренды и даёт рекомендации с числами.' },
  { question: 'Что нужно установить?', answer: `На кассе (Windows) — наше приложение. На телефоне — ничего, кабинет в браузере. ${PRODUCT} полностью облачный.` },
  { question: 'Кто видит мои данные?', answer: 'Только вы и те, кому вы дали доступ. Данные каждой компании изолированы. Журнал аудита на каждое действие.' },
  { question: 'Есть пробный период?', answer: 'Первая точка — 2 недели бесплатно с полным доступом. Не подойдёт — данные можно выгрузить в Excel. Без обязательств.' },
]

// ─────────────────────── СТРАНИЦА ───────────────────────

export default async function MarketingHomePage() {
  return (
    <main className="min-h-screen bg-white pb-[76px] text-[#0f2038] sm:pb-0">
      <WebsiteStructuredData />
      <FaqStructuredData faq={faqItems} />

      {/* Шапка */}
      <header className="sticky top-0 z-50 border-b border-[#e2e8f0] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3.5 sm:px-10 lg:px-12">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#16a34a] text-[15px] font-bold text-white">◇</div>
            <div>
              <div className="font-display text-[16px] font-bold tracking-[-0.02em] text-[#0f2038]">{PRODUCT}</div>
              <div className="hidden text-[11px] font-medium text-[#64748b] sm:block">Финансы, продажи и смены</div>
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
            <Button asChild className="rounded-[12px] bg-[#16a34a] px-5 py-2 text-[14px] font-semibold text-white hover:bg-[#15803d]">
              <Link href="#contact">Попробовать<ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden bg-[radial-gradient(60%_60%_at_50%_0%,rgba(22,163,74,0.06),transparent)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 right-[-6%] h-[440px] w-[440px] rounded-full bg-[#16a34a]/[0.08] blur-[130px]" />
          <div className="absolute top-[18%] left-[-8%] h-[380px] w-[380px] rounded-full bg-[#f97316]/[0.06] blur-[130px]" />
        </div>
        <div className="relative mx-auto max-w-[1600px] px-6 pb-20 pt-14 sm:px-10 lg:px-12 lg:pb-28 lg:pt-20">
          <div className="grid gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
            <HeroIn className="max-w-[600px]">
              <div className={eyebrowClass}><Sparkles className="h-3.5 w-3.5" />Финансовая управляемость</div>
              <h1 className={`mt-6 ${h1Class}`}>
                Финансы бизнеса <span className="bg-gradient-to-r from-[#16a34a] to-[#22c55e] bg-clip-text text-transparent">под контролем</span>
              </h1>
              <p className={`mt-5 max-w-[500px] ${leadClass}`}>
                Продажи, смены, склад, зарплаты и AI-аналитика — в одной системе. Прибыль видна каждый день.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className={btnPrimary}><Link href="#contact">Начать бесплатно<ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
                <Button asChild size="lg" variant="outline" className={btnGhost}><Link href="#features">Возможности</Link></Button>
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px] font-medium text-[#5b6b82]">
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />2 недели бесплатно</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />Данные можно забрать</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16a34a]" />Помощь с внедрением</span>
              </div>
            </HeroIn>

            {/* Светлый дашборд */}
            <HeroIn delay={0.15}>
              <Floating amplitude={9}>
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
                      <div className="mt-3 flex h-12 items-end gap-1.5">
                        {[42, 55, 38, 64, 48, 72, 80].map((h, i) => (
                          <div key={i} className={`flex-1 rounded-t-[3px] bg-gradient-to-t from-[#16a34a]/25 ${i === 6 ? 'to-[#16a34a]' : 'to-[#16a34a]/80'}`} style={{ height: `${h}%` }} />
                        ))}
                      </div>
                      <div className="mt-1.5 flex gap-1.5 text-[9px] font-medium text-[#94a3b8]">
                        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
                          <span key={d} className="flex-1 text-center">{d}</span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3.5 rounded-[14px] border border-[#16a34a]/20 bg-[#16a34a]/[0.05] p-4">
                      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#15803d]"><Bot className="h-4 w-4" />AI-наблюдение</div>
                      <div className="mt-2 text-[13px] leading-[1.55] text-[#56657d]">
                        Маржа ↓ 1,4% — выросла закупка «напитки» на 14%. Альтернатива дешевле на 11% — экономия ~42 000 ₸/мес.
                      </div>
                    </div>
                  </div>
                </div>
              </Floating>
            </HeroIn>
          </div>
        </div>
      </section>

      {/* СОЦ-ДОКАЗАТЕЛЬСТВО */}
      <div className="border-y border-[#e2e8f0] bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-6 py-5 text-center text-[15px] font-medium text-[#5b6b82] sm:px-10 lg:px-14">
          <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
          Уже считает финансы сети <span className="font-bold text-[#0f2038]">F16</span>
          <span className="text-[#cbd3e0]">·</span>
          <span className="font-semibold text-[#475569]">Arena · Ramen · Extra</span>
        </div>
      </div>

      {/* ПРОБЛЕМЫ */}
      <section className="bg-[#eef2f8]">
        <div className={sectionClass}>
          <Reveal className="max-w-[640px]">
            <div className={eyebrowClass}>Знакомая ситуация?</div>
            <h2 className={`mt-5 ${h2Class}`}>Что мешает видеть реальные деньги</h2>
          </Reveal>
          <Stagger className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {painPoints.map((p) => (
              <StaggerItem key={p.pain}>
                <div className={`group h-full ${cardClass} transition duration-300 hover:-translate-y-1 hover:border-[#16a34a]/30`}>
                  <h3 className="font-display text-[18px] font-bold leading-[1.3] text-[#0f2038]">{p.pain}</h3>
                  <div className="mt-4 flex items-start gap-2.5 rounded-[12px] bg-[#16a34a]/[0.06] p-3.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" />
                    <span className="text-[14px] leading-[1.5] text-[#475569]">{p.solution}</span>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* КАК ЭТО РАБОТАЕТ */}
      <section className={sectionClass}>
        <Reveal className="max-w-[640px]">
          <div className={eyebrowClass}>Как это работает</div>
          <h2 className={`mt-5 ${h2Class}`}>От хаоса к цифрам — за 3 шага</h2>
        </Reveal>
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
      </section>

      {/* ВОЗМОЖНОСТИ (4 столпа) */}
      <section id="features" className="scroll-mt-20 border-y border-[#e2e8f0] bg-[#eef2f8]">
        <div className={sectionClass}>
        <Reveal className="max-w-[640px]">
          <div className={eyebrowClass}>Что внутри</div>
          <h2 className={`mt-5 ${h2Class}`}>Финансы. AI. Смены. Продажи.</h2>
        </Reveal>
        <Stagger className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((pillar) => {
            const Icon = pillar.icon
            return (
              <StaggerItem key={pillar.title}>
                <div className={`group h-full ${cardClass} transition duration-300 hover:-translate-y-1 hover:border-[#16a34a]/30`}>
                  <div className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#16a34a]/[0.1] text-[#16a34a] transition-transform duration-300 group-hover:scale-110"><Icon className="h-5 w-5" /></div>
                  <h3 className="mt-5 font-display text-[21px] font-bold tracking-[-0.01em] text-[#0f2038]">{pillar.title}</h3>
                  <p className="mt-2 text-[15px] leading-[1.5] text-[#56657d]">{pillar.subtitle}</p>
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
        </div>
      </section>

      {/* AI */}
      <section className="border-y border-[#e2e8f0] bg-[#edf5ef]">
        <div className={sectionClass}>
          <Reveal>
            <div className="overflow-hidden rounded-[24px] border border-[#d6dde8] bg-white p-9 shadow-[0_20px_50px_-24px_rgba(15,32,56,0.2)] sm:p-12">
              <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
                <div>
                  <div className={eyebrowClass}><Bot className="h-3.5 w-3.5" />AI-помощник</div>
                  <h2 className={`mt-5 ${h2Class}`}>AI, который работает с цифрами</h2>
                  <p className={`mt-4 ${leadClass}`}>Анализирует выручку, расходы, сотрудников и склад. Находит аномалии и предлагает действия — с числами, а не текстом.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {aiCapabilities.map((c) => {
                    const Icon = c.icon
                    return (
                      <div key={c.title} className="rounded-[16px] border border-[#e2e8f0] bg-[#eef2f8] p-4 transition duration-300 hover:-translate-y-0.5 hover:border-[#16a34a]/30 hover:bg-white">
                        <Icon className="h-5 w-5 text-[#16a34a]" />
                        <div className="mt-2.5 text-[15px] font-bold text-[#0f2038]">{c.title}</div>
                        <div className="mt-1 text-[13.5px] leading-[1.5] text-[#5b6b82]">{c.text}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ДЛЯ КОГО */}
      <section className={sectionClass}>
        <Reveal className="max-w-[640px]">
          <div className={eyebrowClass}>Для кого</div>
          <h2 className={`mt-5 ${h2Class}`}>Бизнесу с кассой, людьми и товаром</h2>
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
          <Reveal className="max-w-[640px]">
            <div className={eyebrowClass}>Сравнение</div>
            <h2 className={`mt-5 ${h2Class}`}>Вместо пяти программ — одна</h2>
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
        <Reveal className="max-w-[640px]">
          <div className={eyebrowClass}>Тарифы</div>
          <h2 className={`mt-5 ${h2Class}`}>Подключайте только нужное</h2>
          <p className={`mt-4 ${leadClass}`}>Цена зависит от числа точек и модулей — посчитаем индивидуально за 5 минут.</p>
        </Reveal>
        <Stagger className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pricingPlans.map((plan) => (
            <StaggerItem key={plan.name}>
              <div className={plan.highlight
                ? 'relative h-full rounded-[20px] border-2 border-[#16a34a]/45 bg-white p-7 shadow-[0_18px_44px_-18px_rgba(22,163,74,0.4)]'
                : `h-full ${cardClass} transition duration-300 hover:-translate-y-1`}>
                {plan.highlight && plan.badge ? <span className="absolute right-5 top-5 rounded-full bg-gradient-to-br from-[#fb923c] to-[#f97316] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_6px_16px_-6px_rgba(249,115,22,0.6)]">{plan.badge}</span> : null}
                <div className={'text-[11px] font-semibold uppercase tracking-[0.12em] ' + (plan.highlight ? 'text-[#15803d]' : 'text-[#64748b]')}>{plan.levelLabel}</div>
                <div className="mt-1.5 font-display text-[26px] font-bold text-[#0f2038]">{plan.name}</div>
                <p className="mt-2 text-[14.5px] leading-[1.5] text-[#56657d]">{plan.description}</p>
                <ul className="mt-5 space-y-2.5 border-t border-[#e2e8f0] pt-5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[14.5px] leading-[1.5] text-[#475569]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" /><span>{f}</span></li>
                  ))}
                </ul>
                <Button asChild className={plan.highlight
                  ? 'mt-6 w-full rounded-[12px] bg-[#16a34a] py-3 text-[14px] font-semibold text-white hover:bg-[#15803d]'
                  : 'mt-6 w-full rounded-[12px] bg-[#f3f6fa] py-3 text-[14px] font-semibold text-[#0f2038] hover:bg-[#e9eef4]'}>
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
          <Reveal className="max-w-[640px]">
            <div className={eyebrowClass}>Частые вопросы</div>
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
                  <CtaFeature icon={Bot} text="AI объясняет цифры простым языком" />
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
        <div className="mx-auto max-w-[1600px] px-6 py-10 sm:px-10 lg:px-12">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-[340px]">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#16a34a] text-[15px] font-bold text-white">◇</div>
                <div className="font-display text-[16px] font-bold text-[#0f2038]">{PRODUCT}</div>
              </div>
              <p className="mt-3 text-[14px] leading-[1.5] text-[#5b6b82]">Финансы, продажи и смены бизнеса — в одной системе. Прибыль видна каждый день.</p>
            </div>
            <div className="flex flex-wrap gap-x-14 gap-y-7">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">Продукт</div>
                <div className="mt-3.5 flex flex-col gap-2.5 text-[14px] font-medium text-[#5b6b82]">
                  <Link href="#features" className="hover:text-[#16a34a]">Возможности</Link>
                  <Link href="#pricing" className="hover:text-[#16a34a]">Тарифы</Link>
                  <Link href="/club-management-system" className="hover:text-[#16a34a]">Для клубов</Link>
                  <Link href="/login" className="hover:text-[#16a34a]">Войти</Link>
                </div>
              </div>
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">Документы</div>
                <div className="mt-3.5 flex flex-col gap-2.5 text-[14px] font-medium text-[#5b6b82]">
                  <Link href="/offer" className="hover:text-[#16a34a]">Оферта</Link>
                  <Link href="/privacy" className="hover:text-[#16a34a]">Политика</Link>
                  <Link href="/terms" className="hover:text-[#16a34a]">Соглашение</Link>
                  <Link href="/sla" className="hover:text-[#16a34a]">SLA</Link>
                </div>
              </div>
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">Связь</div>
                <div className="mt-3.5 flex flex-col gap-2.5 text-[14px] font-medium text-[#5b6b82]">
                  <Link href="#contact" className="hover:text-[#16a34a]">Оставить заявку</Link>
                  <Link href="/cookies" className="hover:text-[#16a34a]">Cookies</Link>
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
