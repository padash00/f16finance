import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BellRing,
  Building2,
  Calculator,
  CheckCircle2,
  Clock3,
  CreditCard,
  Crown,
  LineChart,
  MonitorSmartphone,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ContactLeadForm } from '@/components/public/contact-lead-form'
import { FaqStructuredData, WebsiteStructuredData } from '@/components/public/structured-data'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/core/site'

export const metadata: Metadata = {
  title: 'Система управления клубом, сменами и финансами',
  description:
    'Orda Control объединяет смены, зарплату, доходы, расходы, Telegram-интеграцию, point-программу и управленческий учет в одной системе.',
}

const highlights = [
  'Собственная программа для точки и кассы',
  'Интеграция с Telegram для отчетов и уведомлений',
  'Калькулятор смены для дневных и ночных смен',
  'ОПиУ и EBITDA по календарным суткам, а не вручную',
]

const heroStats = [
  { label: 'Рабочих контуров', value: '8+' },
  { label: 'Telegram-сценариев', value: 'В деле' },
  { label: 'Форматов смен', value: 'День / Ночь' },
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
    title: 'Зарплата, авансы и выплаты по неделям',
    text: 'Операторы, авансы, долги и выплаты собраны в одном контуре. Это позволяет видеть начислено, выплачено и остаток без отдельных таблиц.',
  },
  {
    icon: Workflow,
    title: 'Задачи, роли и дисциплина',
    text: 'Владелец, менеджер, маркетолог, оператор и суперадмин работают в одной системе, но видят только свой контур. Плюс задачи, KPI и контроль сроков.',
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
    text: 'Выручка по точкам, категории расходов, движение денег и ежедневный контроль цифр без ручной каши.',
  },
  {
    icon: Users,
    title: 'Команда и операторы',
    text: 'Профили, роли, структура, задачи, долги, зарплата по неделям и понятный операторский контур.',
  },
  {
    icon: Target,
    title: 'KPI и план-факт',
    text: 'KPI, недельные планы, контроль выполнения и управленческие решения по цифрам, а не по ощущениям.',
  },
  {
    icon: BellRing,
    title: 'Уведомления и Telegram',
    text: 'Сменные отчеты, уведомления о долгах, каналы по точкам и быстрые сообщения в привычном канале связи.',
  },
]

const differentiation = [
  'Это не шаблонная система учета и не очередная таблица, а продукт, собранный под реальную сменную работу точки.',
  'У продукта уже есть собственная программа для точки, а не только кабинет руководителя.',
  'Телеграм интегрирован в операционный контур: отчеты, уведомления и связь с командой уже встроены.',
  'Система учитывает ночные смены, Kaspi, выплаты по неделям, долги и зарплату операторов как реальные бизнес-сценарии, а не как “допишем потом”.',
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
    text: 'Для запросов про начисления, авансы, долги и выплаты по неделям.',
  },
  {
    href: '/profit-and-loss-ebitda',
    title: 'ОПиУ и EBITDA',
    text: 'Для запросов про управленческий учет, прибыльность и суточный Kaspi.',
  },
  {
    href: '/point-terminal',
    title: 'Программа для точки',
    text: 'Для запросов про кассовую программу, сменный калькулятор и терминал точки.',
  },
]

const audiences = [
  {
    icon: Crown,
    title: 'Для владельца',
    text: 'Видеть выручку, расходы, зарплату, ОПиУ и EBITDA не в конце месяца, а как живую картину по точкам.',
  },
  {
    icon: Building2,
    title: 'Для руководителя',
    text: 'Управлять сменами, задачами, точками, дисциплиной и командой в одном рабочем контуре без лишних таблиц.',
  },
  {
    icon: Store,
    title: 'Для точки',
    text: 'Работать в отдельной программе с быстрым калькулятором смены, долгами, Telegram-отчетом и офлайн-очередью.',
  },
]

