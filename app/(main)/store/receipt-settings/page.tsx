'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, FileText, Info, Loader2, Receipt, Save, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { isAbortError } from '@/lib/is-abort-error'

type Company = {
  id: string
  name: string
  code: string | null
  organization_id?: string | null
}

type Settings = {
  id?: string
  company_id: string
  organization_id?: string | null
  tax_payer_name: string
  tax_payer_bin: string
  point_address: string
  kkm_factory_number: string
  kkm_registration_number: string
  is_vat_payer: boolean
  vat_rate: number
  ofd_name: string
  ofd_check_url: string
  receipt_language: 'ru' | 'kk' | 'both'
  receipt_footer_text: string
  require_buyer_iin: boolean
  marking_enabled: boolean
  nkt_enabled: boolean
}

type ApiResponse = {
  ok: boolean
  data?: {
    companies: Company[]
    settings: Settings | null
  }
  error?: string
}

const emptySettings = (companyId: string): Settings => ({
  company_id: companyId,
  tax_payer_name: '',
  tax_payer_bin: '',
  point_address: '',
  kkm_factory_number: '',
  kkm_registration_number: '',
  is_vat_payer: false,
  vat_rate: 12,
  ofd_name: '',
  ofd_check_url: '',
  receipt_language: 'ru',
  receipt_footer_text: '',
  require_buyer_iin: false,
  marking_enabled: false,
  nkt_enabled: false,
})

