'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type CatalogItem = {
  id: string
  name: string
  barcode: string
  sale_price: number
  unit: string
  item_type: string
  company_hint: string | null
  category: { id: string; name: string } | null
  qty_on_display: number
}

type CatalogResponse = {
  ok?: boolean
  label?: string
  companies?: { id: string; name: string }[]
  items?: CatalogItem[]
  error?: string
}

export function StorePageClient() {
  const [payload, setPayload] = useState<CatalogResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const catalogUrl = useMemo(() => '/api/client/catalog', [])

  useEffect(() => {
    setLoadError(null)
    fetch(catalogUrl)
      .then(async (r) => {
        const data = (await r.json().catch(() => null)) as CatalogResponse | null
        if (!r.ok) {
          setPayload(null)
          setLoadError(data?.error || 'Не удалось загрузить каталог.')
          return
        }
        setPayload(data)
      })
      .catch(() => {
        setPayload(null)
        setLoadError('Не удалось загрузить каталог.')
      })
  }, [catalogUrl])

  const items = payload?.items || []
  const q = query.trim().toLowerCase()
  const filtered = q
    ? items.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.category?.name || '').toLowerCase().includes(q) ||
          String(it.barcode || '').toLowerCase().includes(q),
      )
    : items

  const byCategory = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const it of filtered) {
      const key = it.category?.name || 'Без категории'
      const list = map.get(key) || []
      list.push(it)
      map.set(key, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'ru'))
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Магазин</h2>
          <p className="text-sm text-muted-foreground">
            {payload?.label || 'Витрина'} — просмотр цен и наличия на витрине точки. Заказ оформляется в клубе.
          </p>
        </div>
        <Link href="/client" className="text-sm text-sky-400 underline-offset-2 hover:underline">
          ← На главную
        </Link>
      </div>

      {loadError ? <p className="text-sm text-amber-200/90">{loadError}</p> : null}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по названию, категории, штрихкоду"
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
      />

      {items.length === 0 && !loadError && payload ? (
        <p className="text-sm text-muted-foreground">В каталоге пока нет активных позиций для ваших точек.</p>
      ) : null}

      <div className="space-y-6">
        {byCategory.map(([categoryName, rows]) => (
          <section key={categoryName} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{categoryName}</h3>
            <ul className="divide-y divide-border/60 rounded-xl border border-border/70 bg-background/50">
              {rows.map((it) => (
                <li key={it.id} className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-foreground">{it.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.item_type === 'consumable' ? 'Расходник' : 'Товар'} · {it.unit}
                      {it.company_hint ? ` · ${it.company_hint}` : ''}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-foreground">
                      {Number(it.sale_price || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₸
                    </p>
                    <p className="text-xs text-muted-foreground">
                      На витрине: {it.qty_on_display > 0 ? `${it.qty_on_display} ${it.unit}` : 'нет'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
