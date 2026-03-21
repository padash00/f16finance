import { useCallback, useEffect, useState } from 'react'
import { Monitor, CheckCircle2, XCircle, RefreshCw, ExternalLink, Save, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  shift_report_chat_id: string | null
  feature_flags: {
    kaspi_daily_split: boolean
  }
  last_seen_at: string | null
}

export default function DevicesPage({ config, session }: Props) {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chatIds, setChatIds] = useState<Record<string, string>>({})
  const [kaspiSplitFlags, setKaspiSplitFlags] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getAdminDevices(config, session.email, session.password)
      const nextDevices = (data.data.devices as any[]).map((d) => ({
        id: d.id,
        name: d.name,
        company_id: d.company_id,
        company_name: d.company?.name || '—',
        point_mode: d.point_mode || '—',
        is_active: d.is_active !== false,
        device_token: d.device_token || '',
        shift_report_chat_id: d.shift_report_chat_id || null,
        feature_flags: {
          kaspi_daily_split: d.feature_flags?.kaspi_daily_split === true,
        },
        last_seen_at: d.last_seen_at || null,
      }))
      setDevices(nextDevices)
      setChatIds(Object.fromEntries(nextDevices.map((device: Device) => [device.id, device.shift_report_chat_id || ''])))
      setKaspiSplitFlags(Object.fromEntries(nextDevices.map((device: Device) => [device.id, device.feature_flags.kaspi_daily_split === true])))
    } catch {
      setDevices([])
      setError('Не удалось загрузить устройства')
    } finally {
      setLoading(false)
    }
  }, [config, session.email, session.password])

  useEffect(() => {
    void load()
  }, [load])

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

  async function saveDeviceSettings(deviceId: string) {
    setSavingId(deviceId)
    setMessage(null)
    setError(null)
    try {
      await api.updateAdminDeviceShiftReportChat(
        config,
        session.email,
        session.password,
        deviceId,
        chatIds[deviceId]?.trim() || null,
        {
          kaspi_daily_split: kaspiSplitFlags[deviceId] === true,
        },
      )
      setMessage('Настройки устройства сохранены')
      await load()
    } catch (err: any) {
      setError(
        err?.message === 'invalid-shift-report-chat-id'
          ? 'Неверный Telegram chat ID. Используйте числовой ID, например -1001234567890'
          : err?.message || 'Не удалось сохранить настройки устройства',
      )
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Устройства</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Здесь можно задать Telegram chat ID для сменных отчётов и включить суточную сверку Kaspi для ночной смены.
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
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {message ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{message}</div> : null}
      {error ? <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div> : null}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
        </div>
      ) : devices.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Monitor className="h-8 w-8 opacity-40" />
          <p className="text-sm">Нет устройств</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((device) => (
            <Card key={device.id}>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{device.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{device.company_name}</p>
                  </div>
                  <Badge variant={device.is_active ? 'success' : 'secondary'} className="shrink-0">
                    {device.is_active ? (
                      <>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Активно
                      </>
                    ) : (
                      <>
                        <XCircle className="mr-1 h-3 w-3" /> Откл.
                      </>
                    )}
                  </Badge>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Режим</span>
                    <span className="font-mono text-foreground">{device.point_mode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Активность</span>
                    <span className="text-foreground">{formatLastSeen(device.last_seen_at)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Токен</span>
                    <span className="font-mono text-foreground">
                      {device.device_token.slice(0, 6)}••••••••
                    </span>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Telegram и суточный Kaspi
                  </div>
                  <Input
                    value={chatIds[device.id] || ''}
                    onChange={(event) => setChatIds((prev) => ({ ...prev, [device.id]: event.target.value }))}
                    placeholder="-1001234567890"
                  />
                  <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={kaspiSplitFlags[device.id] === true}
                      onChange={(event) =>
                        setKaspiSplitFlags((prev) => ({
                          ...prev,
                          [device.id]: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      Включить суточную сверку Kaspi для ночной смены.
                      В форме смены появятся поля "до 00:00" и "после 00:00".
                    </span>
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Chat ID нужен для канала или группы со сменными отчётами. Отдельно можно включить ночную разбивку Kaspi именно для этой точки.
                  </p>
                  <Button
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => void saveDeviceSettings(device.id)}
                    disabled={savingId === device.id}
                  >
                    <Save className="h-4 w-4" />
                    {savingId === device.id ? 'Сохраняю...' : 'Сохранить настройки'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
