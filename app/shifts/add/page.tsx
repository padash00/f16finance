'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

type Company = {
  id: string
  name: string
  code?: string
}

const todayISO = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function AddShiftPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState(todayISO())
  const [companyId, setCompanyId] = useState<string>('')
  const [operatorName, setOperatorName] = useState('')
  const [shiftType, setShiftType] = useState<'day' | 'night'>('day')
  const [comment, setComment] = useState('')

  const today = todayISO()

  useEffect(() => {
    const loadCompanies = async () => {
      setLoadingCompanies(true)
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, code')
        .order('name', { ascending: true })

      if (error) {
        console.error('Error loading companies for shifts:', error)
        setError('Не удалось загрузить список компаний')
        setLoadingCompanies(false)
        return
      }

      setCompanies((data || []) as Company[])
      if (data && data.length > 0) {
        setCompanyId(data[0].id)
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
    if (date < today) {
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

    const { error: insertError } = await supabase
      .from('shifts')
      .insert([payload])

    if (insertError) {
      console.error('Error inserting shift:', insertError)
      setError('Ошибка при сохранении смены')
      setSaving(false)
      return
    }

    setSaving(false)
    router.push('/shifts')
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Добавить смену
          </h1>
          <p className="text-muted-foreground mb-6">
            Выбираешь любую будущую дату, компанию, смену и оператора — и
            мы создаём одну запись в графике.
          </p>

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
                  <input
                    type="date"
                    value={date}
                    min={today}        // можно сегодня и вперёд
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
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
                    <option value="day">Day</option>
                    <option value="night">Night</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-2">
                  Оператор
                </label>
                <input
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  placeholder="Например: Дарын, Никита..."
                  className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
                />
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

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/shifts')}
                  disabled={saving}
                >
                  Отменить
                </Button>
                <Button
                  type="submit"
                  disabled={saving || loadingCompanies}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  {saving ? 'Сохраняем…' : 'Сохранить смену'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </main>
    </div>
  )
}
