'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { calcMarkupPercent, parseMoney, parseUnitCost } from '@/lib/store/receipts/format'
import type { InventoryItem, ReceiptLine } from '@/components/store/receipts/types'

type ReceiptLineRowProps = {
  line: ReceiptLine
  items: InventoryItem[]
  itemsById: Map<string, InventoryItem>
  canRemove: boolean
  onPatch: (uid: string, patch: Partial<ReceiptLine>) => void
  onRemove: (uid: string) => void
}

function ReceiptLineRowImpl({ line, items, itemsById, canRemove, onPatch, onRemove }: ReceiptLineRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const lineItem = line.item_id ? itemsById.get(line.item_id) || null : null

  const handlePickItem = useCallback(
    (itemId: string) => {
      const selected = itemsById.get(itemId) || null
      onPatch(line.uid, {
        item_id: itemId,
        unit_cost: line.is_bonus
          ? '0'
          : selected
            ? String(selected.default_purchase_price || '')
            : line.unit_cost,
        sale_price: selected ? String(selected.sale_price || '') : line.sale_price,
        markup_percent: line.is_bonus
          ? ''
          : selected
            ? calcMarkupPercent(
                String(selected.default_purchase_price || ''),
                String(selected.sale_price || ''),
              )
            : line.markup_percent,
      })
      setPickerOpen(false)
    },
    [line.uid, line.is_bonus, line.unit_cost, line.sale_price, line.markup_percent, itemsById, onPatch],
  )

  const lastUnitHint = useMemo(() => {
    if (line.is_bonus) return null
    if (!line.last_unit_cost || line.last_unit_cost <= 0) return null
    const current = parseUnitCost(line.unit_cost)
    if (current <= 0) return null
    const change = ((current - line.last_unit_cost) / line.last_unit_cost) * 100
    const abs = Math.abs(change)
    if (abs < 1) {
      return (
        <p className="text-[10px] text-muted-foreground">Прошлая закупка: {line.last_unit_cost} ₸</p>
      )
    }
    const up = change > 0
    return (
      <p className={`text-[10px] ${up ? 'text-rose-300' : 'text-emerald-300'}`}>
        {up ? '↑' : '↓'} {Math.round(abs * 10) / 10}% к прошлой ({line.last_unit_cost} ₸)
      </p>
    )
  }, [line.is_bonus, line.last_unit_cost, line.unit_cost])

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_160px_110px_130px_130px_110px_minmax(0,1fr)_auto]">
      <div className="space-y-1.5 min-w-0">
        <Label>Товар</Label>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              className="w-full justify-between font-normal min-w-0 overflow-hidden"
            >
              <span className="block truncate text-left">
                {lineItem ? `${lineItem.name} · ${lineItem.barcode}` : 'Выберите товар'}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[--radix-popover-trigger-width] min-w-[320px] p-0"
            sideOffset={4}
          >
            <Command>
              <CommandInput placeholder="Поиск по названию или штрихкоду…" />
              <CommandList>
                <CommandEmpty>Ничего не найдено</CommandEmpty>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.barcode}`}
                    onSelect={() => handlePickItem(item.id)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        line.item_id === item.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="block min-w-0 flex-1 truncate">
                      {item.name} · {item.barcode}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-1.5 min-w-0">
        <Label>Штрихкод</Label>
        <Input value={lineItem?.barcode || '—'} readOnly className="bg-white/[0.03] truncate" />
      </div>

      <div className="space-y-1.5">
        <Label>Кол-во</Label>
        <Input
          inputMode="decimal"
          value={line.quantity}
          onChange={(event) => onPatch(line.uid, { quantity: event.target.value })}
          placeholder="0"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Цена закупа</Label>
        <Input
          inputMode="decimal"
          value={line.is_bonus ? '0' : line.unit_cost}
          readOnly={line.is_bonus}
          onChange={(event) =>
            onPatch(line.uid, {
              unit_cost: event.target.value,
              markup_percent: calcMarkupPercent(event.target.value, line.sale_price),
            })
          }
          placeholder="499,6757"
          className={line.is_bonus ? 'opacity-50' : undefined}
        />
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={!!line.is_bonus}
            onChange={(event) =>
              onPatch(line.uid, {
                is_bonus: event.target.checked,
                unit_cost: event.target.checked ? '0' : line.unit_cost,
                markup_percent: event.target.checked ? '' : line.markup_percent,
              })
            }
            className="h-3.5 w-3.5 accent-emerald-500"
          />
          <span className={line.is_bonus ? 'font-medium text-emerald-300' : 'text-muted-foreground'}>
            Бонус (подарок поставщика)
          </span>
        </label>
        {lastUnitHint}
      </div>

      <div className="space-y-1.5">
        <Label>Цена продажи</Label>
        <Input
          inputMode="decimal"
          value={line.sale_price}
          onChange={(event) =>
            onPatch(line.uid, {
              sale_price: event.target.value,
              markup_percent: calcMarkupPercent(line.unit_cost, event.target.value),
            })
          }
          placeholder="0"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Наценка %</Label>
        <Input
          inputMode="decimal"
          value={line.is_bonus ? '' : line.markup_percent}
          readOnly={line.is_bonus}
          onChange={(event) => {
            const pct = parseMoney(event.target.value)
            const base = parseUnitCost(line.unit_cost)
            const sale = base > 0
              ? String(Math.round((base * (1 + pct / 100) + Number.EPSILON) * 100) / 100)
              : line.sale_price
            onPatch(line.uid, {
              markup_percent: event.target.value,
              sale_price: sale,
            })
          }}
          placeholder={line.is_bonus ? '—' : '0'}
          className={line.is_bonus ? 'opacity-50' : undefined}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Комментарий</Label>
        <Input
          value={line.comment}
          onChange={(event) => onPatch(line.uid, { comment: event.target.value })}
          placeholder="Например, акция поставщика"
        />
      </div>

      <div className="flex items-end">
        <Button
          type="button"
          variant="ghost"
          disabled={!canRemove}
          onClick={() => onRemove(line.uid)}
        >
          Убрать
        </Button>
      </div>
      </div>

      {/* Срок годности (обязателен, кроме товаров без срока — бургеры/хотдоги) */}
      {line.item_id ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-[11px]">Изготовлен (от)</Label>
            <Input type="date" value={line.production_date || ''} onChange={(event) => onPatch(line.uid, { production_date: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px]">Годен до {lineItem?.requires_expiry === false ? '(необяз.)' : '*'}</Label>
            <Input type="date" value={line.expiry_date || ''} onChange={(event) => onPatch(line.uid, { expiry_date: event.target.value })} />
          </div>
          {lineItem?.requires_expiry === false ? (
            <div className="flex items-end sm:col-span-2"><span className="text-[11px] text-muted-foreground">Товар без срока годности (бургеры/хотдоги и пр.)</span></div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const ReceiptLineRow = memo(ReceiptLineRowImpl)
