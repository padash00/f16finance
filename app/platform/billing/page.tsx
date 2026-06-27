'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Edit2, Layers, Loader2, Package, PlusCircle, Save, X, XCircle } from 'lucide-react'
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

const money = (n: number | null | undefined, currency = '₸') =>
  n != null ? `${Math.round(n).toLocaleString('ru-RU')} ${currency}` : null

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
  const [packages, setPackages] = useState<any[]>([])
  const [addons, setAddons] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const load = () => {
    fetch('/api/admin/organizations')
      .then(r => r.json())
      .then(data => {
        setPlans(data.plans || [])
        setPackages(data.packages || [])
        setAddons(data.addons || [])
      })
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
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Тарифы, пакеты и модули</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Что и почём продаём клиентам. Три уровня: тарифные планы (лимиты и функции),
          готовые отраслевые пакеты и докупаемые модули.
        </p>
      </div>

      {/* ── Тарифные планы ─────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300">
            <Layers className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Тарифные планы</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Лимиты и функции платформы. Нажми карандаш, чтобы изменить.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map(plan => {
            const isEditing = editingId === plan.id
            const es = isEditing ? editState! : null

            return (
              <div
                key={plan.id}
                className={`flex flex-col rounded-2xl border bg-white p-5 transition dark:bg-slate-900/40 ${
                  savedId === plan.id ? 'border-emerald-500/40' : 'border-slate-200 dark:border-white/10'
                }`}
              >
                {/* Header */}
                <div className="mb-4 flex items-start justify-between gap-2">
                  {isEditing ? (
                    <Input
                      value={es!.name}
                      onChange={e => setEditState(prev => prev ? { ...prev, name: e.target.value } : prev)}
                      className="border-slate-200 bg-white font-semibold text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
                    />
                  ) : (
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900 dark:text-white">{plan.name}</p>
                        {plan.status !== 'active' && (
                          <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">Архив</span>
                        )}
                        {savedId === plan.id && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                      </div>
                      {plan.description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{plan.description}</p>}
                    </div>
                  )}
                  {!isEditing && (
                    <button
                      onClick={() => startEdit(plan)}
                      className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/[0.06] dark:hover:text-white"
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
                      className="border-slate-200 bg-white text-xs text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
                    />
                  </div>
                )}

                {/* Status (edit mode) */}
                {isEditing && (
                  <div className="mb-3">
                    <select
                      value={es!.status}
                      onChange={e => setEditState(prev => prev ? { ...prev, status: e.target.value } : prev)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
                    >
                      <option value="active">Активен</option>
                      <option value="archived">Архив</option>
                    </select>
                  </div>
                )}

                {/* Price */}
                <div className="mb-4 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.03]">
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={es!.priceMonthly}
                          onChange={e => setEditState(prev => prev ? { ...prev, priceMonthly: e.target.value } : prev)}
                          placeholder="Цена/мес"
                          className="border-slate-200 bg-white text-xs text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
                        />
                        <span className="shrink-0 text-xs text-slate-500">₸/мес</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={es!.priceYearly}
                          onChange={e => setEditState(prev => prev ? { ...prev, priceYearly: e.target.value } : prev)}
                          placeholder="Цена/год"
                          className="border-slate-200 bg-white text-xs text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
                        />
                        <span className="shrink-0 text-xs text-slate-500">₸/год</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {plan.priceMonthly != null ? (
                        <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                          {money(plan.priceMonthly, plan.currency)}
                          <span className="text-xs font-normal text-slate-500">/мес</span>
                        </p>
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400">Цена не задана</p>
                      )}
                      {plan.priceYearly != null && (
                        <p className="mt-0.5 text-xs tabular-nums text-slate-500">{money(plan.priceYearly, plan.currency)}/год</p>
                      )}
                    </>
                  )}
                </div>

                {/* Limits */}
                <div className="mb-4 space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Лимиты</p>
                  {LIMIT_KEYS.map(key => {
                    const val = (plan.limits as any)?.[key]
                    return (
                      <div key={key} className="flex items-center justify-between text-sm">
                        <span className="text-slate-500 dark:text-slate-400">{LIMIT_LABELS[key]}</span>
                        {isEditing ? (
                          <Input
                            type="number"
                            value={es!.limits[key]}
                            onChange={e => setEditState(prev => prev ? {
                              ...prev,
                              limits: { ...prev.limits, [key]: e.target.value },
                            } : prev)}
                            className="h-6 w-20 border-slate-200 bg-white px-2 text-right text-xs text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
                          />
                        ) : (
                          <span className="font-medium tabular-nums text-slate-900 dark:text-white">
                            {val === null || val === undefined ? '∞' : String(val)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Features — что входит */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Что входит</p>
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
                                : 'border-slate-300 bg-transparent dark:border-slate-600'
                            }`}
                          />
                        ) : (
                          enabled
                            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            : <XCircle className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />
                        )}
                        <span className={enabled ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}>
                          {FEATURE_LABELS[key]}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Edit actions */}
                {isEditing && (
                  <div className="mt-4 space-y-2">
                    {saveError && <p className="text-xs text-rose-500">{saveError}</p>}
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
                        className="border-slate-200 text-slate-900 hover:bg-slate-100 dark:border-white/10 dark:text-white dark:hover:bg-white/[0.04]"
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
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/[0.02]">
              Тарифы не настроены. Добавьте планы в таблицу{' '}
              <code className="text-slate-500 dark:text-slate-400">subscription_plans</code>.
            </div>
          )}
        </div>
      </section>

      {/* ── Отраслевые пакеты ──────────────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
            <Package className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Отраслевые пакеты</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Готовые наборы под клиента. Назначаются в карточке организации («Пакет и модули»).
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p: any) => (
            <div key={p.code} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                {p.vertical && (
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">{p.vertical}</span>
                )}
              </div>
              {p.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{p.description}</p>}
              <div className="mt-3 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {Number(p.price_kzt || 0).toLocaleString('ru-RU')} ₸
                <span className="text-xs font-normal text-slate-500">/мес</span>
              </div>
              {Array.isArray(p.feature_codes) && p.feature_codes.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Что входит</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.feature_codes.map((c: string) => (
                      <span key={c} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-white/5 dark:text-slate-300">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {packages.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/[0.02]">
              Пакеты не настроены (таблица <code className="text-slate-500 dark:text-slate-400">packages</code>).
            </div>
          )}
        </div>
      </section>

      {/* ── Дополнительные модули ──────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
            <PlusCircle className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Дополнительные модули (add-ons)</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Докупаются к любому пакету сверху.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {addons.map((a: any) => (
            <div key={a.code} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{a.name}</h3>
                {a.billing_unit && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/5 dark:text-slate-400">{a.billing_unit}</span>
                )}
              </div>
              {a.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{a.description}</p>}
              <div className="mt-3 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {Number(a.price_kzt || 0).toLocaleString('ru-RU')} ₸
              </div>
              {Array.isArray(a.feature_codes) && a.feature_codes.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Что входит</p>
                  <div className="flex flex-wrap gap-1.5">
                    {a.feature_codes.map((c: string) => (
                      <span key={c} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-white/5 dark:text-slate-300">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {addons.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/[0.02]">
              Модули не настроены (таблица <code className="text-slate-500 dark:text-slate-400">addons</code>).
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