const outcomes = [
  'Меньше ручных пересылок и сверок в конце смены.',
  'Быстрее видно, кто сколько должен, кому сколько платить и как реально сработала точка.',
  'Telegram становится частью процесса, а не внешним костылем.',
  'Управленка собирается из тех же данных, на которых работает точка.',
]

const workflowSteps = [
  {
    title: 'Точка закрывает смену',
    text: 'Сотрудник работает в отдельной программе для точки: калькулятор смены, Kaspi, комментарии, долги и быстрый ввод без лишнего интерфейса.',
  },
  {
    title: 'Система собирает цифры',
    text: 'Доходы, расходы, Kaspi, зарплата по неделям, долги и задачи попадают в один контур без ручного копирования между таблицами.',
  },
  {
    title: 'Telegram отправляет отчет',
    text: 'Сменные отчеты и уведомления уходят в нужные каналы и личные сообщения, чтобы руководитель и команда сразу были в курсе.',
  },
  {
    title: 'Руководитель видит управленку',
    text: 'ОПиУ, EBITDA, KPI, план-факт и финансовая картина по точкам обновляются на основе тех же данных, а не отдельной ручной сводки.',
  },
]

const implementationSteps = [
  {
    title: 'Разбираем текущий процесс',
    text: 'Смотрим, как у вас сейчас устроены смены, точки, Telegram-отчеты, зарплата и где именно начинается ручной хаос.',
  },
  {
    title: 'Настраиваем контуры под ваш бизнес',
    text: 'Подключаем роли, точки, программы, зарплатную логику, каналы Telegram и те сценарии, которые реально нужны в работе.',
  },
  {
    title: 'Запускаем точку и команду',
    text: 'Точка начинает работать в программе, руководитель получает отчеты и финансы, а команда переходит с таблиц на единый рабочий контур.',
  },
  {
    title: 'Доводим до стабильного режима',
    text: 'После запуска подкручиваем детали: задачи, KPI, уведомления, weekly-выплаты, суточный Kaspi и управленческую картину.',
  },
]

const comparisonBefore = [
  'Смены закрываются в одном месте, отчеты пересылаются вручную в другом.',
  'Kaspi и выручка на стыке суток начинают спорить с выпиской и ОПиУ.',
  'Зарплата, долги и авансы живут в отдельных таблицах и сообщениях.',
  'Telegram используется как чат, но не как часть рабочего процесса.',
]

const comparisonAfter = [
  'Точка, Telegram, зарплата и управленка работают на одних и тех же данных.',
  'Ночные смены и суточный Kaspi собираются по календарным суткам, а не “примерно”.',
  'Долги, выплаты, weekly-зарплата и задачи видны в одном месте.',
  'Руководитель быстрее понимает, что происходит по точкам и где проседают процессы.',
]

const faqItems = [
  {
    question: 'Это готовый шаблон или можно подстроить под мой процесс?',
    answer:
      'Система уже собрана под реальные процессы, но сильная часть как раз в том, что ее можно адаптировать под ваши точки, роли, Telegram-сценарии, зарплатную логику и формат смен.',
  },
  {
    question: 'Подходит ли это только для клуба?',
    answer:
      'Нет. Основа продукта хорошо подходит для бизнеса, где есть точки, смены, сотрудники, касса, Telegram и потребность видеть управленку на живых данных.',
  },
  {
    question: 'Чем это лучше таблиц и чатов?',
    answer:
      'Таблицы обычно не держат дисциплину процессов. Здесь точка, оператор, зарплата, долги, Telegram и управленка связаны между собой, поэтому меньше ручных сверок и потерянных данных.',
  },
  {
    question: 'Нужно ли ставить отдельную программу?',
    answer:
      'Для точки уже есть собственная desktop-программа. Это плюс: сотруднику не нужно разбираться в большом кабинете, у него есть быстрый рабочий экран под смену.',
  },
]

