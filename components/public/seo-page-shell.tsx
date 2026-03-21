import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, CheckCircle2 } from 'lucide-react'

import { BreadcrumbStructuredData, FaqStructuredData } from '@/components/public/structured-data'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type SeoSection = {
  title: string
  text: string
}

type SeoFaq = {
  question: string
  answer: string
}

export function SeoPageShell(props: {
  path: string
  eyebrow: string
  title: string
  description: string
  bullets: string[]
  sections: SeoSection[]
  faq: SeoFaq[]
  ctaTitle: string
  ctaText: string
  children?: ReactNode
}) {
  const { path, eyebrow, title, description, bullets, sections, faq, ctaTitle, ctaText, children } = props

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_22%),linear-gradient(180deg,#050816_0%,#0a1020_48%,#050816_100%)] text-white">
      <BreadcrumbStructuredData
        items={[
          { name: 'Главная', path: '/' },
          { name: title, path },
        ]}
      />
      <FaqStructuredData faq={faq} />

      <section className="mx-auto max-w-6xl px-6 pb-10 pt-8 sm:px-8 lg:px-10">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-5 py-4 backdrop-blur">
          <div>
            <div className="text-lg font-semibold">Orda Control</div>
            <div className="text-sm text-slate-400">Система для управления сменами, командой и финансами</div>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/">На главную</Link>
            </Button>
            <Button asChild className="bg-amber-500 text-slate-950 hover:bg-amber-400">
              <Link href="/login">
                Войти
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-14 sm:px-8 lg:px-10">
        <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
              {eyebrow}
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl">{title}</h1>
            <p className="mt-5 text-lg leading-8 text-slate-300">{description}</p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {bullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-300" />
                <div className="text-sm leading-6 text-slate-200">{bullet}</div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {children ? <section className="mx-auto max-w-6xl px-6 pb-10 sm:px-8 lg:px-10">{children}</section> : null}

      <section className="mx-auto max-w-6xl px-6 pb-12 sm:px-8 lg:px-10">
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <Card key={section.title} className="border-white/10 bg-white/5 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
              <h2 className="text-2xl font-semibold tracking-[-0.03em]">{section.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">{section.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12 sm:px-8 lg:px-10">
        <Card className="border-white/10 bg-black/20 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">Частые вопросы</h2>
          <div className="mt-5 space-y-4">
            {faq.map((item) => (
              <div key={item.question} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-base font-semibold text-white">{item.question}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-300">{item.answer}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20 sm:px-8 lg:px-10">
        <Card className="border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(255,255,255,0.05))] p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
          <h2 className="text-3xl font-semibold tracking-[-0.03em]">{ctaTitle}</h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-200">{ctaText}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-white text-slate-950 hover:bg-slate-100">
              <Link href="/login">
                Открыть систему
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
              <Link href="/">Вернуться на главную</Link>
            </Button>
          </div>
        </Card>
      </section>
    </main>
  )
}
