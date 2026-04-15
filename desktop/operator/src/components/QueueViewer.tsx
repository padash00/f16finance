import { useState, useEffect } from 'react'
import { Clock, RefreshCw, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getPendingItems } from '@/lib/offline'
import type { QueueItem } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
}

const TYPE_LABELS: Record<string, string> = {
  shift_report: 'Отчёт смены',
  create_debt: 'Создать долг',
  delete_debt: 'Удалить долг',
}

export default function QueueViewer({ open, onClose }: Props) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setItems(await getPendingItems())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Очередь отправки
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={loading}>
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <button
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 opacity-30" />
                <p className="text-sm">Очередь пустая</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-auto">
                {items.map(item => (
                  <div key={item.id} className="flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm">
                    {item.status === 'failed' ? (
                      <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive-foreground shrink-0" />
                    ) : (
                      <Clock className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{TYPE_LABELS[item.type] || item.type}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.created_at).toLocaleString('ru-RU')} · попыток: {item.attempts}
                      </p>
                      {item.last_error && (
                        <p className="text-xs text-destructive-foreground mt-0.5 truncate">{item.last_error}</p>
                      )}
                    </div>
                    <Badge variant={item.status === 'failed' ? 'destructive' : 'secondary'} className="text-xs shrink-0">
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
