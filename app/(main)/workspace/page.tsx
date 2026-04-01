import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowRight, Building2, CreditCard, LayoutDashboard, Settings2, Users } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { normalizeRequestHost, resolveOrganizationByHost } from '@/lib/server/tenant-hosts'

const TENANT_LINKS = [
  {
    href: '/dashboard',
    title: 'Главная панель',
    description: 'Ключевые показатели и сводка по организации.',
    icon: LayoutDashboard,
  },
  {
    href: '/income',
    title: 'Доходы и расходы',
    description: 'Финансы, cash flow и отчётность по точкам.',
    icon: CreditCard,
  },
  {
    href: '/operators',
    title: 'Команда и операторы',
    description: 'Сотрудники, операторы и доступы внутри организации.',
    icon: Users,
  },
  {
    href: '/settings',
    title: 'Настройки организации',
    description: 'Точки, системные параметры и организационные настройки.',
    icon: Settings2,
  },
] as const

export default async function WorkspacePage() {
  const headersList = await headers()
  const host = headersList.get('host')
  const hostOrg = await resolveOrganizationByHost(host)
  const normalizedHost = normalizeRequestHost(host)

  return (
    <div className="app-page space-y-6">
      <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_30%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.32)] sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">
              <Building2 className="h-3.5 w-3.5" />
              Tenant workspace
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
              {hostOrg?.name || 'Организация'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Вы вошли в контур организации {hostOrg?.name || ''}. Этот поддомен работает отдельно от платформенного
              кабинета и открывает только данные текущего клиента.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 px-5 py-4 text-sm text-slate-300">
            {normalizedHost || hostOrg?.slug || 'tenant'}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TENANT_LINKS.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.href} className="border-white/10 bg-slate-950/65 p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
              <div className="mb-4 inline-flex rounded-2xl bg-white/6 p-3">
                <Icon className="h-6 w-6 text-violet-300" />
              </div>
              <h2 className="text-xl font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p>
              <Button asChild className="mt-6 w-full">
                <Link href={item.href}>
                  Открыть
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
