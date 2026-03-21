'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Building2,
  Copy,
  Eye,
  EyeOff,
  Laptop2,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react'

type Company = {
  id: string
  name: string
  code: string | null
}

type PointFeatureFlags = {
  shift_report: boolean
  income_report: boolean
  debt_report: boolean
  kaspi_daily_split: boolean
}

type PointDevice = {
  id: string
  company_id: string
  name: string
  device_token: string
  shift_report_chat_id: string | null
  point_mode: string
  feature_flags: PointFeatureFlags
  is_active: boolean
  notes: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
  company?: Company | null
}

type PointDevicesResponse = {
  ok: boolean
  data?: {
    companies: Company[]
    devices: PointDevice[]
  }
  error?: string
}

type DeviceForm = {
  company_id: string
  name: string
  shift_report_chat_id: string
  point_mode: string
  notes: string
  feature_flags: PointFeatureFlags
}

const DEFAULT_FORM: DeviceForm = {
  company_id: '',
  name: '',
  shift_report_chat_id: '',
  point_mode: 'shift-report',
  notes: '',
  feature_flags: {
    shift_report: true,
    income_report: true,
    debt_report: false,
    kaspi_daily_split: false,
  },
}

const MODE_LABELS: Record<string, string> = {
  'shift-report': 'Сменный отчёт',
  'cash-desk': 'Кассовое место',
  universal: 'Универсальный режим',
  debts: 'Долги и доп. операции',
}