export default function ReceiptSettingsPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  )

  const load = async (companyId: string | null, signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const url = companyId
        ? `/api/admin/store/receipt-settings?company_id=${encodeURIComponent(companyId)}`
        : '/api/admin/store/receipt-settings'
      const response = await fetch(url, { cache: 'no-store', signal })
      const json = (await response.json().catch(() => null)) as ApiResponse | null
      if (signal?.aborted) return
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить настройки')
      setCompanies(json.data.companies || [])
      if (json.data.settings) {
        setSettings(json.data.settings)
        setSelectedCompanyId(json.data.settings.company_id)
      } else if (json.data.companies.length > 0) {
        const firstId = json.data.companies[0].id
        setSettings(emptySettings(firstId))
        setSelectedCompanyId(firstId)
      } else {
        setSettings(null)
      }
    } catch (err: any) {
      if (isAbortError(err) || signal?.aborted) return
      setError(err?.message || 'Не удалось загрузить настройки')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(null, ac.signal)
    return () => ac.abort()
  }, [])

  useEffect(() => {
    if (!selectedCompanyId) return
    const ac = new AbortController()
    void load(selectedCompanyId, ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId])

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current))
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/admin/store/receipt-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: settings.company_id,
          settings,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить')
      setSuccess('Реквизиты чека сохранены')
      setTimeout(() => setSuccess(null), 2500)
    } catch (err: any) {
      setError(err?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-page-wide space-y-6">
      {/* Header */}
      <AdminPageHeader
        title="Реквизиты чека ККМ"
        description="Приказ Министра финансов РК №626 от 24.10.2025 (действует с 01.01.2026)"
        icon={<Receipt className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        actions={
          <>
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger className="h-9 min-w-[220px]">
                <SelectValue placeholder="Выберите точку" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.code ? ` · ${c.code}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || loading || !settings}
              className="h-9 gap-1.5 bg-amber-600 hover:bg-amber-700"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Сохранить
            </Button>
          </>
        }
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">{success}</div>
      ) : null}

      {/* Inform banner */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 text-xs text-amber-200">
        <div className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Что должно быть на чеке ККМ (требования приказа №626):</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 leading-relaxed">
              <li>Наименование налогоплательщика и его БИН/ИИН</li>
              <li>Адрес торговой точки</li>
              <li>Заводской и регистрационный номера ККМ</li>
              <li>Наименование товара (НКТ — код по Национальному каталогу — пока не обязательно, появится позже)</li>
              <li>Маркировка товара (только для маркируемых — пока не обязательно)</li>
              <li>Ставка и сумма НДС (если плательщик)</li>
              <li>Дата и время покупки, фискальный признак</li>
              <li>Штриховой код для проверки чека</li>
              <li>Наименование ОФД и ссылка на его портал</li>
              <li>По необходимости — ИИН покупателя</li>
              <li>Чек на казахском и/или русском языке</li>
            </ul>
          </div>
        </div>
      </div>

      {loading || !settings ? (
        <Card className="border-white/10 bg-card/70 p-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем настройки…
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Налогоплательщик */}
          <Card className="border-white/10 bg-card/70 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-semibold">Налогоплательщик</h2>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Наименование</Label>
                <Input
                  value={settings.tax_payer_name}
                  onChange={(e) => patch('tax_payer_name', e.target.value)}
                  placeholder="ТОО / ИП «...»"
                />
              </div>
              <div className="space-y-1.5">
                <Label>БИН / ИИН</Label>
                <Input
                  value={settings.tax_payer_bin}
                  onChange={(e) => patch('tax_payer_bin', e.target.value.replace(/\D/g, '').slice(0, 12))}
                  placeholder="12 цифр"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Адрес торговой точки</Label>
                <Input
                  value={settings.point_address}
                  onChange={(e) => patch('point_address', e.target.value)}
                  placeholder="Город, улица, дом, помещение"
                />
              </div>
            </div>
          </Card>

          {/* ККМ */}
          <Card className="border-white/10 bg-card/70 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-semibold">Контрольно-кассовая машина</h2>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Заводской номер ККМ</Label>
                <Input
                  value={settings.kkm_factory_number}
                  onChange={(e) => patch('kkm_factory_number', e.target.value)}
                  placeholder="С шильдика устройства"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Регистрационный номер ККМ</Label>
                <Input
                  value={settings.kkm_registration_number}
                  onChange={(e) => patch('kkm_registration_number', e.target.value)}
                  placeholder="Присвоен налоговым органом при регистрации"
                />
              </div>
            </div>
          </Card>

          {/* НДС */}
          <Card className="border-white/10 bg-card/70 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-semibold">НДС</h2>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="cursor-pointer">Плательщик НДС</Label>
                <p className="text-xs text-muted-foreground">Если ИП/юр.лицо — плательщик НДС</p>
              </div>
              <Switch
                checked={settings.is_vat_payer}
                onCheckedChange={(v) => patch('is_vat_payer', v)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ставка НДС, %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={String(settings.vat_rate)}
                onChange={(e) => patch('vat_rate', Number(e.target.value) || 0)}
                disabled={!settings.is_vat_payer}
              />
            </div>
          </Card>

          {/* ОФД */}
          <Card className="border-white/10 bg-card/70 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-semibold">Оператор фискальных данных (ОФД)</h2>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Наименование ОФД</Label>
                <Input
                  value={settings.ofd_name}
                  onChange={(e) => patch('ofd_name', e.target.value)}
                  placeholder="Например: АО «Казахтелеком», АО «КЦМР»"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ссылка на портал ОФД для проверки чека</Label>
                <Input
                  value={settings.ofd_check_url}
                  onChange={(e) => patch('ofd_check_url', e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>
          </Card>

          {/* Языки и доп. */}
          <Card className="border-white/10 bg-card/70 p-5 space-y-4 lg:col-span-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-semibold">Параметры чека</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Язык чека</Label>
                <Select
                  value={settings.receipt_language}
                  onValueChange={(v) => patch('receipt_language', v as Settings['receipt_language'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ru">Русский</SelectItem>
                    <SelectItem value="kk">Қазақша</SelectItem>
                    <SelectItem value="both">Қазақша / Русский</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div>
                  <Label className="cursor-pointer">Запрашивать ИИН покупателя</Label>
                  <p className="text-xs text-muted-foreground">По требованию (для юр.лиц)</p>
                </div>
                <Switch
                  checked={settings.require_buyer_iin}
                  onCheckedChange={(v) => patch('require_buyer_iin', v)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Подпись чека (нижний колонтитул)</Label>
                <Textarea
                  value={settings.receipt_footer_text}
                  onChange={(e) => patch('receipt_footer_text', e.target.value)}
                  rows={2}
                  placeholder="Например: «Спасибо за покупку! Возврат в течение 14 дней по чеку.»"
                />
              </div>
            </div>
          </Card>

          {/* Маркировка / НКТ — будущее */}
          <Card className="border-amber-500/20 bg-amber-500/[0.04] p-5 space-y-3 lg:col-span-2">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-semibold text-amber-200">Маркировка и НКТ — появятся позже</h2>
            </div>
            <p className="text-xs text-amber-200/80">
              Печать кода маркируемого товара и кода по Национальному каталогу товаров (НКТ) станет обязательной в составе чека.
              Поддержка появится отдельным релизом. Переключатели ниже зарезервированы — не включайте, пока не появится логика.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 opacity-60">
                <Label>Печать маркировки на чеке</Label>
                <Switch checked={settings.marking_enabled} onCheckedChange={(v) => patch('marking_enabled', v)} disabled />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 opacity-60">
                <Label>Код товара по НКТ</Label>
                <Switch checked={settings.nkt_enabled} onCheckedChange={(v) => patch('nkt_enabled', v)} disabled />
              </div>
            </div>
          </Card>
        </div>
      )}

      {selectedCompany ? (
        <p className="text-xs text-muted-foreground">
          Настройки относятся к точке: <span className="text-foreground">{selectedCompany.name}</span>
          {selectedCompany.code ? ` · ${selectedCompany.code}` : ''}
        </p>
      ) : null}
    </div>
  )
}
