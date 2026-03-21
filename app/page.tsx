import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BellRing,
  Calculator,
  CheckCircle2,
  CreditCard,
  LineChart,
  MonitorSmartphone,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/core/site'

export const metadata: Metadata = {
  title: 'Система управления клубом, сменами и финансами',
  description:
    'Orda Control объединяет смены, зарплату, доходы, расходы, Telegram-интеграцию, point-программу и управленческий учет в одной системе.',
}

const highlights = [
  'Собственная point-программа для точки и кассы',
  'Интеграция с Telegram для отчетов и уведомлений',
  'Калькулятор смены для дневных и ночных смен',
  'ОПиУ и EBITDA по календарным суткам, а не вручную',
]

const advantages = [
  {
    icon: MonitorSmartphone,
    title: 'Собственная программа для точки',
    text: 'Не просто веб-форма, а отдельное Electron-приложение: вход по точке, сменный калькулятор, долги, офлайн-очередь и быстрый рабочий интерфейс для сотрудника.',
  },
  {
    icon: Send,
    title: 'Интеграция с Telegram',
    text: 'Сменные отчеты уходят в Telegram, долги могут прилетать оператору в личку, а руководитель получает быстрый канал контроля без ручных пересылок.',
  },
  {
    icon: Calculator,
    title: 'Калькулятор смен и суточный Kaspi',
    text: 'Для ночных смен можно делить Kaspi до и после полуночи, чтобы суточная выручка, ОПиУ и EBITDA сходились с реальными календарными сутками.',
  },
  {
    icon: Wallet,
    title: 'Зарплата, авансы и weekly-выплаты',
    text: 'Операторы, авансы, долги и выплаты собраны в одном контуре. Это позволяет видеть начислено, выплачено и остаток без отдельных таблиц.',
  },
  {
    icon: Workflow,
    title: 'Задачи, роли и дисциплина',
    text: 'Owner, manager, marketer, operator и superadmin работают в одной системе, но видят только свой контур. Плюс задачи, KPI и контроль сроков.',
  },
  {
    icon: LineChart,
    title: 'Управленка на живых данных',
    text: 'Доходы, расходы, комиссии, зарплата и суточный Kaspi собираются в ОПиУ и EBITDA. Это не просто журнал операций, а рабочая финансовая картина.',
  },
]

const productBlocks = [
  {
    icon: CreditCard,
    title: 'Доходы и расходы',
    text: 'Выручка по точкам, категории расходов, cash flow и ежедневный контроль цифр без ручной каши.',
  },
  {
    icon: Users,
    title: 'Команда и операторы',
    text: 'Профили, роли, структура, задачи, долги, weekly-зарплата и понятный операторский контур.',
  },
  {
    icon: Target,
    title: 'KPI и план-факт',
    text: 'KPI, weekly-планы, контроль выполнения и управленческие решения по цифрам, а не по ощущениям.',
  },
  {
    icon: BellRing,
    title: 'Уведомления и Telegram',
    text: 'Сменные отчеты, уведомления о долгах, каналы по точкам и быстрые сообщения в привычном канале связи.',
  },
]

const differentiation = [
  'Это не шаблонная CRM и не очередная таблица, а система, собранная под реальную сменную работу точки.',
  'У продукта уже есть собственная desktop-программа для точки, а не только кабинет руководителя.',
  'Телеграм интегрирован в операционный контур: отчеты, уведомления и связь с командой уже встроены.',
  'Система учитывает ночные смены, Kaspi, weekly-выплаты, долги и зарплату операторов как реальные бизнес-сценарии, а не как “допишем потом”.',
]

