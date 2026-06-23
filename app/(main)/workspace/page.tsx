import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowRight, Building2, CreditCard, LayoutDashboard, Settings2, Users } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
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
      <AdminPageHeader
        title={hostOrg?.name || 'Организация'}
        description="Поддомен организации — отдельный контур с данными только текущего клиента"
        icon={<Building2 className="h-5 w-5" />}
        accent="blue"
        backHref="/"
        actions={
          <div className="rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-4 py-1.5 text-sm text-slate-700 dark:text-slate-300">
            {normalizedHost || hostOrg?.slug || 'tenant'}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TENANT_LINKS.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.href} className="border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/65 p-6 text-slate-900 dark:text-white shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
              <div className="mb-4 inline-flex rounded-2xl bg-slate-100 dark:bg-white/6 p-3">
                <Icon className="h-6 w-6 text-violet-300" />
              </div>
              <h2 className="text-xl font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{item.description}</p>
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
