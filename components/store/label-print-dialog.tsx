'use client'

import { useEffect, useRef, useState } from 'react'
import { Printer, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

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
  const barcodeRefs = useRef<Record<string, SVGSVGElement | null>>({})

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

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Печать ценников</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Copies */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Копий каждого ценника</span>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setCopies((c) => Math.max(1, c - 1))}
                disabled={copies <= 1}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-6 text-center text-sm font-semibold">{copies}</span>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setCopies((c) => Math.min(20, c + 1))}
                disabled={copies >= 20}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Items list */}
          <div className="rounded-lg border border-white/10 bg-muted/30 divide-y divide-white/5 max-h-64 overflow-y-auto">
            {items.map((item) => (
              <div key={item.item_id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.barcode}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold">{formatPrice(item.sale_price)}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Итого: {items.length * copies} ценник{items.length * copies === 1 ? '' : 'а'} · формат 58mm
          </p>
        </div>

        {/* Hidden SVG elements for barcode rendering */}
        <div className="hidden">
          {items.map((item) => (
            <svg
              key={item.item_id}
              ref={(el) => { barcodeRefs.current[item.item_id] = el }}
            />
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handlePrint} disabled={printing} className="gap-2">
            <Printer className="h-4 w-4" />
            {printing ? 'Открываю...' : `Печать (${items.length * copies} шт.)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