export default async function MarketingHomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_20%),linear-gradient(180deg,#050816_0%,#0a1020_48%,#050816_100%)] text-white">
      <WebsiteStructuredData />
      <FaqStructuredData faq={faqItems} />

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
              смены, доходы, расходы, зарплату операторов, долги, KPI, Telegram-отчеты, программу для точки и
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

          <div className="grid gap-3 sm:grid-cols-3">
            {heroStats.map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <div className="text-2xl font-semibold text-amber-200">{item.value}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
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
              <span>Продукт</span>
            </div>
            <div className="mt-5 grid gap-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <MonitorSmartphone className="h-4 w-4" />
                  Программа для точки уже есть
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
                дневные и ночные смены, долги по товарам, зарплата операторов, Telegram-отчеты, точки и выплаты по неделям.
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
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Кому и зачем</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Страница должна сразу объяснять, кому это полезно и какой результат дает
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Вместо разрозненных карточек здесь лучше работает один понятный блок: роли, ценность и эффект после внедрения.
          </p>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
            {audiences.map((item) => {
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

          <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
              <Clock3 className="h-3.5 w-3.5" />
              Что получает бизнес
            </div>
            <h3 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">Меньше хаоса, больше понятных цифр и быстрых решений</h3>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Сильная система цепляет не только списком функций. Она показывает, что после внедрения у команды меньше ручной суеты, а у руководителя больше контроля.
            </p>

            <div className="mt-6 grid gap-3">
              {outcomes.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-300" />
                  <div className="text-sm leading-6 text-slate-200">{item}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Контуры продукта</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Не концепт, а уже собранная рабочая экосистема
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Важно показать, что продукт закрывает не один кабинет, а сразу несколько реальных контуров: точка, Telegram, зарплата, задачи и управленка.
          </p>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
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
          </Card>

          <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-8">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Почему это не обычный учетный сайт</div>
            <div className="mt-5 grid gap-3">
              {differentiation.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-300" />
                  <p className="text-sm leading-7 text-slate-300">{item}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Как выглядит продукт</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Витринные экраны на основе реальных модулей системы
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Здесь показано не абстрактное “облако функций”, а то, как продукт ощущается: точка, зарплата, управленка и Telegram-контур.
          </p>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
            <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
                <span>Терминал точки</span>
                <span>Работа смены</span>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-2xl border border-white/10 bg-[#0a0e17] p-4">
                  <div className="text-sm font-semibold text-white">Калькулятор смены</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-300">
                    <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                      <span>Kaspi</span>
                      <span className="font-medium text-white">194 025 ₸</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                      <span>Наличные</span>
                      <span className="font-medium text-white">26 000 ₸</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                      <span>Мелочь</span>
                      <span className="font-medium text-white">600 ₸</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-3 py-2 text-emerald-300">
                      <span>Итог смены</span>
                      <span className="font-semibold">220 625 ₸</span>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-amber-400/15 bg-amber-400/10 px-3 py-3 text-xs leading-5 text-amber-100">
                    Для ночной смены можно разделить Kaspi до и после полуночи, чтобы ОПиУ и EBITDA считались по календарным суткам.
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#090d16] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">Telegram-отчет</div>
                      <div className="text-xs text-slate-400">Точка отправляет цифры сразу после смены</div>
                    </div>
                    <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                      онлайн
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-slate-200">
                    <div className="font-semibold text-white">Отчет: 20.03.2026 07:42</div>
                    <div className="mt-2">Точка: F16 Ramen</div>
                    <div>Смена: Ночь</div>
                    <div className="mt-3">Kaspi: 194 025 ₸</div>
                    <div>Нал: 26 000 ₸</div>
                    <div>Мелочь: 600 ₸</div>
                    <div>Тех: 2 400 ₸</div>
                    <div className="mt-3 text-emerald-300">Все четко: 20 ₸</div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-6">
            <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
                  <span>Зарплата</span>
                  <span>Неделя</span>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-[#0a0e17] p-4">
                  <div className="grid grid-cols-4 gap-3 text-xs uppercase tracking-wide text-slate-500">
                    <span>Оператор</span>
                    <span>Начислено</span>
                    <span>Выплачено</span>
                    <span>Остаток</span>
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-300">
                    <div className="grid grid-cols-4 gap-3 rounded-xl bg-white/5 px-3 py-3">
                      <span className="font-medium text-white">Улан</span>
                      <span>98 000 ₸</span>
                      <span className="text-emerald-300">68 000 ₸</span>
                      <span className="font-semibold text-amber-200">30 000 ₸</span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 rounded-xl bg-white/5 px-3 py-3">
                      <span className="font-medium text-white">Амангелдие</span>
                      <span>54 500 ₸</span>
                      <span className="text-emerald-300">20 000 ₸</span>
                      <span className="font-semibold text-amber-200">34 500 ₸</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
                  <span>ОПиУ</span>
                  <span>EBITDA</span>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-[#0a0e17] p-4">
                  <div className="text-sm font-semibold text-white">Финансовая картина по точке</div>
                  <div className="mt-4 space-y-3 text-sm text-slate-300">
                    <div className="flex items-center justify-between">
                      <span>Выручка</span>
                      <span className="font-medium text-white">4 820 000 ₸</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Расходы</span>
                      <span className="font-medium text-white">1 740 000 ₸</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>ФОТ</span>
                      <span className="font-medium text-white">1 120 000 ₸</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-3 py-2 text-emerald-300">
                      <span>EBITDA</span>
                      <span className="font-semibold">1 960 000 ₸</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
          <div className="max-w-3xl">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Как это работает</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
              Понятная цепочка от точки до управленки
            </h2>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflowSteps.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Шаг {index + 1}</div>
                <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{step.text}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
              <Workflow className="h-3.5 w-3.5" />
              Как внедряем
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">Не просто продаем доступ, а собираем рабочий контур</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Для такого продукта важен не только интерфейс. Важно, как он встраивается в точку, команду, Telegram и финансовую логику бизнеса.
            </p>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {implementationSteps.map((step, index) => (
              <Card key={step.title} className="border-white/10 bg-white/5 p-5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Этап {index + 1}</div>
                <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">{step.text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="border-red-500/15 bg-red-500/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-red-200">Без единой системы</div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">Процессы расползаются по таблицам и чатам</h2>
            <div className="mt-6 grid gap-3">
              {comparisonBefore.map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-slate-300">
                  {item}
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-emerald-500/15 bg-emerald-500/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-200">С Orda Control</div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">Операционка и цифры собираются в один ритм</h2>
            <div className="mt-6 grid gap-3">
              {comparisonAfter.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" />
                  <div className="text-sm leading-6 text-slate-200">{item}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Частые вопросы</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Возражения, которые обычно появляются до заявки
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Эти вопросы лучше закрыть прямо на лендинге, чтобы человеку не приходилось догадываться, подойдет ли ему система и как она внедряется.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {faqItems.map((item) => (
            <Card key={item.question} className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
              <h3 className="text-xl font-semibold">{item.question}</h3>
              <p className="mt-4 text-sm leading-7 text-slate-300">{item.answer}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Страницы для поиска</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white">Отдельные входы под главные запросы</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Сайт должен находиться не только по бренду. Поэтому под важные сценарии уже вынесены отдельные страницы с понятным контекстом.
            </p>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
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
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-7xl px-6 pb-14 sm:px-8 lg:px-10">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
              Связаться
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">Оставьте заявку, и она сразу придет на почту</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Если хотите обсудить внедрение, автоматизацию точки, зарплату операторов, Telegram-отчеты или управленку,
              просто оставьте контакты. Заявка придет на почту, и дальше можно будет быстро созвониться.
            </p>

            <div className="mt-6 space-y-3 text-sm text-slate-300">
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-300" />
                <div>Подходит, если у вас уже есть точки, смены, сотрудники и ручной хаос в отчетах.</div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-300" />
                <div>Можно написать нишу, кратко описать задачу и оставить телефон или Telegram.</div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-300" />
                <div>Заявка уходит на почту и не теряется внутри сайта.</div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-8">
            <ContactLeadForm />
          </Card>
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