function formatDateTime(value: string | null) {
  if (!value) return 'Ещё не выходило в сеть'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function PointDevicesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [devices, setDevices] = useState<PointDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [newDevice, setNewDevice] = useState<DeviceForm>(DEFAULT_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDevice, setEditingDevice] = useState<DeviceForm>(DEFAULT_FORM)
  const [revealedTokens, setRevealedTokens] = useState<Record<string, boolean>>({})

  async function loadData() {
    setLoading(true)
    setError(null)
    const response = await fetch('/api/admin/point-devices', { cache: 'no-store' })
    const json = (await response.json().catch(() => null)) as PointDevicesResponse | null

    if (!response.ok || !json?.ok || !json.data) {
      setError(json?.error || 'Не удалось загрузить устройства точек')
      setLoading(false)
      return
    }

    setCompanies(json.data.companies || [])
    setDevices(json.data.devices || [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const groupedDevices = useMemo(() => {
    const buckets = new Map<string, { company: Company | null; devices: PointDevice[] }>()
    for (const device of devices) {
      const key = device.company_id
      const current = buckets.get(key)
      if (current) {
        current.devices.push(device)
      } else {
        buckets.set(key, {
          company: device.company || companies.find((item) => item.id === device.company_id) || null,
          devices: [device],
        })
      }
    }
    return Array.from(buckets.values()).sort((a, b) => (a.company?.name || '').localeCompare(b.company?.name || ''))
  }, [companies, devices])

  async function mutate(payload: unknown) {
    const response = await fetch('/api/admin/point-devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(json?.error || `Ошибка запроса (${response.status})`)
    }
    return json
  }

  function resetForm() {
    setNewDevice(DEFAULT_FORM)
  }

  function startEdit(device: PointDevice) {
    setEditingId(device.id)
    setEditingDevice({
      company_id: device.company_id,
      name: device.name,
      shift_report_chat_id: device.shift_report_chat_id || '',
      point_mode: device.point_mode,
      notes: device.notes || '',
      feature_flags: {
        shift_report: device.feature_flags.shift_report !== false,
        income_report: device.feature_flags.income_report !== false,
        debt_report: device.feature_flags.debt_report === true,
        kaspi_daily_split: device.feature_flags.kaspi_daily_split === true,
      },
    })
  }

  async function handleCreate() {
    if (!newDevice.company_id || !newDevice.name.trim()) {
      setError('Нужно выбрать точку и указать название устройства')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const json = await mutate({
        action: 'createDevice',
        payload: {
          ...newDevice,
          shift_report_chat_id: newDevice.shift_report_chat_id || null,
          notes: newDevice.notes || null,
        },
      })
      resetForm()
      await loadData()
      setSuccess(`Устройство создано. Token: ${json?.data?.device_token || 'создан'}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(deviceId: string) {
    if (!editingDevice.company_id || !editingDevice.name.trim()) {
      setError('Нужно выбрать точку и указать название устройства')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'updateDevice',
        deviceId,
        payload: {
          ...editingDevice,
          shift_report_chat_id: editingDevice.shift_report_chat_id || null,
          notes: editingDevice.notes || null,
        },
      })
      setEditingId(null)
      await loadData()
      setSuccess('Устройство обновлено')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRotate(deviceId: string) {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const json = await mutate({ action: 'rotateDeviceToken', deviceId })
      await loadData()
      setRevealedTokens((prev) => ({ ...prev, [deviceId]: true }))
      setSuccess(`Новый token: ${json?.data?.device_token || 'обновлён'}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(deviceId: string, nextActive: boolean) {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({ action: 'toggleDeviceActive', deviceId, is_active: nextActive })
      await loadData()
      setSuccess(nextActive ? 'Устройство активировано' : 'Устройство выключено')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(deviceId: string) {
    if (!confirm('Удалить устройство точки? Старый token перестанет работать.')) return

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({ action: 'deleteDevice', deviceId })
      await loadData()
      setSuccess('Устройство удалено')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token)
      setSuccess('Token скопирован')
    } catch {
      setError('Не удалось скопировать token')
    }
  }

  return (
    <>
        <div className="app-page max-w-7xl space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3">
                <Laptop2 className="h-7 w-7 text-cyan-300" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Точки и устройства</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Централизованное управление программами точек, токенами и режимами работы.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={loadData} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Обновить
            </Button>
          </div>

          {error ? (
            <Card className="border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card>
          ) : null}
          {success ? (
            <Card className="border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">{success}</Card>
          ) : null}

          <Card className="border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-4 w-4 text-cyan-300" />
              <h2 className="text-lg font-semibold text-foreground">Новое устройство точки</h2>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Точка</span>
                <select
                  value={newDevice.company_id}
                  onChange={(event) => setNewDevice((prev) => ({ ...prev, company_id: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
                >
                  <option value="">Выберите точку</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}{company.code ? ` (${company.code})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Название устройства</span>
                <input
                  value={newDevice.name}
                  onChange={(event) => setNewDevice((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
                  placeholder="Arena касса 1"
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Режим</span>
                <select
                  value={newDevice.point_mode}
                  onChange={(event) => setNewDevice((prev) => ({ ...prev, point_mode: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
                >
                  <option value="shift-report">Сменный отчёт</option>
                  <option value="cash-desk">Кассовое место</option>
                  <option value="universal">Универсальный режим</option>
                  <option value="debts">Долги и доп. операции</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Заметка</span>
                <input
                  value={newDevice.notes}
                  onChange={(event) => setNewDevice((prev) => ({ ...prev, notes: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
                  placeholder="Например: ресепшен, основной ПК"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {([
                ['shift_report', 'Сменные отчёты', 'Форма смены: наличные, Kaspi, итоги → Telegram и salary. Нужно всем точкам.'],
                ['income_report', 'Доходы', 'Отдельная форма доходов. Зарезервировано, пока не используется.'],
                ['debt_report', 'Долги и сканер', 'Включает страницу сканера: запись долгов и штрихкодов. Главный экран меняется с формы смены на сканер.'],
              ] as [string, string, string][]).map(([key, label, hint]) => (
                <label
                  key={key}
                  className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={newDevice.feature_flags[key as keyof PointFeatureFlags]}
                      onChange={(event) =>
                        setNewDevice((prev) => ({
                          ...prev,
                          feature_flags: {
                            ...prev.feature_flags,
                            [key]: event.target.checked,
                          },
                        }))
                      }
                      className="rounded border-white/10 bg-background"
                    />
                    <span className="font-medium">{label}</span>
                  </div>
                  <p className="pl-6 text-xs text-muted-foreground leading-relaxed">{hint}</p>
                </label>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={handleCreate} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Создать устройство
              </Button>
            </div>
          </Card>

          <div className="space-y-5">
            {loading ? (
              <Card className="border-border bg-card p-6 text-sm text-muted-foreground">Загрузка устройств...</Card>
            ) : groupedDevices.length === 0 ? (
              <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
                Пока нет ни одного устройства точки.
              </Card>
            ) : (
              groupedDevices.map((group) => (
                <Card key={group.company?.id || group.devices[0].company_id} className="border-border bg-card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2">
                        <Building2 className="h-5 w-5 text-cyan-300" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-foreground">{group.company?.name || 'Точка'}</h2>
                        <p className="text-xs text-muted-foreground">
                          {group.company?.code ? `Код: ${group.company.code}` : 'Без кода'} • устройств: {group.devices.length}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {group.devices.map((device) => {
                      const isEditing = editingId === device.id
                      const form = isEditing ? editingDevice : null
                      const tokenVisible = revealedTokens[device.id] === true

                      return (
                        <div key={device.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          {isEditing && form ? (
                            <div className="space-y-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <label className="space-y-2 text-sm">
                                  <span className="text-muted-foreground">Точка</span>
                                  <select
                                    value={form.company_id}
                                    onChange={(event) => setEditingDevice((prev) => ({ ...prev, company_id: event.target.value }))}
                                    className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
                                  >
                                    {companies.map((company) => (
                                      <option key={company.id} value={company.id}>
                                        {company.name}{company.code ? ` (${company.code})` : ''}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="space-y-2 text-sm">
                                  <span className="text-muted-foreground">Название устройства</span>
                                  <input
                                    value={form.name}
                                    onChange={(event) => setEditingDevice((prev) => ({ ...prev, name: event.target.value }))}
                                    className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
                                  />
                                </label>

                                <label className="space-y-2 text-sm">
                                  <span className="text-muted-foreground">Режим</span>
                                  <select
                                    value={form.point_mode}
                                    onChange={(event) => setEditingDevice((prev) => ({ ...prev, point_mode: event.target.value }))}
                                    className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
                                  >
                                    <option value="shift-report">Сменный отчёт</option>
                                    <option value="cash-desk">Кассовое место</option>
                                    <option value="universal">Универсальный режим</option>
                                    <option value="debts">Долги и доп. операции</option>
                                  </select>
                                </label>

                                <label className="space-y-2 text-sm">
                                  <span className="text-muted-foreground">Заметка</span>
                                  <input
                                    value={form.notes}
                                    onChange={(event) => setEditingDevice((prev) => ({ ...prev, notes: event.target.value }))}
                                    className="w-full rounded-xl border border-white/10 bg-background px-3 py-2"
                                  />
                                </label>
                              </div>

                              <div className="grid gap-3 md:grid-cols-3">
                                {([
                                  ['shift_report', 'Сменные отчёты', 'Форма смены → Telegram и salary. Нужно всем точкам.'],
                                  ['income_report', 'Доходы', 'Зарезервировано, пока не используется.'],
                                  ['debt_report', 'Долги и сканер', 'Включает сканер. Главный экран меняется на сканер долгов.'],
                                ] as [string, string, string][]).map(([key, label, hint]) => (
                                  <label
                                    key={key}
                                    className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-background/50 px-3 py-3 text-sm cursor-pointer"
                                  >
                                    <div className="flex items-center gap-3">
                                      <input
                                        type="checkbox"
                                        checked={form.feature_flags[key as keyof PointFeatureFlags]}
                                        onChange={(event) =>
                                          setEditingDevice((prev) => ({
                                            ...prev,
                                            feature_flags: {
                                              ...prev.feature_flags,
                                              [key]: event.target.checked,
                                            },
                                          }))
                                        }
                                        className="rounded border-white/10 bg-background"
                                      />
                                      <span className="font-medium">{label}</span>
                                    </div>
                                    <p className="pl-6 text-xs text-muted-foreground leading-relaxed">{hint}</p>
                                  </label>
                                ))}
                              </div>

                              <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setEditingId(null)}>
                                  Отмена
                                </Button>
                                <Button onClick={() => handleUpdate(device.id)} disabled={saving} className="gap-2">
                                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                  Сохранить
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-base font-semibold text-foreground">{device.name}</h3>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-muted-foreground">
                                      {MODE_LABELS[device.point_mode] || device.point_mode}
                                    </span>
                                    <span
                                      className={`rounded-full px-2 py-1 text-[11px] ${
                                        device.is_active
                                          ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                          : 'border border-red-500/20 bg-red-500/10 text-red-300'
                                      }`}
                                    >
                                      {device.is_active ? 'Активно' : 'Выключено'}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    <span className="rounded-lg border border-white/10 bg-background/70 px-2 py-1 text-muted-foreground">
                                      Последняя связь: {formatDateTime(device.last_seen_at)}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-background/70 px-2 py-1 text-muted-foreground">
                                      Создано: {formatDateTime(device.created_at)}
                                    </span>
                                  </div>
                                  {device.notes ? (
                                    <p className="max-w-3xl text-sm text-muted-foreground">{device.notes}</p>
                                  ) : null}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <Button size="sm" variant="outline" onClick={() => startEdit(device)} className="gap-2">
                                    <Pencil className="h-4 w-4" />
                                    Изменить
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => handleRotate(device.id)} className="gap-2">
                                    <RefreshCw className="h-4 w-4" />
                                    Новый token
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleToggle(device.id, !device.is_active)}
                                    className="gap-2"
                                  >
                                    <Power className="h-4 w-4" />
                                    {device.is_active ? 'Выключить' : 'Включить'}
                                  </Button>
                                  <Button size="sm" variant="destructive" onClick={() => handleDelete(device.id)} className="gap-2">
                                    <Trash2 className="h-4 w-4" />
                                    Удалить
                                  </Button>
                                </div>
                              </div>

                              <div className="mt-4 grid gap-3 md:grid-cols-[1.4fr_1fr]">
                                <div className="rounded-xl border border-white/10 bg-background/70 p-3">
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Device token
                                    </span>
                                    <div className="flex gap-2">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        onClick={() =>
                                          setRevealedTokens((prev) => ({
                                            ...prev,
                                            [device.id]: !prev[device.id],
                                          }))
                                        }
                                      >
                                        {tokenVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => copyToken(device.device_token)}>
                                        <Copy className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                  <code className="block break-all rounded-lg bg-black/40 px-3 py-2 text-xs text-cyan-200">
                                    {tokenVisible ? device.device_token : `${device.device_token.slice(0, 6)}••••••••••${device.device_token.slice(-6)}`}
                                  </code>
                                </div>

                                <div className="grid gap-2">
                                  {([
                                    ['shift_report', 'Сменные отчёты'],
                                    ['income_report', 'Доходы'],
                                    ['debt_report', 'Долги и сканер'],
                                  ] as [string, string][]).map(([key, label]) => (
                                    <div
                                      key={key}
                                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                                        device.feature_flags[key as keyof PointFeatureFlags]
                                          ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200'
                                          : 'border-white/10 bg-white/5 text-muted-foreground line-through opacity-40'
                                      }`}
                                    >
                                      <span>{label}</span>
                                      <ShieldCheck className="h-4 w-4" />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
    </>
  )
}
