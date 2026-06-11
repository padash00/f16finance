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

function formatPrice(v: number | null) {
  if (!v) return '—'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildPrintHtml(items: LabelItem[], copies: number, svgs: Record<string, string>): string {
  const labels = items
    .flatMap((item) => Array<null>(copies).fill(null).map(() => item))
    .map(
      (item) => `
      <div class="label">
        <div class="name">${escHtml(item.name)}</div>
        <div class="price">${escHtml(formatPrice(item.sale_price))}<span class="unit"> / ${escHtml(item.unit)}</span></div>
        <div class="bc">${svgs[item.item_id] ?? `<div class="bc-text">${escHtml(item.barcode)}</div>`}</div>
      </div>`,
    )
    .join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ценники</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#fff}
.grid{display:flex;flex-wrap:wrap;gap:3mm;padding:5mm}
.label{
  width:58mm;border:0.3mm solid #555;border-radius:1mm;
  padding:2.5mm 3mm;display:flex;flex-direction:column;
  align-items:center;gap:1.5mm;page-break-inside:avoid
}
.name{font-size:7.5pt;font-weight:700;text-align:center;line-height:1.25;word-break:break-word}
.price{font-size:16pt;font-weight:900;text-align:center;letter-spacing:-0.5px}
.unit{font-size:8pt;font-weight:400}
.bc svg{max-width:100%;height:auto}
.bc-text{font-size:8pt;letter-spacing:1px;font-family:monospace}
@media print{
  @page{margin:4mm}
  body{margin:0}
}
</style></head><body onload="setTimeout(()=>{window.print()},300)">
<div class="grid">${labels}</div>
</body></html>`
}

export function LabelPrintDialog({ items, onClose }: Props) {
  const [copies, setCopies] = useState(1)
  const [printing, setPrinting] = useState(false)
  const [mounted, setMounted] = useState(false)
  const barcodeRefs = useRef<Record<string, SVGSVGElement | null>>({})

  useEffect(() => { setMounted(true) }, [])
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
          } catch {
            // invalid barcode — leave empty
          }
        }
      })
    }).catch(() => null)
  }, [items])

  function handlePrint() {
    setPrinting(true)
    const svgs: Record<string, string> = {}
    items.forEach((item) => {
      const el = barcodeRefs.current[item.item_id]
      if (el) svgs[item.item_id] = el.outerHTML
    })

    const html = buildPrintHtml(items, copies, svgs)
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
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-black/40">
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white"><Printer className="h-4 w-4 text-amber-300" /> Печать ценников</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        {/* Копии */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <span className="text-sm text-slate-400">Копий каждого ценника</span>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setCopies((c) => Math.max(1, c - 1))} disabled={copies <= 1}><Minus className="h-3 w-3" /></Button>
            <span className="w-6 text-center text-sm font-semibold text-white">{copies}</span>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setCopies((c) => Math.min(20, c + 1))} disabled={copies >= 20}><Plus className="h-3 w-3" /></Button>
          </div>
        </div>

        {/* Список товаров */}
        <div className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
          {items.map((item) => (
            <div key={item.item_id} className="flex items-center gap-3 px-5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{item.name}</p>
                <p className="truncate text-xs text-slate-500">{item.barcode}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-white">{formatPrice(item.sale_price)}</span>
            </div>
          ))}
        </div>

        {/* Подвал */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
          <p className="text-xs text-slate-500">Итого: {items.length * copies} ценник{items.length * copies === 1 ? '' : 'а'} · 58mm</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>Отмена</Button>
            <Button onClick={handlePrint} disabled={printing} className="gap-2"><Printer className="h-4 w-4" />{printing ? 'Открываю…' : `Печать (${items.length * copies})`}</Button>
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
