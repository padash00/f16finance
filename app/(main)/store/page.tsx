'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Package } from 'lucide-react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { InventoryPageContent } from '../inventory/page'

type LowStockItem = {
  id: string
  name: string
  total_balance: number
  low_stock_threshold: number
}

export default function StoreOverviewPage() {
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])

  useEffect(() => {
    supabase
      .from('inventory_items')
      .select('id, name, total_balance, low_stock_threshold')
      .eq('is_active', true)
      .not('low_stock_threshold', 'is', null)
      .order('name')
      .then(({ data }: { data: LowStockItem[] | null }) => {
        if (data) {
          const low = data.filter(
            item => item.low_stock_threshold !== null && item.total_balance <= item.low_stock_threshold
          )
          setLowStock(low.slice(0, 10))
        }
      })
  }, [])

  return (
    <div>
      {lowStock.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-200">
              {lowStock.length} {lowStock.length === 1 ? 'товар заканчивается' : 'товаров заканчивается'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {lowStock.slice(0, 5).map(item => (
                <span key={item.id} className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
                  <Package className="h-3 w-3" />
                  {item.name} — {item.total_balance} шт.
                </span>
              ))}
              {lowStock.length > 5 && (
                <span className="text-xs text-amber-400">+{lowStock.length - 5} ещё</span>
              )}
            </div>
          </div>
          <Link href="/inventory/forecast" className="shrink-0 text-xs text-amber-400 underline hover:text-amber-300">
            Прогноз →
          </Link>
        </div>
      )}
      <InventoryPageContent forcedView="overview" />
    </div>
  )
}
