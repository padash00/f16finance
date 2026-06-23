import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight, CheckCircle2 } from 'lucide-react'

import { BreadcrumbStructuredData, FaqStructuredData } from '@/components/public/structured-data'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Система управления клубом и точками',
  description:
    'Orda Control помогает управлять клубом, сменами, доходами, расходами, операторами, задачами и точками в одной системе.',
}

const path = '/club-management-system'
const eyebrow = 'Управление клубом'
const title = 'Система управления клубом, точками и командой'
const description =
  'Эта страница отвечает на самый частый запрос: как собрать смены, кассу, задачи, операторов, выручку и управленческий учет в одной рабочей системе без хаоса из таблиц и чатов.'

const bullets = [
  'Одна система для смен, доходов, расходов, зарплаты и задач.',
  'Отдельная программа для точки: калькулятор смены, долги, Telegram-отчеты и офлайн-очередь.',
  'Контроль ролей: owner, manager, marketer, operator, superadmin.',
  'Управленческий слой: ОПиУ, EBITDA, KPI, weekly-планирование и аналитика по точкам.',
]

const sections = [
  {
    title: 'Что должна решать система управления клубом',
    text: 'Если у бизнеса есть несколько точек, смены, операторы и ежедневная выручка, главная проблема обычно не в отсутствии данных, а в том, что цифры лежат в разных местах. Orda Control собирает кассу, задачи, доходы, расходы, долги и зарплату в один контур, где руководитель видит реальную картину, а команда понимает, где и что делать.',
  },
  {
    title: 'Почему это лучше Excel и разрозненных чатов',
    text: 'Таблицы подходят на старте, но быстро ломаются на ночных сменах, долгах, авансах, точках и командной ответственности. Здесь каждая операция привязана к роли, точке и дате. Это снижает ручные ошибки и позволяет опираться на систему, а не на память сотрудников.',
  },
  {
    title: 'Кому подходит Orda Control',
    text: 'Система подходит клубам, игровым точкам, небольшим сетям, кальянным и любому бизнесу, где есть сменный график, выручка по точкам, операторы, зарплаты и желание видеть ОПиУ не раз в месяц, а по факту работы.',
  },
  {
    title: 'Что можно контролировать в одной панели',
    text: 'На одной панели доступны доходы, расходы, cash flow, зарплата, KPI, weekly-выплаты, рейтинги операторов, план-факт, задачи и структура команды. Это превращает набор разрозненных процессов в одну операционную систему.',
  },
]

const faq = [
  {
    question: 'Это система только для клуба?',
    answer:
      'Нет. Она особенно хорошо подходит для клубного формата и точек со сменами, но по сути это рабочая система для любого бизнеса, где нужны сотрудники, касса, точки, выручка и управленческий учет.',
  },
  {
    question: 'Можно ли вести сразу несколько точек?',
    answer:
      'Да. Логика системы как раз построена вокруг компаний и точек: доходы, расходы, операторы и кассовая программа могут быть разделены по локациям.',
  },
  {
    question: 'Есть ли отдельная программа для точки?',
    answer:
      'Да. Для точки есть отдельное Electron-приложение с калькулятором смены, офлайн-режимом, долгами и отправкой отчетов.',
  },
]

const ctaTitle = 'Нужна система управления клубом без ручного хаоса?'
const ctaText =
  'Orda Control закрывает основной контур: смены, точки, операторы, доходы, расходы, зарплата и управленческий учет. Дальше это можно развивать уже внутри одной системы, а не в пяти разных инструментах.'

export default function ClubManagementSystemPage() {
  return (
    <main className="min-h-screen bg-white text-[#475569]">
      <BreadcrumbStructuredData
        items={[
          { name: 'Главная', path: '/' },
          { name: title, path },
        ]}
      />
      <FaqStructuredData faq={faq} />

      <section className="mx-auto max-w-6xl px-6 pb-10 pt-8 sm:px-8 lg:px-10">
        <div className="flex items-center justify-between rounded-2xl border border-[#e2e8f0] bg-white/80 px-5 py-4 backdrop-blur">
          <div>
            <div className="text-lg font-semibold text-[#0f2038]">Orda Control</div>
            <div className="text-sm text-[#5b6b82]">Система для управления сменами, командой и финансами</div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              asChild
              variant="ghost"
              className="hidden text-[#56657d] hover:text-[#16a34a] sm:inline-flex"
            >
              <Link href="/">На главную</Link>
            </Button>
            <Button asChild className="bg-none bg-[#16a34a] text-white hover:bg-[#15803d]">
              <Link href="/login">
                Войти
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-14 sm:px-8 lg:px-10">
        <Card className="border-[#d6dde8] bg-[#eef2f8] p-8 text-[#475569] shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/20 bg-[#16a34a]/[0.07] px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-[#15803d]">
              {eyebrow}
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.04em] text-[#0f2038] sm:text-5xl">{title}</h1>
            <p className="mt-5 text-lg leading-8 text-[#56657d]">{description}</p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {bullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-3 rounded-2xl border border-[#d6dde8] bg-white px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-[#16a34a]" />
                <div className="text-sm leading-6 text-[#475569]">{bullet}</div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12 sm:px-8 lg:px-10">
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <Card key={section.title} className="border-[#d6dde8] bg-white p-6 text-[#475569] shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
              <h2 className="text-2xl font-semibold tracking-[-0.03em] text-[#0f2038]">{section.title}</h2>
              <p className="mt-3 text-sm leading-7 text-[#56657d]">{section.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12 sm:px-8 lg:px-10">
        <Card className="border-[#d6dde8] bg-[#eef2f8] p-6 text-[#475569] shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-[#0f2038]">Частые вопросы</h2>
          <div className="mt-5 space-y-4">
            {faq.map((item) => (
              <div key={item.question} className="rounded-2xl border border-[#d6dde8] bg-white p-4">
                <h3 className="text-base font-semibold text-[#0f2038]">{item.question}</h3>
                <p className="mt-2 text-sm leading-7 text-[#56657d]">{item.answer}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20 sm:px-8 lg:px-10">
        <Card className="border-[#d6dde8] bg-[linear-gradient(135deg,rgba(22,163,74,0.10),rgba(246,248,251,0.9))] p-8 text-[#475569] shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-[#0f2038]">{ctaTitle}</h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#56657d]">{ctaText}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-none bg-[#16a34a] text-white hover:bg-[#15803d]">
              <Link href="/login">
                Открыть систему
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-[#d6dde8] bg-white text-[#56657d] hover:bg-[#eef2f8] hover:text-[#16a34a]">
              <Link href="/">Вернуться на главную</Link>
            </Button>
          </div>
        </Card>
      </section>
    </main>
  )
}
