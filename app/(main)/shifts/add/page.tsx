'use client'

import { useEffect, useState } from 'react'
import { useToday } from '@/lib/client/use-today'
import { CalendarPlus } from 'lucide-react'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DatePicker } from '@/components/ui/date-picker'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { useRouter } from 'next/navigation'

type Company = {
  id: string
  name: string
  code?: string
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  full_name?: string | null
  operator_profiles?: { full_name?: string | null }[] | null
  is_active: boolean
}

export default function AddShiftPage() {
  const { can } = useCapabilities()
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Дата — после гидрации: страница готовится заранее, во время сборки, и
  // «сегодня» в готовом HTML было бы днём сборки — то есть форма предлагала бы
  // поставить смену на прошедшую дату. Подробности в useToday.
  const [date, setDate] = useState('')
  const [companyId, setCompanyId] = useState<string>('')
  const [operatorName, setOperatorName] = useState('')
  const [shiftType, setShiftType] = useState<'day' | 'night'>('day')
  const [comment, setComment] = useState('')

  const today = useToday()

  useEffect(() => {
    if (today) setDate((current) => current || today)
  }, [today])

  useEffect(() => {
    const loadCompanies = async () => {
      setLoadingCompanies(true)
      // Справочники берём у сервера, а не из базы напрямую: список точек и
      // операторов принадлежит организации, и решать, что из него показать,
      // должен роут — в браузере этот фильтр можно просто не применить.
      const [companiesResp, operatorsResp] = await Promise.all([
        fetch('/api/admin/companies', { cache: 'no-store' }),
        fetch('/api/admin/operators?active_only=true', { cache: 'no-store' }),
      ])

      const companiesJson = await companiesResp.json().catch(() => null)
      const operatorsJson = await operatorsResp.json().catch(() => null)

      if (!companiesResp.ok || !operatorsResp.ok) {
        console.error('Error loading shift references:', companiesJson?.error, operatorsJson?.error)
        setError('Не удалось загрузить список компаний и операторов')
        setLoadingCompanies(false)
        return
      }

      const companiesData = (companiesJson?.data || []) as Company[]
      const operatorsData = (operatorsJson?.data || []) as Operator[]

      setCompanies(companiesData)
      setOperators(operatorsData)

      if (companiesData.length > 0) {
        setCompanyId(companiesData[0].id)
      }

      if (operatorsData.length > 0) {
        setOperatorName(getOperatorDisplayName(operatorsData[0]))
      }
      setLoadingCompanies(false)
    }

    loadCompanies()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    if (!date) {
      setError('Укажи дату смены')
      setSaving(false)
      return
    }

    // только сегодня и в будущее
    if (today && date < today) {
      setError(`Нельзя ставить смену на прошедшую дату (${today} и дальше)`)
      setSaving(false)
      return
    }

    if (!operatorName.trim()) {
      setError('Укажи имя оператора')
      setSaving(false)
      return
    }

    if (!companyId) {
      setError('Выбери компанию')
      setSaving(false)
      return
    }

    const payload = {
      date,
      company_id: companyId,
      operator_name: operatorName.trim(),
      shift_type: shiftType,
      // деньги здесь не используем, просто нули
      cash_amount: 0,
      kaspi_amount: 0,
      card_amount: 0,
      debt_amount: 0,
      comment: comment.trim() || null,
    }

    const response = await fetch('/api/admin/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveShift',
        payload: {
          companyId: payload.company_id,
          date: payload.date,
          shiftType: payload.shift_type,
          operatorName: payload.operator_name,
          comment: payload.comment,
        },
      }),
    })

    const json = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('Error inserting shift:', json)
      setError(json?.error || 'Ошибка при сохранении смены')
      setSaving(false)
      return
    }

    setSaving(false)
    router.push('/shifts')
  }

  return (
    <>
        <div className="app-page-tight max-w-3xl">
          <div className="mb-6">
            <AdminPageHeader
              title="Добавить смену"
              description="Создание одной записи в графике: дата, компания, смена и оператор"
              icon={<CalendarPlus className="h-5 w-5" />}
              accent="amber"
              backHref="/shifts"
            />
          </div>

          <Card className="p-6 border-border bg-card neon-glow">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="text-sm text-destructive border border-destructive/60 bg-destructive/10 rounded px-3 py-2">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-2">
                    Дата смены
                  </label>
                  <DatePicker
                    value={date}
                    min={today}
                    onChange={setDate}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-2">
                    Компания
                  </label>
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    disabled={loadingCompanies}
                    className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-2">
                    Смена
                  </label>
                  <select
                    value={shiftType}
                    onChange={(e) =>
                      setShiftType(e.target.value as 'day' | 'night')
                    }
                    className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
                  >
                    <option value="day">День</option>
                    <option value="night">Ночь</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-2">
                  Оператор
                </label>
                <select
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Выберите оператора</option>
                  {operators.map((operator) => {
                    const label = getOperatorDisplayName(operator)
                    return (
                      <option key={operator.id} value={label}>
                        {label}
                      </option>
                    )
                  })}
                </select>
                <p className="mt-2 text-xs text-muted-foreground">
                  Список подтягивается из таблицы `operators`.
                </p>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-2">
                  Комментарий
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground resize-none"
                  placeholder="Например: смена за кого-то, пересменка и т.п."
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/shifts')}
                  disabled={saving}
                >
                  Отменить
                </Button>
                {can('shifts.create') && (
                <Button
                  type="submit"
                  disabled={saving || loadingCompanies}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  {saving ? 'Сохраняем…' : 'Сохранить смену'}
                </Button>
                )}
              </div>
            </form>
          </Card>
        </div>
    </>
  )
}
