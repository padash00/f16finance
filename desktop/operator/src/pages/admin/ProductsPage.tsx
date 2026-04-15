import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Upload, CheckCircle2, AlertTriangle, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { formatMoney } from '@/lib/utils'
import * as api from '@/lib/api'
import type { AppConfig, AdminSession, BootstrapData, Product } from '@/types'

interface Props {
  config: AppConfig
  session: AdminSession
  bootstrap?: BootstrapData
}

export default function ProductsPage({ config, session }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      setProducts(await api.getProducts(config))
    } finally {
      setLoading(false)
    }
  }

  function showFlash(type: 'ok' | 'err', text: string) {
    setFlash({ type, text })
    setTimeout(() => setFlash(null), 4000)
  }

  async function handleDelete(product: Product) {
    if (!confirm(`Удалить товар "${product.name}"?`)) return
    try {
      await api.deleteProduct(config, session.token, product.id)
      setProducts(prev => prev.filter(p => p.id !== product.id))
      showFlash('ok', 'Товар удалён')
    } catch (err: unknown) {
      showFlash('err', err instanceof Error ? err.message : 'Ошибка')
    }
  }

  // ─── Excel импорт ──────────────────────────────────────────────────────────
  async function handleImport() {
    const filePath = await window.electron.dialog.openFile({
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
    })
    if (!filePath) return

    setImportStatus('Читаю файл...')
    try {
      const buffer = await window.electron.file.readBuffer(filePath)
      const XLSX = await import('xlsx')
      const wb = XLSX.read(buffer, { type: 'buffer' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 })

      // Определяем индексы колонок по заголовку (строка 0)
      const header = (rows[0] || []).map((h: unknown) => String(h || '').trim().toLowerCase())
      const colIdx = detectColumns(header)

      // Собираем строки из файла
      const products: { name: string; barcode: string; price: number }[] = []

      const startRow = colIdx.hasHeader ? 1 : 0
      for (let i = startRow; i < rows.length; i++) {
        const row = rows[i]
        const name = String(row[colIdx.name] || '').trim()
        const barcode = parseBarcode(row[colIdx.barcode])
        const price = parseFloat(String(row[colIdx.price] || '0').replace(/[^\d.,]/g, '').replace(',', '.'))
        if (!name || !barcode || !price) continue
        products.push({ name, barcode, price: Math.round(price) })
      }

      if (products.length === 0) {
        setImportStatus('Нет данных. Ожидаемые колонки: Название, Штрихкод, Цена (порядок любой)')
        setTimeout(() => setImportStatus(null), 5000)
        return
      }

      // Пробуем batch-импорт (один auth на всё)
      try {
        setImportStatus(`Отправляю ${products.length} товаров...`)
        const result = await api.importProducts(config, session.token, products)
        const parts = [`Добавлено: ${result.imported}`]
        if (result.skipped > 0) parts.push(`дублей пропущено: ${result.skipped}`)
        if (result.failed > 0) parts.push(`ошибок: ${result.failed}`)
        setImportStatus(parts.join(' · '))
      } catch {
        // Сервер не поддерживает batch — fallback: по одному с паузой
        let imported = 0; let skipped = 0; let failed = 0
        for (let i = 0; i < products.length; i++) {
          const p = products[i]
          setImportStatus(`Загружаю ${i + 1} / ${products.length}...`)
          try {
            await api.createProduct(config, session.token, p)
            imported++
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : ''
            if (msg === 'barcode-already-exists') skipped++
            else failed++
          }
          // Пауза 300мс чтобы не триггерить rate limit Supabase Auth
          if (i < products.length - 1) await new Promise(r => setTimeout(r, 300))
        }
        const parts = [`Добавлено: ${imported}`]
        if (skipped > 0) parts.push(`дублей пропущено: ${skipped}`)
        if (failed > 0) parts.push(`ошибок: ${failed}`)
        setImportStatus(parts.join(' · '))
      }
      await load()
      setTimeout(() => setImportStatus(null), 5000)
    } catch (err: unknown) {
      setImportStatus(`Ошибка: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`)
      setTimeout(() => setImportStatus(null), 5000)
    }
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.barcode.includes(search),
  )

  return (
    <div className="p-5 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию или штрихкоду..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {importStatus && (
            <p className="text-xs text-muted-foreground">{importStatus}</p>
          )}
          <Button variant="outline" size="sm" onClick={handleImport} className="gap-1.5">
            <Upload className="h-4 w-4" /> Импорт Excel
          </Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Добавить
          </Button>
        </div>
      </div>

      {/* Flash */}
      {flash && (
        <p className={`rounded-md px-3 py-2 text-xs flex items-center gap-2 ${
          flash.type === 'ok'
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
            : 'bg-destructive/10 border border-destructive/20 text-destructive-foreground'
        }`}>
          {flash.type === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {flash.text}
        </p>
      )}

      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>Всего: <strong className="text-foreground">{products.length}</strong></span>
        <span>Активных: <strong className="text-foreground">{products.filter(p => p.is_active).length}</strong></span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <span className="animate-spin h-6 w-6 border-2 border-border border-t-foreground rounded-full" />
        </div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Название</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Штрихкод</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Цена</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Статус</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(product => (
                <tr key={product.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-medium">{product.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{product.barcode}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(product.price)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge variant={product.is_active ? 'success' : 'secondary'}>
                      {product.is_active ? 'Активен' : 'Скрыт'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => setEditProduct(product)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive-foreground"
                        onClick={() => handleDelete(product)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    {search ? 'Ничего не найдено' : 'Товаров нет'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <ProductDialog
        open={showAddDialog || editProduct !== null}
        product={editProduct}
        config={config}
        session={session}
        onClose={() => { setShowAddDialog(false); setEditProduct(null) }}
        onSaved={() => { setShowAddDialog(false); setEditProduct(null); load(); showFlash('ok', 'Товар сохранён') }}
        onError={(msg) => showFlash('err', msg)}
      />
    </div>
  )
}

// ─── Product form dialog ───────────────────────────────────────────────────────

function ProductDialog({
  open, product, config, session, onClose, onSaved, onError,
}: {
  open: boolean
  product: Product | null
  config: AppConfig
  session: AdminSession
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const [name, setName] = useState(product?.name || '')
  const [barcode, setBarcode] = useState(product?.barcode || '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [isActive, setIsActive] = useState(product?.is_active !== false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(product?.name || '')
      setBarcode(product?.barcode || '')
      setPrice(product ? String(product.price) : '')
      setIsActive(product?.is_active !== false)
      setSaving(false)
    }
  }, [open, product])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { onError('Введите название'); return }
    if (!barcode.trim()) { onError('Введите штрихкод'); return }
    const priceNum = parseInt(price) || 0
    if (priceNum <= 0) { onError('Введите цену'); return }

    setSaving(true)
    try {
      if (product) {
        await api.updateProduct(config, session.token, product.id, {
          name: name.trim(), barcode: barcode.trim(), price: priceNum, is_active: isActive,
        })
      } else {
        await api.createProduct(config, session.token, {
          name: name.trim(), barcode: barcode.trim(), price: priceNum,
        })
      }
      onSaved()
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{product ? 'Редактировать товар' : 'Добавить товар'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Название</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Лапша рамен 200г" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Штрихкод</Label>
            <Input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="4600000000000" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Цена, ₸</Label>
            <Input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="500" />
          </div>
          {product && (
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none no-drag">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="rounded"
              />
              Активен
            </label>
          )}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? 'Сохраняю...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Определение колонок по заголовку ────────────────────────────────────────
// Поддерживает любой порядок: Название | Цена | Штрихкод  ИЛИ  Название | Штрихкод | Цена
function detectColumns(header: string[]): { name: number; barcode: number; price: number; hasHeader: boolean } {
  const nameKw = ['название', 'наименование', 'товар', 'name', 'product', 'title']
  const barcodeKw = ['штрихкод', 'штрих', 'barcode', 'ean', 'код', 'code']
  const priceKw = ['цена', 'price', 'стоимость', 'сумма']

  const find = (kws: string[]) => header.findIndex(h => kws.some(kw => h.includes(kw)))

  const nameCol = find(nameKw)
  const barcodeCol = find(barcodeKw)
  const priceCol = find(priceKw)

  // Если нашли хотя бы 2 из 3 — считаем что есть заголовок
  const detected = [nameCol, barcodeCol, priceCol].filter(c => c >= 0).length
  if (detected >= 2) {
    return {
      name: nameCol >= 0 ? nameCol : 0,
      barcode: barcodeCol >= 0 ? barcodeCol : 1,
      price: priceCol >= 0 ? priceCol : 2,
      hasHeader: true,
    }
  }

  // Нет заголовка — используем позицию по умолчанию: Название | Штрихкод | Цена
  // НО: пробуем угадать по значениям первой строки данных
  return { name: 0, barcode: 1, price: 2, hasHeader: false }
}

// ─── Парсинг штрихкода из Excel ───────────────────────────────────────────────
// Excel хранит большие числа в научной нотации: 4843943000000 → "4,843943E+12"
function parseBarcode(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return ''

  // XLSX вернул число напрямую
  if (typeof raw === 'number') {
    return String(Math.round(raw))
  }

  const s = String(raw).trim()

  // Научная нотация: "4.843943E+12" или "4,843943E+12" (европейский формат)
  if (/[eE][+-]?\d+$/.test(s)) {
    const normalized = s.replace(',', '.')
    const num = parseFloat(normalized)
    if (!isNaN(num) && isFinite(num)) {
      return String(Math.round(num))
    }
  }

  return s
}
