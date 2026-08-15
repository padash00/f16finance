'use client'

/**
 * Отдельная страница «Кому сколько доплатить».
 *
 * То же, что и первая вкладка модуля, но без всего остального: владелец
 * заходит раз в месяц, видит список людей и суммы, нажимает «Начислить».
 * Аналитика, планы и методология живут на `/sales-kpi` и для выплаты не нужны.
 */

import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import Link from 'next/link'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { PageSkeleton } from '@/components/skeleton'
import { useCapabilities } from '@/lib/client/use-capabilities'

import { PayoutTab } from '../payout-tab'

export default function PayoutPage() {
  // Точка-магазин берётся из настроек магазина — та же, что на «Сменах».
  const [storeCompanyId, setStoreCompanyId] = useState<string | null | undefined>(undefined)
  const { can } = useCapabilities()

  useEffect(() => {
    fetch('/api/admin/store/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setStoreCompanyId(j?.data?.store_company_id || null))
      .catch(() => setStoreCompanyId(null))
  }, [])

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Кому сколько доплатить"
        description="Доплата продавцам за качество работы — средний чек, допродажи, товары в чеке"
        icon={<Wallet className="h-5 w-5" />}
        accent="emerald"
        backHref="/sales-kpi"
        actions={
          <Link
            href="/sales-kpi"
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Разбор и аналитика
          </Link>
        }
      />

      {storeCompanyId === undefined ? (
        <PageSkeleton stats={0} rows={5} cols={3} />
      ) : !storeCompanyId ? (
        <Card className="p-6 text-sm text-slate-600 dark:text-slate-300">
          Точка-магазин не выбрана. Укажите её в{' '}
          <Link href="/store/settings" className="text-sky-600 hover:underline dark:text-sky-400">
            настройках магазина
          </Link>
          .
        </Card>
      ) : (
        <PayoutTab companyId={storeCompanyId} canManage={can('sales-kpi.manage')} />
      )}
    </div>
  )
}
