'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Info,
} from 'lucide-react'
import Link from 'next/link'

type SalaryRule = {
  key: string
  label: string | null
  description: string | null
  value: number | null
}

export default function SalaryRulesPage() {
  const [rules, setRules] = useState<SalaryRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [newRule, setNewRule] = useState<SalaryRule | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from('salary_rules')
        .select('key, label, description, value')
        .order('key')

      if (error) {
        console.error(error)
        setError('Ошибка загрузки правил')
      } else {
        setRules((data || []) as SalaryRule[])
      }

      setLoading(false)
    }

    load()
  }, [])

  const handleChange = (
    key: string,
    field: keyof SalaryRule,
    value: string,
  ) => {
    setRules((prev) =>
      prev.map((r) =>
        r.key === key
          ? {
              ...r,
              [field]:
                field === 'value' ? (value === '' ? null : Number(value)) : value,
            }
          : r,
      ),
    )
  }

  const handleSave = async (rule: SalaryRule) => {
    setSavingKey(rule.key)
    setError(null)

    const { error } = await supabase
      .from('salary_rules')
      .update({
        label: rule.label,
        description: rule.description,
        value: rule.value,
      })
      .eq('key', rule.key)

    if (error) {
      console.error(error)
      setError('Ошибка сохранения правила')
    }

    setSavingKey(null)
  }

  const handleDelete = async (key: string) => {
    if (!confirm('Удалить это правило?')) return

    setSavingKey(key)
    setError(null)

    const { error } = await supabase
      .from('salary_rules')
      .delete()
      .eq('key', key)

    if (error) {
      console.error(error)
      setError('Ошибка удаления правила')
      setSavingKey(null)
      return
    }

    setRules((prev) => prev.filter((r) => r.key !== key))
    setSavingKey(null)
  }

  const handleAddNew = () => {
    setNewRule({
      key: '',
      label: '',
      description: '',
      value: null,
    })
  }

  const handleSaveNew = async () => {
    if (!newRule) return
    if (!newRule.key.trim()) {
      alert('Нужен уникальный key (например, base_rate)')
      return
    }

    setSavingKey(newRule.key)
    setError(null)

    const payload = {
      key: newRule.key.trim(),
      label: newRule.label || null,
      description: newRule.description || null,
      value: newRule.value ?? 0,
    }

    const { data, error } = await supabase
      .from('salary_rules')
      .insert(payload)
      .select('key, label, description, value')
      .single()

    if (error) {
      console.error(error)
      setError('Ошибка добавления правила')
      setSavingKey(null)
      return
    }

    setRules((prev) => [...prev, data as SalaryRule])
    setNewRule(null)
    setSavingKey(null)
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-5xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Link href="/salary">
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-1 hidden md:inline-flex"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">
                  Правила расчёта зарплаты
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                  Таблица настроек, как в Excel: ключ, подпись, значение и описание.
                  Эти значения используются в карточках операторов.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-xs"
              onClick={handleAddNew}
              disabled={!!newRule}
            >
              <Plus className="w-4 h-4" />
              Новое правило
            </Button>
          </div>

          {/* Подсказка по ключам */}
          <Card className="p-4 border-border bg-card/70 text-xs text-muted-foreground flex gap-3">
            <Info className="w-4 h-4 mt-0.5 text-purple-400 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">
                Рекомендуемые ключи для текущей схемы:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>
                  <code className="text-[11px] bg-black/40 px-1.5 py-0.5 rounded">
                    base_rate
                  </code>{' '}
                  — ставка за 1 смену (по умолчанию 8000).
                </li>
                <li>
                  <code className="text-[11px] bg-black/40 px-1.5 py-0.5 rounded">
                    bonus_120_threshold
                  </code>{' '}
                  — порог выручки для первого бонуса (120000).
                </li>
                <li>
                  <code className="text-[11px] bg-black/40 px-1.5 py-0.5 rounded">
                    bonus_120_value
                  </code>{' '}
                  — сумма первого бонуса.
                </li>
                <li>
                  <code className="text-[11px] bg-black/40 px-1.5 py-0.5 rounded">
                    bonus_160_threshold
                  </code>{' '}
                  — порог выручки для второго бонуса.
                </li>
                <li>
                  <code className="text-[11px] bg-black/40 px-1.5 py-0.5 rounded">
                    bonus_160_value
                  </code>{' '}
                  — сумма второго бонуса.
                </li>
              </ul>
            </div>
          </Card>

          {error && (
            <div className="border border-destructive/60 bg-destructive/10 text-destructive px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          {/* Таблица правил */}
          <Card className="border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-border bg-secondary/40 backdrop-blur text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <th className="px-4 py-3 text-left">Key</th>
                    <th className="px-4 py-3 text-left">Название</th>
                    <th className="px-4 py-3 text-right">Значение</th>
                    <th className="px-4 py-3 text-left">Описание</th>
                    <th className="px-4 py-3 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {loading && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-10 text-center text-muted-foreground"
                      >
                        Загрузка правил...
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    rules.map((r, idx) => (
                      <tr
                        key={r.key}
                        className={`border-b border-border/40 ${
                          idx % 2 === 0 ? 'bg-card/40' : ''
                        }`}
                      >
                        <td className="px-4 py-3 align-top">
                          <input
                            type="text"
                            value={r.key}
                            readOnly
                            className="w-full bg-input border border-border/50 rounded px-2 py-1 text-xs text-muted-foreground cursor-not-allowed"
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <input
                            type="text"
                            value={r.label || ''}
                            onChange={(e) =>
                              handleChange(
                                r.key,
                                'label',
                                e.target.value,
                              )
                            }
                            className="w-full bg-input border border-border/50 rounded px-2 py-1 text-xs text-foreground"
                            placeholder="Например: Ставка за смену"
                          />
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <input
                            type="number"
                            value={r.value ?? ''}
                            onChange={(e) =>
                              handleChange(
                                r.key,
                                'value',
                                e.target.value,
                              )
                            }
                            className="w-full bg-input border border-border/50 rounded px-2 py-1 text-xs text-right text-foreground"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <textarea
                            value={r.description || ''}
                            onChange={(e) =>
                              handleChange(
                                r.key,
                                'description',
                                e.target.value,
                              )
                            }
                            className="w-full bg-input border border-border/50 rounded px-2 py-1 text-xs text-foreground resize-y min-h-[40px]"
                            placeholder="Пояснение, как применяется правило"
                          />
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleSave(r)}
                              disabled={savingKey === r.key}
                            >
                              <Save className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(r.key)}
                              disabled={savingKey === r.key}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}

                  {/* Новое правило */}
                  {newRule && (
                    <tr className="border-t border-border bg-accent/5">
                      <td className="px-4 py-3 align-top">
                        <input
                          type="text"
                          value={newRule.key}
                          onChange={(e) =>
                            setNewRule({
                              ...newRule,
                              key: e.target.value,
                            })
                          }
                          className="w-full bg-input border border-border/50 rounded px-2 py-1 text-xs text-foreground"
                          placeholder="Например: base_rate"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="text"
                          value={newRule.label || ''}
                          onChange={(e) =>
                            setNewRule({
                              ...newRule,
                              label: e.target.value,
                            })
                          }
                          className="w-full bg-input border border-border/50 rounded px-2 py-1 text-xs text-foreground"
                          placeholder="Название правила"
                        />
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <input
                          type="number"
                          value={newRule.value ?? ''}
                          onChange={(e) =>
                            setNewRule({
                              ...newRule,
                              value:
                                e.target.value === ''
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                          className="w-full bg-input border border-border/50 rounded px-2 py-1 text-xs text-right text-foreground"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <textarea
                          value={newRule.description || ''}
                          onChange={(e) =>
                            setNewRule({
                              ...newRule,
                              description: e.target.value,
                            })
                          }
                          className="w-full bg-input border border-border/50 rounded px-2 py-1 text-xs text-foreground resize-y min-h-[40px]"
                          placeholder="Описание нового правила"
                        />
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleSaveNew}
                            disabled={savingKey === newRule.key}
                          >
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setNewRule(null)}
                            disabled={savingKey === newRule.key}
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading && !rules.length && !newRule && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-10 text-center text-muted-foreground"
                      >
                        Правил пока нет. Добавь базовые правила с помощью
                        кнопки <span className="font-semibold">«Новое правило»</span>.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
