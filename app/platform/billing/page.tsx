'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Edit2, Loader2, Save, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Plan = {
  id: string
  code: string
  name: string
  description: string | null
  status: string
  priceMonthly: number | null
  priceYearly: number | null
  currency: string
  limits: Record<string, unknown>
  features: Record<string, unknown>
}

type EditState = {
  name: string
  description: string
  status: string
  priceMonthly: string
  priceYearly: string
  limits: Record<string, string>
  features: Record<string, boolean>
}

const FEATURE_KEYS = ['ai_reports', 'inventory', 'web_pos', 'telegram', 'excel_exports', 'custom_branding'] as const
const FEATURE_LABELS: Record<string, string> = {
  ai_reports: 'AI-отчёты',
  inventory: 'Инвентарь',
  web_pos: 'Web POS',
  telegram: 'Telegram-бот',
  excel_exports: 'Excel экспорт',
  custom_branding: 'Брендинг',
}
const LIMIT_KEYS = ['companies', 'staff', 'operators', 'point_projects'] as const
const LIMIT_LABELS: Record<string, string> = {
  companies: 'Точек',
  staff: 'Сотрудников',
  operators: 'Операторов',
  point_projects: 'Устройств',
}

function planToEdit(plan: Plan): EditState {
  return {
    name: plan.name,
    description: plan.description || '',
    status: plan.status,
    priceMonthly: plan.priceMonthly != null ? String(plan.priceMonthly) : '',
    priceYearly: plan.priceYearly != null ? String(plan.priceYearly) : '',
    limits: Object.fromEntries(LIMIT_KEYS.map(k => [k, String((plan.limits as any)?.[k] ?? '')])),
    features: Object.fromEntries(FEATURE_KEYS.map(k => [k, Boolean((plan.features as any)?.[k])])),
  }
}

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const load = () => {
    fetch('/api/admin/organizations')
      .then(r => r.json())
      .then(data => setPlans(data.plans || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const startEdit = (plan: Plan) => {
    setEditingId(plan.id)
    setEditState(planToEdit(plan))
    setSaveError(null)
    setSavedId(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditState(null)
    setSaveError(null)
  }

  const save = async (plan: Plan) => {
    if (!editState) return
    setSaving(true)
    setSaveError(null)
    try {
      const limitsPayload: Record<string, number> = {}
      for (const k of LIMIT_KEYS) {
        const v = editState.limits[k]
        if (v !== '' && v != null) limitsPayload[k] = Number(v)
      }
      const res = await fetch('/api/admin/subscription-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updatePlan',
          planId: plan.id,
          code: plan.code,
          name: editState.name,
          description: editState.description || null,
          status: editState.status,
          priceMonthly: editState.priceMonthly ? Number(editState.priceMonthly) : null,
          priceYearly: editState.priceYearly ? Number(editState.priceYearly) : null,
          currency: plan.currency,
          limits: limitsPayload,
          features: editState.features,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      setSavedId(plan.id)
      cancelEdit()
      load()
      setTimeout(() => setSavedId(null), 3000)
    } catch (err: any) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    )
  }

  return (
    <div className="p-6 text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Тарифы</h1>
        <p className="mt-1 text-sm text-slate-400">Планы платформы, их лимиты и функции. Нажми карандаш чтобы редактировать.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map(plan => {
          const isEditing = editingId === plan.id
          const es = isEditing ? editState! : null

          return (
            <div key={plan.id} className={`rounded-xl border bg-white/[0.02] p-5 transition ${
              savedId === plan.id ? 'border-emerald-500/40' : 'border-white/10'
            }`}>
              {/* Header */}
              <div className="mb-4 flex items-start justify-between gap-2">
                {isEditing ? (
                  <Input
                    value={es!.name}
                    onChange={e => setEditState(prev => prev ? { ...prev, name: e.target.value } : prev)}
                    className="border-white/10 bg-slate-900/60 text-white font-semibold"
                  />
                ) : (
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-white">{plan.name}</p>
                      {savedId === plan.id && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                    </div>
                    {plan.description && <p className="mt-0.5 text-xs text-slate-400">{plan.description}</p>}
                  </div>
                )}
                {!isEditing && (
                  <button
                    onClick={() => startEdit(plan)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Description (edit mode) */}
              {isEditing && (
                <div className="mb-3">
                  <Input
                    value={es!.description}
                    onChange={e => setEditState(prev => prev ? { ...prev, description: e.target.value } : prev)}
                    placeholder="Описание тарифа"
                    className="border-white/10 bg-slate-900/60 text-white text-xs"
                  />
                </div>
              )}

              {/* Status (edit mode) */}
              {isEditing && (
                <div className="mb-3">
                  <select
                    value={es!.status}
                    onChange={e => setEditState(prev => prev ? { ...prev, status: e.target.value } : prev)}
                    className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-white"
                  >
                    <option value="active">Активен</option>
                    <option value="archived">Архив</option>
                  </select>
                </div>
              )}

              {/* Price */}
              <div className="mb-4 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={es!.priceMonthly}
                        onChange={e => setEditState(prev => prev ? { ...prev, priceMonthly: e.target.value } : prev)}
                        placeholder="Цена/мес"
                        className="border-white/10 bg-slate-900/60 text-white text-xs"
                      />
                      <span className="shrink-0 text-xs text-slate-500">₸/мес</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={es!.priceYearly}
                        onChange={e => setEditState(prev => prev ? { ...prev, priceYearly: e.target.value } : prev)}
                        placeholder="Цена/год"
                        className="border-white/10 bg-slate-900/60 text-white text-xs"
                      />
                      <span className="shrink-0 text-xs text-slate-500">₸/год</span>
                    </div>
                  </div>
                ) : (
                  <>
                    {plan.priceMonthly != null
                      ? <p className="text-white">{plan.priceMonthly.toLocaleString('ru')} {plan.currency}/мес</p>
                      : <p className="text-slate-400">Цена не задана</p>}
                    {plan.priceYearly != null && (
                      <p className="text-xs text-slate-500">{plan.priceYearly.toLocaleString('ru')} {plan.currency}/год</p>
                    )}
                  </>
                )}
              </div>

              {/* Limits */}
              <div className="mb-4 space-y-1.5">
                <p className="text-xs font-medium text-slate-500">Лимиты</p>
                {LIMIT_KEYS.map(key => {
                  const val = (plan.limits as any)?.[key]
                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">{LIMIT_LABELS[key]}</span>
                      {isEditing ? (
                        <Input
                          type="number"
                          value={es!.limits[key]}
                          onChange={e => setEditState(prev => prev ? {
                            ...prev,
                            limits: { ...prev.limits, [key]: e.target.value },
                          } : prev)}
                          className="h-6 w-20 border-white/10 bg-slate-900/60 px-2 text-right text-xs text-white"
                        />
                      ) : (
                        <span className="text-white">
                          {val === null || val === undefined ? '∞' : String(val)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Features */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-500">Функции</p>
                {FEATURE_KEYS.map(key => {
                  const enabled = isEditing ? es!.features[key] : !!(plan.features as any)?.[key]
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      {isEditing ? (
                        <button
                          type="button"
                          onClick={() => setEditState(prev => prev ? {
                            ...prev,
                            features: { ...prev.features, [key]: !prev.features[key] },
                          } : prev)}
                          className={`h-4 w-4 shrink-0 rounded border transition ${
                            enabled
                              ? 'border-emerald-500 bg-emerald-500'
                              : 'border-slate-600 bg-transparent'
                          }`}
                        />
                      ) : (
                        enabled
                          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          : <XCircle className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                      )}
                      <span className={enabled ? 'text-slate-200' : 'text-slate-500'}>
                        {FEATURE_LABELS[key]}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Edit actions */}
              {isEditing && (
                <div className="mt-4 space-y-2">
                  {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => save(plan)}
                      disabled={saving || !editState?.name}
                      className="flex-1 bg-violet-600 text-white hover:bg-violet-500"
                    >
                      {saving
                        ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        : <Save className="mr-1.5 h-3.5 w-3.5" />}
                      Сохранить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancelEdit}
                      disabled={saving}
                      className="border-white/10 text-white hover:bg-white/[0.04]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {plans.length === 0 && (
          <div className="col-span-3 py-10 text-center text-sm text-slate-500">
            Тарифы не настроены. Добавьте планы в таблицу{' '}
            <code className="text-slate-400">subscription_plans</code>.
          </div>
        )}
      </div>
    </div>
  )
}