const seoPages = [
  {
    href: '/club-management-system',
    title: 'Система управления клубом',
    text: 'Для запросов про клуб, точки, команду, смены и единый рабочий контур.',
  },
  {
    href: '/operator-salary-system',
    title: 'Зарплата операторов',
    text: 'Для запросов про начисления, авансы, долги и weekly-выплаты.',
  },
  {
    href: '/profit-and-loss-ebitda',
    title: 'ОПиУ и EBITDA',
    text: 'Для запросов про управленческий учет, прибыльность и суточный Kaspi.',
  },
  {
    href: '/point-terminal',
    title: 'Программа для точки',
    text: 'Для запросов про кассовую программу, сменный калькулятор и point terminal.',
  },
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_20%),linear-gradient(180deg,#050816_0%,#0a1020_48%,#050816_100%)] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="mx-auto max-w-7xl px-6 pb-10 pt-8 sm:px-8 lg:px-10">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-5 py-4 backdrop-blur">
          <div>
            <div className="text-lg font-semibold">{SITE_NAME}</div>
            <div className="text-sm text-slate-400">Собственная система для смен, точки, команды и управленки</div>
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

      <section className="mx-auto grid max-w-7xl gap-8 px-6 pb-14 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
            <Sparkles className="h-3.5 w-3.5" />
            Собственная разработка под реальные процессы точки
          </div>

          <div className="space-y-5">
            <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              Не просто учет,
              <span className="block bg-gradient-to-r from-amber-300 via-orange-300 to-white bg-clip-text text-transparent">
                а единая рабочая система для клуба и точек
              </span>
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-300">
              Orda Control собирает в одном месте все, что обычно расползается по Excel, чатам и ручным отчетам:
              смены, доходы, расходы, зарплату операторов, долги, KPI, Telegram-отчеты, point-программу для точки и
              управленческий учет.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {highlights.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-300" />
                <div className="text-sm leading-6 text-slate-200">{item}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-amber-500 text-slate-950 hover:bg-amber-400">
              <Link href="/login">
                Войти в Orda Control
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
              <Link href="#advantages">Смотреть преимущества</Link>
            </Button>
          </div>
        </div>

        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
              <span>Почему это цепляет</span>
              <span>Product</span>
            </div>
            <div className="mt-5 grid gap-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <MonitorSmartphone className="h-4 w-4" />
                  Point-программа уже есть
                </div>
                <div className="mt-3 text-2xl font-semibold">Смена, долги, офлайн и Telegram</div>
                <div className="mt-1 text-sm text-slate-300">
                  Не нужно объяснять сотруднику сложный веб-интерфейс. У точки уже есть отдельный рабочий экран.
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Telegram</div>
                  <div className="mt-2 text-xl font-semibold">Отчеты и уведомления</div>
                  <div className="mt-1 text-sm text-slate-300">Сменные отчеты, долги и события уходят туда, где ими реально пользуются.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Финансы</div>
                  <div className="mt-2 text-xl font-semibold">ОПиУ без ручной магии</div>
                  <div className="mt-1 text-sm text-slate-300">Kaspi, расходы, зарплата и комиссии собираются в управленческий результат.</div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-slate-300">
                Сильная сторона продукта не в “красивом кабинете”, а в том, что в нем уже учтены живые сценарии:
                дневные и ночные смены, долги по товарам, зарплата операторов, Telegram-отчеты, точки и weekly-выплаты.
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section id="advantages" className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Преимущества</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Что делает систему интересной уже на первой странице
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Здесь важно показать не абстрактные обещания, а то, что в проекте уже реально есть и почему это выгодно
            руководителю и команде.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {advantages.map((item) => {
            const Icon = item.icon
            return (
              <Card key={item.title} className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-200">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{item.text}</p>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Что уже есть в продукте</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">Не концепт, а рабочая экосистема</h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                На главной должно быть видно, что проект уже закрывает важные процессы: кассу, смены, point-работу,
                зарплату операторов, задачи, роли и финансовую аналитику.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {productBlocks.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                    <div className="flex items-center gap-2 text-amber-200">
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-semibold">{item.title}</span>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">{item.text}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Чем отличается</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Почему это не выглядит как обычный учетный сайт
          </h2>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {differentiation.map((item) => (
            <Card key={item} className="border-white/10 bg-white/5 p-5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-300" />
                <p className="text-sm leading-7 text-slate-300">{item}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Страницы для поиска</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Отдельные страницы под главные поисковые запросы
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Мы уже выделили отдельные страницы под самые важные темы, чтобы сайт находили не только по названию бренда.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {seoPages.map((page) => (
            <Card key={page.href} className="border-white/10 bg-white/5 p-5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
              <h3 className="text-lg font-semibold">{page.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">{page.text}</p>
              <Button asChild variant="outline" className="mt-5 w-full border-white/15 bg-white/5 text-white hover:bg-white/10">
                <Link href={page.href}>Открыть страницу</Link>
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20 sm:px-8 lg:px-10">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(255,255,255,0.05))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-[-0.03em]">Нужен вход в рабочую систему?</h2>
              <p className="mt-3 text-base leading-7 text-slate-200">
                Публичная главная теперь объясняет продукт, а внутренняя часть остается защищенной рабочей системой для
                команды, точки и руководителя.
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
