'use client'

import { useEffect, useState, FormEvent } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { Users2, Plus, ToggleLeft, ToggleRight } from 'lucide-react'

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

export default function OperatorsPage() {
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('operators')
      .select('id,name,short_name,is_active')
      .order('name')

    if (error) {
      console.error(error)
      setError('Не удалось загрузить операторов')
    } else {
      setOperators((data || []) as Operator[])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    try {
      setSaving(true)
      const { data, error } = await supabase
        .from('operators')
        .insert([
          {
            name: name.trim(),
            short_name: shortName.trim() || null,
            is_active: true,
          },
        ])
        .select('id,name,short_name,is_active')
        .single()

      if (error) throw error
      setOperators((prev) => [...prev, data as Operator])
      setName('')
      setShortName('')
      setSaving(false)
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Ошибка при добавлении оператора')
      setSaving(false)
    }
  }

  const toggleActive = async (op: Operator) => {
    try {
      const { data, error } = await supabase
        .from('operators')
        .update({ is_active: !op.is_active })
        .eq('id', op.id)
        .select('id,name,short_name,is_active')
        .single()

      if (error) throw error
      setOperators((prev) =>
        prev.map((o) => (o.id === op.id ? (data as Operator) : o)),
      )
    } catch (err) {
      console.error(err)
      setError('Не удалось изменить статус оператора')
    }
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
          {/* Хедер */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Users2 className="w-7 h-7 text-emerald-400" />
              <div>
                <h1 className="text-2xl font-bold">Операторы</h1>
                <p className="text-xs text-muted-foreground">
                  Справочник операторов для расчёта зарплаты
                </p>
              </div>
            </div>
          </div>

          {error && (
            <Card className="p-3 border border-red-500/40 bg-red-950/40 text-sm text-red-200">
              {error}
            </Card>
          )}

          {/* Форма добавления */}
          <Card className="p-4 border-border bg-card/80">
            <form
              onSubmit={handleAdd}
              className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
            >
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Имя оператора
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="Например: Маржан"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Кратко (необязательно)
                </label>
                <input
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="Напр.: Маржан (день)"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="h-10 px-4 text-sm flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Добавить
                </Button>
              </div>
            </form>
          </Card>

          {/* Таблица операторов */}
          <Card className="p-4 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 px-2 text-left">Имя</th>
                  <th className="py-2 px-2 text-left">Кратко</th>
                  <th className="py-2 px-2 text-center">Статус</th>
                  <th className="py-2 px-2 text-right">Действие</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-4 text-center text-muted-foreground text-xs"
                    >
                      Загрузка...
                    </td>
                  </tr>
                )}

                {!loading && operators.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-4 text-center text-muted-foreground text-xs"
                    >
                      Операторов пока нет.
                    </td>
                  </tr>
                )}

                {!loading &&
                  operators.map((op) => (
                    <tr
                      key={op.id}
                      className="border-t border-border/40 hover:bg-white/5"
                    >
                      <td className="py-1.5 px-2 font-medium">{op.name}</td>
                      <td className="py-1.5 px-2">
                        {op.short_name || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {op.is_active ? (
                          <span className="text-emerald-400 text-[11px]">
                            Активен
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">
                            Выключен
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleActive(op)}
                          className="h-8 w-8"
                        >
                          {op.is_active ? (
                            <ToggleRight className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </div>
  )
}
