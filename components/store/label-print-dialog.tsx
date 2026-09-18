'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type LabelItem = {
  item_id: string
  name: string
  barcode: string
  sale_price: number | null
  unit: string
}

interface Props {
  items: LabelItem[]
  onClose: () => void
}

const MAX_COPIES = 99

/** «1 ценник», «2 ценника», «5 ценников» */
function labelWord(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'ценник'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ценника'
  return 'ценников'
}

function formatPrice(v: number | null) {
  if (!v) return '—'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

function priceNumber(v: number | null) {
  if (!v) return '—'
  return Math.round(v).toLocaleString('ru-RU')
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const LABEL_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;color:#000}
.grid{display:flex;flex-wrap:wrap;gap:3mm;padding:5mm}
.label{
  width:58mm;height:40mm;border:0.3mm solid #000;border-radius:1mm;
  padding:2.5mm 3mm;display:flex;flex-direction:column;
  justify-content:space-between;page-break-inside:avoid;overflow:hidden
}
/* Название — ровно 2 строки, обрезка многоточием → высота карточек одинаковая */
.name{
  font-size:7.5pt;font-weight:600;text-align:left;line-height:1.2;
  height:18pt;overflow:hidden;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;letter-spacing:-0.1pt
}
/* Цена — герой композиции */
.price-row{display:flex;align-items:baseline;justify-content:flex-start;gap:1mm}
.price{font-size:22pt;font-weight:800;letter-spacing:-1px;line-height:1;font-variant-numeric:tabular-nums}
.cur{font-size:11pt;font-weight:700}
.unit{font-size:7.5pt;font-weight:400;color:#444;margin-left:auto}
/* Штрихкод — под тонкой линией снизу */
.bc{border-top:0.3mm solid #000;padding-top:1mm;display:flex;justify-content:center}
.bc svg{max-width:100%;height:auto}
.bc-text{font-size:8pt;letter-spacing:1px;font-family:monospace}
`

function labelHtml(item: LabelItem, svgs: Record<string, string>): string {
  return `
      <div class="label">
        <div class="name">${escHtml(item.name)}</div>
        <div class="price-row">
          <span class="price">${escHtml(priceNumber(item.sale_price))}</span>
          <span class="cur">₸</span>
          <span class="unit">/ ${escHtml(item.unit)}</span>
        </div>
        <div class="bc">${svgs[item.item_id] ?? `<div class="bc-text">${escHtml(item.barcode)}</div>`}</div>
      </div>`
}

/** Сколько ценников печатать для товара: 0 — не печатаем */
function copiesOf(copiesById: Record<string, number>, itemId: string) {
  const value = copiesById[itemId]
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_COPIES, Math.round(value))) : 1
}

function buildPrintHtml(items: LabelItem[], copiesById: Record<string, number>, svgs: Record<string, string>): string {
  const labels = items
    .flatMap((item) => Array<null>(copiesOf(copiesById, item.item_id)).fill(null).map(() => item))
    .map((item) => labelHtml(item, svgs))
    .join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ценники</title><style>
${LABEL_CSS}
@media print{ @page{margin:4mm} body{margin:0} }
</style></head><body onload="setTimeout(()=>{window.print()},300)">
<div class="grid">${labels}</div>
</body></html>`
}

export function LabelPrintDialog({ items, onClose }: Props) {
  // Количество задаётся ДЛЯ КАЖДОГО товара: на одну позицию нужно 10 копий,
  // на другую одна. Общее поле сверху просто ставит одинаковое число всем.
  const [copiesById, setCopiesById] = useState<Record<string, number>>({})
  const [printing, setPrinting] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [svgMap, setSvgMap] = useState<Record<string, string>>({})
  const barcodeRefs = useRef<Record<string, SVGSVGElement | null>>({})

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    setCopiesById((prev) => {
      const next: Record<string, number> = {}
      for (const item of items) next[item.item_id] = prev[item.item_id] ?? 1
      return next
    })
  }, [items])

  const setCopies = (itemId: string, value: number) => {
    setCopiesById((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(MAX_COPIES, value)) }))
  }
  const setAllCopies = (value: number) => {
    const clamped = Math.max(0, Math.min(MAX_COPIES, value))
    setCopiesById(Object.fromEntries(items.map((item) => [item.item_id, clamped])))
  }
  const totalLabels = items.reduce((sum, item) => sum + copiesOf(copiesById, item.item_id), 0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  useEffect(() => {
    // Dynamically import jsbarcode and render barcodes
    import('jsbarcode').then(({ default: JsBarcode }) => {
      const map: Record<string, string> = {}
      items.forEach((item) => {
        const el = barcodeRefs.current[item.item_id]
        if (el && item.barcode) {
          try {
            JsBarcode(el, item.barcode, {
              format: 'CODE128',
              width: 1.5,
              height: 38,
              displayValue: true,
              fontSize: 9,
              margin: 3,
              lineColor: '#000',
              background: '#fff',
            })
            map[item.item_id] = el.outerHTML
          } catch {
            // invalid barcode — leave empty
          }
        }
      })
      setSvgMap(map)
    }).catch(() => null)
  }, [items])

  function handlePrint() {
    setPrinting(true)
    const svgs: Record<string, string> = {}
    items.forEach((item) => {
      const el = barcodeRefs.current[item.item_id]
      if (el) svgs[item.item_id] = el.outerHTML
    })

    const html = buildPrintHtml(items, copiesById, svgs)
    const win = window.open('', '_blank', 'width=900,height=700')
    if (win) {
      win.document.write(html)
      win.document.close()
    }
    setTimeout(() => setPrinting(false), 800)
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-black/40 dark:border-white/10 dark:bg-slate-900">
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><Printer className="h-4 w-4 text-amber-300" /> Печать ценников</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        {/* Поставить одинаковое количество всем сразу */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-white/10">
          <span className="text-sm text-muted-foreground">Поставить всем сразу</span>
          <div className="flex items-center gap-1.5">
            {[1, 2, 5, 10].map((value) => (
              <Button key={value} size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => setAllCopies(value)}>
                {value}
              </Button>
            ))}
          </div>
        </div>

        {/* Предпросмотр ценника */}
        {items[0] ? (
          <div className="flex items-center justify-center border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-white/10 dark:bg-slate-950/40">
            <div className="w-[58mm] rounded-[1mm] border border-black/80 bg-white p-[2.5mm] text-black" style={{ minHeight: '40mm', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div className="overflow-hidden font-semibold leading-tight" style={{ fontSize: '7.5pt', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', height: '18pt' }}>{items[0].name}</div>
              <div className="flex items-baseline gap-1">
                <span className="font-extrabold tabular-nums" style={{ fontSize: '22pt', lineHeight: 1, letterSpacing: '-1px' }}>{priceNumber(items[0].sale_price)}</span>
                <span className="font-bold" style={{ fontSize: '11pt' }}>₸</span>
                <span className="ml-auto text-neutral-600" style={{ fontSize: '7.5pt' }}>/ {items[0].unit}</span>
              </div>
              <div className="flex justify-center border-t border-black pt-[1mm]" dangerouslySetInnerHTML={{ __html: svgMap[items[0].item_id] || `<div style="font-family:monospace;font-size:8pt;letter-spacing:1px">${items[0].barcode}</div>` }} />
            </div>
          </div>
        ) : null}

        {/* Список товаров */}
        <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-white/5">
          {items.map((item) => {
            const count = copiesOf(copiesById, item.item_id)
            return (
              <div key={item.item_id} className={`flex items-center gap-3 px-5 py-2 ${count === 0 ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                  <p className="truncate text-xs text-slate-500">{item.barcode} · {formatPrice(item.sale_price)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => setCopies(item.item_id, count - 1)}
                    disabled={count <= 0}
                    aria-label="Меньше ценников"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(count)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '')
                      setCopies(item.item_id, digits === '' ? 0 : Number(digits))
                    }}
                    className="h-7 w-10 rounded-lg border border-slate-200 bg-white text-center text-sm font-semibold text-foreground outline-none focus:border-amber-400 dark:border-white/10 dark:bg-white/5"
                    aria-label={`Сколько ценников: ${item.name}`}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => setCopies(item.item_id, count + 1)}
                    disabled={count >= MAX_COPIES}
                    aria-label="Больше ценников"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Подвал */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-white/10">
          <p className="text-xs text-slate-500">Итого: {totalLabels} {labelWord(totalLabels)} · 58mm</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>Отмена</Button>
            <Button onClick={handlePrint} disabled={printing || totalLabels === 0} className="gap-2"><Printer className="h-4 w-4" />{printing ? 'Открываю…' : `Печать (${totalLabels})`}</Button>
          </div>
        </div>

        {/* Скрытые SVG для генерации штрихкодов */}
        <div className="hidden">
          {items.map((item) => (
            <svg key={item.item_id} ref={(el) => { barcodeRefs.current[item.item_id] = el }} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
