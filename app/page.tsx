import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  Calculator,
  CheckCircle2,
  CreditCard,
  MonitorSmartphone,
  Network,
  ShieldCheck,
  Target,
  Users,
  Wallet,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/core/site'

export const metadata: Metadata = {
  title: 'Система управления клубом, сменами и финансами',
  description:
    'Orda Control помогает вести доходы и расходы, считать зарплату операторов, контролировать смены, задачи, ОПиУ и EBITDA в одной системе.',
}

const metrics = [
  { value: 'Смены', label: 'дневные и ночные смены, точки и график работы' },
  { value: 'Финансы', label: 'доходы, расходы, касса, Kaspi и управленческий учет' },
  { value: 'Команда', label: 'операторы, задачи, долги, зарплата и роли' },
]

const modules = [
  {
    icon: Wallet,
    title: 'Доходы и расходы',
    text: 'Фиксируйте выручку по точкам, контролируйте расходы, собирайте cash flow и сверяйте цифры без ручной каши.',
  },
  {
    icon: Calculator,
    title: 'ОПиУ и EBITDA',
    text: 'Считайте прибыльность по календарным суткам, учитывайте Kaspi, комиссии, фонд оплаты труда и реальные затраты.',
  },
  {
    icon: Users,
    title: 'Зарплата и команда',
    text: 'Ведите операторов, начисления, авансы, долги, weekly-выплаты и всю структуру команды в одном месте.',
  },
  {
    icon: Target,
    title: 'Задачи и KPI',
    text: 'Ставьте задачи, отслеживайте сроки, планы и фактические показатели, чтобы операционная работа не разваливалась.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Программа для точки',
    text: 'Electron-приложение для кассы и точки: сменный калькулятор, сканер долгов, офлайн-очередь и Telegram-отчеты.',
  },
  {
    icon: Network,
    title: 'Роли и контроль доступа',
    text: 'Разделяйте owner, manager, marketer, operators и superadmin без хаоса в доступах и ручных исключениях.',
  },
]

const useCases = [
  'Система управления клубом и сетью точек',
  'Учет смен операторов и графика работы',
  'Расчет зарплаты операторов и weekly-выплат',
  'Учет доходов, расходов, ОПиУ и EBITDA',
  'Кассовая программа и point terminal для точки',
  'Контроль задач, KPI и операционной дисциплины',
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Windows',
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'KZT',
  },
  publisher: {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
  },
}

export default function MarketingHomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_22%),linear-gradient(180deg,#050816_0%,#0a1020_48%,#050816_100%)] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="mx-auto max-w-7xl px-6 pb-10 pt-8 sm:px-8 lg:px-10">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-5 py-4 backdrop-blur">
          <div>
            <div className="text-lg font-semibold">{SITE_NAME}</div>
            <div className="text-sm text-slate-400">Операционная система для клуба, точки и команды</div>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild className="bg-amber-500 text-slate-950 hover:bg-amber-400">
              <Link href="/login">
                Открыть систему
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-6 pb-14 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:px-10">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            Клуб, команда, смены, финансы
          </div>

          <div className="space-y-5">
            <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              Понятная система для управления
              <span className="block bg-gradient-to-r from-amber-300 via-orange-300 to-white bg-clip-text text-transparent">
                сменами, зарплатой и деньгами
              </span>
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-300">
              Orda Control объединяет смены, доходы, расходы, долги, задачи, зарплату операторов,
              ОПиУ, EBITDA и программу для точки в одном рабочем контуре. Вместо десятка таблиц и чатов
              вы получаете одну систему, где цифры сходятся, а команда понимает, что происходит.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-amber-500 text-slate-950 hover:bg-amber-400">
              <Link href="/login">
                Войти в Orda Control
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
              <Link href="#modules">Смотреть возможности</Link>
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {metrics.map((item) => (
              <Card key={item.value} className="border-white/10 bg-white/5 p-5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
                <div className="text-lg font-semibold text-amber-200">{item.value}</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{item.label}</div>
              </Card>
            ))}
          </div>
        </div>

        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
              <span>Орда Контроль</span>
              <span>Live</span>
            </div>
            <div className="mt-5 grid gap-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <BarChart3 className="h-4 w-4" />
                  Доходы и смены
                </div>
                <div className="mt-3 text-3xl font-semibold">Kaspi, нал, онлайн</div>
                <div className="mt-1 text-sm text-slate-300">Суточная сверка, разбор ночных смен и контроль выручки по точкам.</div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Команда</div>
                  <div className="mt-2 text-xl font-semibold">Зарплата, авансы, долги</div>
                  <div className="mt-1 text-sm text-slate-300">Weekly-выплаты, роли, структура и задачи операторов.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Управленка</div>
                  <div className="mt-2 text-xl font-semibold">ОПиУ и EBITDA</div>
                  <div className="mt-1 text-sm text-slate-300">Финансовая картина по точкам, команде и месяцу без ручной магии.</div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-300" />
                  <div className="text-sm leading-6 text-slate-300">
                    Система подходит для клубов, точек, мини-сетей и команд, которым нужен один рабочий контур:
                    касса, смены, операторы, расходы, задачи и финансовый результат.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section id="modules" className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Что делает система</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Всё, что обычно размазано по таблицам, чатам и ручным сводкам
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Здесь собраны ключевые модули, ради которых люди обычно ищут в Google систему управления клубом,
            учет смен, расчет зарплаты операторов и управленческий учет по точкам.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => {
            const Icon = module.icon
            return (
              <Card key={module.title} className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-200">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold">{module.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{module.text}</p>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Для поисковика и людей</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">По каким задачам вас должна находить первая страница</h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Главная страница должна сразу объяснять, что это не абстрактный сервис, а конкретная система
                для смен, операторов, доходов, расходов, зарплаты и финансового контроля.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {useCases.map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm leading-6 text-slate-200">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20 sm:px-8 lg:px-10">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(255,255,255,0.05))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-[-0.03em]">Нужен вход в рабочую систему?</h2>
              <p className="mt-3 text-base leading-7 text-slate-200">
                Для сотрудников и администраторов вход остаётся по защищенному контуру. Публичная главная теперь объясняет,
                что это за продукт, а внутренняя часть остаётся рабочей панелью управления.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-white text-slate-950 hover:bg-slate-100">
                <Link href="/login">
                  Войти
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </main>
  )
}
