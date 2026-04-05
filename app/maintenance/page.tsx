import type { Metadata } from 'next'
import Link from 'next/link'
import { Clock3, ShieldAlert, Sparkles, Wrench } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Технические работы',
  description: 'На основном домене Orda Control временно проводятся технические работы. Пожалуйста, подождите.',
}

export default function MaintenancePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_24%),linear-gradient(180deg,#050816_0%,#090f1f_48%,#050816_100%)] px-4 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="hidden border-white/10 bg-slate-950/60 p-8 text-white backdrop-blur-xl lg:block">
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-6 inline-flex rounded-2xl bg-amber-500/10 p-4">
                  <Wrench className="h-8 w-8 text-amber-300" />
                </div>
                <h1 className="text-4xl font-semibold leading-tight text-white">
                  Переносим Orda Control на новый контур доменов и организаций
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  Сейчас мы обновляем маршрутизацию по организациям и поддоменам, чтобы каждый клиент открывался в
                  своём отдельном пространстве.
                </p>
              </div>

              <div className="space-y-3">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Sparkles className="h-4 w-4 text-amber-300" />
                    Что меняется
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    Организации переходят на отдельные рабочие адреса, а основной домен временно закрыт на обслуживание.
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <ShieldAlert className="h-4 w-4 text-emerald-300" />
                    Почему вышло из аккаунта
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    Для безопасного переключения инфраструктуры активные сессии временно завершаются автоматически.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl sm:p-8">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/10 p-3">
                <Clock3 className="h-6 w-6 text-amber-300" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Технические работы</h1>
                <p className="text-sm text-slate-400">Основной домен временно недоступен, пока обновляется SaaS-контур.</p>
              </div>
            </div>

            <div className="space-y-3 rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
              <p>
                Сейчас мы настраиваем новую схему доступа по организациям и поддоменам. После завершения каждый клиент
                будет открываться в своём отдельном пространстве.
              </p>
              <p>
                Если вы были авторизованы раньше, система могла автоматически завершить сессию. Это ожидаемо во время
                переключения.
              </p>
            </div>

            <div className="mt-5 rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              Просим немного подождать. Как только перенос завершится, вход снова станет доступен.
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild className="bg-white text-slate-950 hover:bg-slate-100">
                <Link href="/">Обновить страницу позже</Link>
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </main>
  )
}
