import { useState, useEffect } from 'react'
import { Monitor, CheckCircle2, XCircle, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import * as api from '@/lib/api'
import type { AppConfig, AdminSession } from '@/types'

interface Props {
  config: AppConfig
  session: AdminSession
}

interface Device {
  id: string
  name: string
  company_id: string
  company_name: string
  point_mode: string
  is_active: boolean
  device_token: string
  last_seen_at: string | null
}

export default function DevicesPage({ config, session }: Props) {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await api.getAdminDevices(config, session.email, session.password)
      setDevices((data.data.devices as any[]).map(d => ({
        id: d.id,
        name: d.name,
        company_id: d.company_id,
        company_name: d.company?.name || '—',
        point_mode: d.point_mode || '—',
        is_active: d.is_active !== false,
        device_token: d.device_token || '',
        last_seen_at: d.last_seen_at || null,
      })))
    } catch {
      setDevices([])
    } finally {
      setLoading(false)
    }
  }

  function formatLastSeen(iso: string | null): string {
    if (!iso) return 'Никогда'
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 2) return 'Только что'
    if (mins < 60) return `${mins} мин назад`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} ч назад`
    return d.toLocaleDateString('ru-RU')
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Устройства</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Для добавления устройства используйте веб-панель
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              window.electron.shell.openExternal(`${config.apiUrl}/point-devices`)
            }}
          >
            <ExternalLink className="h-4 w-4" /> Открыть в браузере
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <span className="animate-spin h-6 w-6 border-2 border-border border-t-foreground rounded-full" />
        </div>
      ) : devices.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Monitor className="h-8 w-8 opacity-40" />
          <p className="text-sm">Нет устройств</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map(device => (
            <Card key={device.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{device.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{device.company_name}</p>
                  </div>
                  <Badge variant={device.is_active ? 'success' : 'secondary'} className="shrink-0">
                    {device.is_active ? (
                      <><CheckCircle2 className="h-3 w-3 mr-1" /> Активно</>
                    ) : (
                      <><XCircle className="h-3 w-3 mr-1" /> Откл.</>
                    )}
                  </Badge>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Режим</span>
                    <span className="text-foreground font-mono">{device.point_mode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Активность</span>
                    <span className="text-foreground">{formatLastSeen(device.last_seen_at)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Токен</span>
                    <span className="font-mono text-foreground">
                      {device.device_token.slice(0, 6)}••••••••
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
