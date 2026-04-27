'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Upload,
  Receipt,
  ShieldCheck,
  HelpCircle,
  Loader2,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getFinancialGroupLabel, type FinancialGroup } from '@/lib/core/financial-groups'

type Category = { id: string; name: string; accounting_group: FinancialGroup | null }
type Company = { id: string; name: string; code?: string | null }
type Operator = { id: string; name: string; short_name: string | null; is_active: boolean }
type WhitelistVendor = {
  id: string
  vendor_name: string
  company_id: string | null
  default_category_id: string | null
}
type AiCategoryHint = {
  recommended_category: string
  alternatives: string[]
  reason: string
  questions: string[]
}

type DocumentKind = 'receipt' | 'invoice' | 'bill' | 'whitelist' | 'one_off'

type WizardPayload = {
  date: string
  company_id: string
  operator_id: string | null
  category_id: string
  category_name: string
  amount_cash: number
  amount_kaspi: number
  item_name: string
  comment: string
  backdated_confirmed: boolean
  document_kind: DocumentKind | null
  document_url: string | null
  whitelist_vendor_id: string | null
  one_off_payee: string
  one_off_reason: string
}

const todayISO = () => {
  const d = new Date()
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const fmtMoney = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
const inputBaseClass = 'w-full h-10 px-3 rounded-md border bg-background'
const inputErrorClass = 'border-destructive ring-1 ring-destructive/30'
const validHintClass = 'text-[11px] text-emerald-400 mt-1'

function emptyPayload(): WizardPayload {
  return {
    date: todayISO(),
    company_id: '',
    operator_id: null,
    category_id: '',
    category_name: '',
    amount_cash: 0,
    amount_kaspi: 0,
    item_name: '',
    comment: '',
    backdated_confirmed: false,
    document_kind: null,
    document_url: null,
    whitelist_vendor_id: null,
    one_off_payee: '',
    one_off_reason: '',
  }
}

export default function ExpenseWizardPage() {
  return (
    <Suspense fallback={<ExpenseWizardPageFallback />}>
      <ExpenseWizardPageContent />
    </Suspense>
  )
}

function ExpenseWizardPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const embedded = searchParams.get('embedded') === '1'

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [payload, setPayload] = useState<WizardPayload>(emptyPayload)
  const [categories, setCategories] = useState<Category[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [whitelist, setWhitelist] = useState<WhitelistVendor[]>([])
  const [categoryQuery, setCategoryQuery] = useState('')
  const [operatorsLoaded, setOperatorsLoaded] = useState(false)
  const [whitelistLoaded, setWhitelistLoaded] = useState(false)
  const [loadingOperators, setLoadingOperators] = useState(false)
  const [loadingWhitelist, setLoadingWhitelist] = useState(false)

  const [loadingCatalogs, setLoadingCatalogs] = useState(true)
  const [starting, setStarting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ status: string; id: string } | null>(null)
  const [aiHint, setAiHint] = useState<AiCategoryHint | null>(null)
  const [aiHintLoading, setAiHintLoading] = useState(false)
  const [aiHintError, setAiHintError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoadingCatalogs(true)
      try {
        const [catRes, compRes] = await Promise.all([
          fetch('/api/admin/expense-categories', { cache: 'no-store' }),
          fetch('/api/admin/companies', { cache: 'no-store' }),
        ])
        const cats = catRes.ok ? (await catRes.json()).data || [] : []
        const comps = compRes.ok ? (await compRes.json()).data || [] : []
        if (cancelled) return
        setCategories(cats)
        setCompanies(comps)
      } catch {
        if (!cancelled) setError('Не удалось загрузить справочники')
      } finally {
        if (!cancelled) setLoadingCatalogs(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (payload.company_id || companies.length === 0) return
    const preferred = companies.find((c) => String(c.code || '').toLowerCase() === 'arena') || companies[0]
    if (preferred?.id) {
      setPayload((prev) => ({ ...prev, company_id: preferred.id }))
    }
  }, [companies, payload.company_id])

  useEffect(() => {
    if (sessionId || starting) return
    const start = async () => {
      setStarting(true)
      try {
        const response = await fetch('/api/admin/expenses/wizard', { method: 'POST' })
        const json = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(json.error || 'Не удалось запустить мастер')
        setSessionId(json.data.id)
      } catch (e: any) {
        setError(e?.message || 'Не удалось запустить мастер')
      } finally {
        setStarting(false)
      }
    }
    start()
  }, [sessionId, starting])

  useEffect(() => {
    if (operatorsLoaded || loadingOperators || step !== 1) return
    let cancelled = false
    const loadOperators = async () => {
      setLoadingOperators(true)
      try {
        const opRes = await fetch('/api/admin/operators?active_only=true', { cache: 'no-store' })
        const ops = opRes.ok ? (await opRes.json()).data || [] : []
        if (cancelled) return
        setOperators(ops)
        setOperatorsLoaded(true)
      } finally {
        if (!cancelled) setLoadingOperators(false)
      }
    }
    loadOperators()
    return () => {
      cancelled = true
    }
  }, [operatorsLoaded, loadingOperators, step])

  useEffect(() => {
    if (whitelistLoaded || loadingWhitelist || step < 2) return
    let cancelled = false
    const loadWhitelist = async () => {
      setLoadingWhitelist(true)
      try {
        const wlRes = await fetch('/api/admin/expenses/whitelist', { cache: 'no-store' })
        const wl = wlRes.ok ? (await wlRes.json()).data || [] : []
        if (cancelled) return
        setWhitelist(wl)
        setWhitelistLoaded(true)
      } finally {
        if (!cancelled) setLoadingWhitelist(false)
      }
    }
    loadWhitelist()
    return () => {
      cancelled = true
    }
  }, [whitelistLoaded, loadingWhitelist, step])

  const total = payload.amount_cash + payload.amount_kaspi
  const dateMs = useMemo(() => new Date(payload.date).getTime(), [payload.date])
  const isBackdated = useMemo(() => dateMs < Date.now() - 7 * 24 * 60 * 60 * 1000, [dateMs])

  const groupedCategories = useMemo(() => {
    const map = new Map<string, Category[]>()
    for (const cat of categories) {
      const group = String(cat.accounting_group || 'operating')
      const list = map.get(group) || []
      list.push(cat)
      map.set(group, list)
    }
    return Array.from(map.entries()).map(([group, items]) => ({
      group,
      label: getFinancialGroupLabel(group as FinancialGroup),
      items: items.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    }))
  }, [categories])
  const filteredGroupedCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase()
    if (!q) return groupedCategories
    return groupedCategories
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.name.toLowerCase().includes(q)),
      }))
      .filter((group) => group.items.length > 0)
  }, [groupedCategories, categoryQuery])
  const filteredCategoriesCount = useMemo(
    () => filteredGroupedCategories.reduce((acc, group) => acc + group.items.length, 0),
    [filteredGroupedCategories],
  )

  const eligibleWhitelist = useMemo(() => {
    if (!payload.company_id) return whitelist
    return whitelist.filter((v) => !v.company_id || v.company_id === payload.company_id)
  }, [whitelist, payload.company_id])

  const step1Valid =
    !!payload.date
    && !!payload.company_id
    && !!payload.category_id
    && payload.item_name.trim().length >= 5
    && payload.comment.trim().length >= 20
    && total > 0
    && (!isBackdated || payload.backdated_confirmed)

  const step1Errors: string[] = []
  if (!payload.company_id) step1Errors.push('Не выбрана точка')
  if (!payload.category_id) step1Errors.push('Не выбрана категория')
  if (payload.item_name.trim().length < 5) step1Errors.push('Краткое название меньше 5 символов')
  if (payload.comment.trim().length < 20) step1Errors.push('Комментарий меньше 20 символов')
  if (total <= 0) step1Errors.push('Сумма расхода должна быть больше 0')
  if (!payload.date) step1Errors.push('Не выбрана дата расхода')
  if (isBackdated && !payload.backdated_confirmed) step1Errors.push('Нужно подтвердить старую дату расхода')

  const step2Valid = (() => {
    const k = payload.document_kind
    if (!k) return false
    if (k === 'receipt' || k === 'invoice' || k === 'bill') return !!payload.document_url
    if (k === 'whitelist') return !!payload.whitelist_vendor_id
    if (k === 'one_off') {
      return payload.one_off_payee.trim().length >= 3 && payload.one_off_reason.trim().length >= 30
    }
    return false
  })()
  const isCompanyValid = !!payload.company_id
  const isCategoryValid = !!payload.category_id
  const isItemNameValid = payload.item_name.trim().length >= 5
  const isCommentValid = payload.comment.trim().length >= 20
  const isAmountValid = total > 0
  const isDateValid = !!payload.date && (!isBackdated || payload.backdated_confirmed)
  const step2Errors: string[] = []
  if (!payload.document_kind) {
    step2Errors.push('Выберите тип подтверждения расхода')
  } else if (payload.document_kind === 'receipt' || payload.document_kind === 'invoice' || payload.document_kind === 'bill') {
    if (!payload.document_url) step2Errors.push('Загрузите чек / накладную / счет')
  } else if (payload.document_kind === 'whitelist') {
    if (!payload.whitelist_vendor_id) step2Errors.push('Выберите доверенного поставщика')
  } else if (payload.document_kind === 'one_off') {
    if (payload.one_off_payee.trim().length < 3) step2Errors.push('Поле "Кому платим" должно быть минимум 3 символа')
    if (payload.one_off_reason.trim().length < 30) step2Errors.push('Поле "Почему нет чека" должно быть минимум 30 символов')
  }

  async function patchSession(nextStep: number, partial: Partial<WizardPayload>) {
    if (!sessionId) throw new Error('session not started')
    const response = await fetch('/api/admin/expenses/wizard', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, step: nextStep, payload: partial }),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(json.error || 'Не удалось сохранить шаг')
  }

  async function handleNextFromStep1() {
    if (!step1Valid) return
    setError(null)
    setSaving(true)
    try {
      await patchSession(1, {
        date: payload.date,
        company_id: payload.company_id,
        operator_id: payload.operator_id,
        category_id: payload.category_id,
        category_name: payload.category_name,
        amount_cash: payload.amount_cash,
        amount_kaspi: payload.amount_kaspi,
        item_name: payload.item_name,
        comment: payload.comment,
        backdated_confirmed: payload.backdated_confirmed,
      })
      setStep(2)
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения шага 1')
    } finally {
      setSaving(false)
    }
  }

  async function handleNextFromStep2() {
    if (!step2Valid) return
    setError(null)
    setSaving(true)
    try {
      await patchSession(2, {
        document_kind: payload.document_kind,
        document_url: payload.document_url,
        whitelist_vendor_id: payload.whitelist_vendor_id,
        one_off_payee: payload.one_off_payee,
        one_off_reason: payload.one_off_reason,
      })
      setStep(3)
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения шага 2')
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    if (!sessionId) return
    setError(null)
    setSaving(true)
    try {
      const response = await fetch('/api/admin/expenses/wizard/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось создать расход')
      setDone({ status: json.data.status, id: json.data.id })
      if (embedded) {
        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'expense-wizard-created',
            payload: { id: json.data.id, status: json.data.status },
          }, window.location.origin)
        }
        return
      }
      setTimeout(() => {
        if (json.data.status === 'pending_approval') {
          router.push('/expenses/pending')
        } else {
          router.push('/expenses')
        }
      }, 1200)
    } catch (e: any) {
      setError(e?.message || 'Ошибка создания расхода')
    } finally {
      setSaving(false)
    }
  }

  async function askAiCategoryHint() {
    if (!payload.company_id) {
      setAiHintError('Сначала выберите точку.')
      return
    }
    if (payload.item_name.trim().length < 3 && payload.comment.trim().length < 10) {
      setAiHintError('Напишите либо в "Краткое название" (>=3), либо в "Комментарий" (>=10).')
      return
    }
    setAiHintLoading(true)
    setAiHintError(null)
    try {
      const response = await fetch('/api/admin/expenses/ai-category-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: payload.company_id,
          item_name: payload.item_name,
          comment: payload.comment,
        }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось получить подсказку ИИ')
      setAiHint((json.data || null) as AiCategoryHint | null)
    } catch (e: any) {
      setAiHintError(e?.message || 'Ошибка подсказки ИИ')
    } finally {
      setAiHintLoading(false)
    }
  }

  async function handleFile(file: File | null) {
    if (!file || !sessionId) return
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('session_id', sessionId)
      const response = await fetch('/api/admin/expenses/wizard/upload', {
        method: 'POST',
        body: fd,
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось загрузить файл')
      setPayload((prev) => ({ ...prev, document_url: json.document_url }))
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setUploading(false)
    }
  }

  if (done) {
    return (
      <div className="app-page-tight max-w-2xl mx-auto py-12">
        <Card className="p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">
            {done.status === 'pending_approval' ? 'Отправлено на одобрение' : 'Расход создан'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {done.status === 'pending_approval'
              ? 'Владелец получит уведомление в Telegram. Перенаправляем...'
              : 'Перенаправляем в журнал...'}
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="app-page-tight max-w-3xl mx-auto py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/expenses">
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Новый расход</h1>
          <p className="text-sm text-muted-foreground">Шаг {step} из 3</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-2 flex-1 rounded-full ${n <= step ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className={`rounded-md border px-2 py-1 ${step >= 1 ? 'border-primary/40 bg-primary/5 text-primary' : 'text-muted-foreground'}`}>
            1) Что и куда
          </div>
          <div className={`rounded-md border px-2 py-1 ${step >= 2 ? 'border-primary/40 bg-primary/5 text-primary' : 'text-muted-foreground'}`}>
            2) Документ
          </div>
          <div className={`rounded-md border px-2 py-1 ${step >= 3 ? 'border-primary/40 bg-primary/5 text-primary' : 'text-muted-foreground'}`}>
            3) Подтверждение
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {step === 1 && (
        <Card className="p-6 space-y-5">
          {!step1Valid && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="text-sm font-semibold text-amber-300 mb-1">Что нужно заполнить:</div>
              <ul className="text-xs text-amber-100/90 space-y-1">
                {step1Errors.map((err) => (
                  <li key={err}>- {err}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <label className="text-sm font-medium mb-1 flex items-center gap-2">
              <span>Точка</span>
              {isCompanyValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : null}
            </label>
            {loadingCatalogs ? (
              <div className="text-sm text-muted-foreground">Загрузка...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPayload((p) => ({ ...p, company_id: c.id }))}
                    className={`text-left rounded-md border px-3 py-2 transition ${
                      payload.company_id === c.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {isCompanyValid ? <p className={validHintClass}>Точка выбрана</p> : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <label className="text-sm font-medium mb-1 flex items-center gap-2">
                <span>Категория</span>
                {isCategoryValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : null}
              </label>
              <input
                value={categoryQuery}
                onChange={(e) => setCategoryQuery(e.target.value)}
                placeholder="Поиск категории (например: зарплата, хоз, закуп)"
                className={`${inputBaseClass} mb-2`}
              />
              <div className="max-h-64 overflow-auto rounded-md border p-2 space-y-2">
                {filteredGroupedCategories.map((g) => (
                  <div key={g.group}>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 px-1">
                      {g.label}
                    </div>
                    <div className="flex flex-wrap gap-2">
                    {g.items.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setPayload((p) => ({
                            ...p,
                            category_id: c.id,
                            category_name: c.name,
                          }))
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs transition ${
                          payload.category_id === c.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/40'
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                    </div>
                  </div>
                ))}
                {filteredCategoriesCount === 0 ? (
                  <div className="text-xs text-amber-400 px-1">Ничего не найдено. Попробуй другое слово.</div>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Найдено категорий: {filteredCategoriesCount}
              </p>
              {isCategoryValid ? <p className={validHintClass}>Категория выбрана</p> : null}
            </div>
            <div className="rounded-md border bg-muted/20 p-3 h-fit">
              <div className="text-sm font-semibold mb-1">Затрудняешься с категорией?</div>
              <div className="text-xs text-muted-foreground mb-3">
                Напиши расход в "Краткое название" или "Комментарий", затем нажми кнопку.
              </div>
              <Button
                variant="outline"
                className="w-full mb-2"
                onClick={askAiCategoryHint}
                disabled={aiHintLoading}
              >
                {aiHintLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Спросить ИИ
              </Button>
              {aiHintError ? (
                <div className="text-xs text-destructive">{aiHintError}</div>
              ) : null}
              {aiHint ? (
                <div className="space-y-2 mt-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Рекомендация</div>
                    <div className="font-semibold text-foreground">{aiHint.recommended_category}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Почему</div>
                    <div>{aiHint.reason}</div>
                  </div>
                  {aiHint.alternatives.length > 0 ? (
                    <div>
                      <div className="text-muted-foreground">Альтернативы</div>
                      <div>{aiHint.alternatives.join(', ')}</div>
                    </div>
                  ) : null}
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const cat = categories.find((c) => c.name.toLowerCase() === aiHint.recommended_category.toLowerCase())
                      if (!cat) return
                      setPayload((p) => ({ ...p, category_id: cat.id, category_name: cat.name }))
                    }}
                  >
                    Применить рекомендацию
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 flex items-center gap-2">
              <span>Краткое название</span>
              {isItemNameValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : null}
            </label>
            <input
              value={payload.item_name}
              onChange={(e) => setPayload((p) => ({ ...p, item_name: e.target.value }))}
              placeholder="Например: Кофе зерно, Зарплата Мерея за апрель"
              className={`${inputBaseClass} ${payload.item_name.trim().length < 5 ? inputErrorClass : ''}`}
            />
            <p className="text-xs text-muted-foreground mt-1">Минимум 5 символов</p>
            {isItemNameValid ? <p className={validHintClass}>Ок, название понятное</p> : null}
          </div>

          <div>
            <label className="text-sm font-medium mb-1 flex items-center gap-2">
              <span>Комментарий</span>
              {isCommentValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : null}
            </label>
            <textarea
              rows={3}
              value={payload.comment}
              onChange={(e) => setPayload((p) => ({ ...p, comment: e.target.value }))}
              placeholder="Подробнее: зачем покупка, для кого, на какую смену"
              className={`w-full px-3 py-2 rounded-md border bg-background resize-none ${payload.comment.trim().length < 20 ? inputErrorClass : ''}`}
            />
            <p className="text-xs text-muted-foreground mt-1">Минимум 20 символов ({payload.comment.trim().length})</p>
            {isCommentValid ? <p className={validHintClass}>Комментарий заполнен</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Наличные ₸</label>
              <input
                type="number"
                min="0"
                value={payload.amount_cash || ''}
                onChange={(e) => setPayload((p) => ({ ...p, amount_cash: Math.max(0, Number(e.target.value) || 0) }))}
                className={`${inputBaseClass} ${(payload.amount_cash + payload.amount_kaspi) <= 0 ? inputErrorClass : ''}`}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Kaspi / Карта ₸</label>
              <input
                type="number"
                min="0"
                value={payload.amount_kaspi || ''}
                onChange={(e) => setPayload((p) => ({ ...p, amount_kaspi: Math.max(0, Number(e.target.value) || 0) }))}
                className={`${inputBaseClass} ${(payload.amount_cash + payload.amount_kaspi) <= 0 ? inputErrorClass : ''}`}
              />
            </div>
          </div>
          {total > 0 && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>Итого: <span className="font-semibold text-foreground">{fmtMoney(total)}</span></span>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 flex items-center gap-2">
              <span>Дата</span>
              {isDateValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : null}
            </label>
            <input
              type="date"
              value={payload.date}
              max={todayISO()}
              onChange={(e) => setPayload((p) => ({ ...p, date: e.target.value, backdated_confirmed: false }))}
              className={`${inputBaseClass} ${!payload.date || (isBackdated && !payload.backdated_confirmed) ? inputErrorClass : ''}`}
            />
            {isBackdated && (
              <label className="mt-2 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={payload.backdated_confirmed}
                  onChange={(e) => setPayload((p) => ({ ...p, backdated_confirmed: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>Подтверждаю, что это действительно расход старше 7 дней. Это действие будет залогировано.</span>
              </label>
            )}
            {isDateValid ? <p className={validHintClass}>Дата подтверждена</p> : null}
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Оператор смены (опционально)</label>
            {loadingOperators ? (
              <div className="text-xs text-muted-foreground mb-1">Загружаю операторов...</div>
            ) : null}
            <select
              value={payload.operator_id || ''}
              onChange={(e) => setPayload((p) => ({ ...p, operator_id: e.target.value || null }))}
              className="w-full h-10 px-3 rounded-md border bg-background"
            >
              <option value="">— Не привязан —</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>{op.short_name || op.name}</option>
              ))}
            </select>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="p-6 space-y-4">
          <h3 className="font-semibold">Подтверждающий документ</h3>
          {!step2Valid && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="text-sm font-semibold text-amber-300 mb-1">Что еще нужно:</div>
              <ul className="text-xs text-amber-100/90 space-y-1">
                {step2Errors.map((err) => (
                  <li key={err}>- {err}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => setPayload((p) => ({ ...p, document_kind: 'receipt' }))}
            className={`w-full text-left p-4 rounded-lg border transition ${
              payload.document_kind === 'receipt' || payload.document_kind === 'invoice' || payload.document_kind === 'bill'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <div className="flex items-start gap-3">
              <Receipt className="w-5 h-5 mt-0.5 text-primary" />
              <div className="flex-1">
                <div className="font-medium">Чек / накладная / счёт</div>
                <p className="text-xs text-muted-foreground mt-1">Загрузите фото или PDF документа</p>
              </div>
            </div>
          </button>

          {(payload.document_kind === 'receipt' || payload.document_kind === 'invoice' || payload.document_kind === 'bill') && (
            <div className="ml-8 space-y-3">
              <div className="flex gap-2">
                {(['receipt', 'invoice', 'bill'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPayload((p) => ({ ...p, document_kind: k }))}
                    className={`px-3 py-1.5 text-xs rounded-full border ${
                      payload.document_kind === k ? 'border-primary bg-primary/10' : 'border-border'
                    }`}
                  >
                    {k === 'receipt' ? 'Чек' : k === 'invoice' ? 'Накладная' : 'Счёт'}
                  </button>
                ))}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              {payload.document_url ? (
                <div className="p-3 rounded-md border bg-muted/30 flex items-center justify-between">
                  <a href={payload.document_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                    Открыть загруженный документ
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPayload((p) => ({ ...p, document_url: null }))}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full"
                >
                  {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  Загрузить файл (до 10 МБ)
                </Button>
              )}
              {payload.document_url ? <p className={validHintClass}>Документ загружен</p> : null}
            </div>
          )}

          <button
            type="button"
            onClick={() => setPayload((p) => ({ ...p, document_kind: 'whitelist', document_url: null }))}
            className={`w-full text-left p-4 rounded-lg border transition ${
              payload.document_kind === 'whitelist' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 mt-0.5 text-emerald-500" />
              <div className="flex-1">
                <div className="font-medium">Без документа — постоянный поставщик</div>
                <p className="text-xs text-muted-foreground mt-1">Уборщик, дворник, регулярные платежи из доверенного списка</p>
              </div>
            </div>
          </button>

          {payload.document_kind === 'whitelist' && (
            <div className="ml-8">
              {loadingWhitelist ? <p className="text-xs text-muted-foreground mb-2">Загружаю доверенных поставщиков...</p> : null}
              {eligibleWhitelist.length === 0 ? (
                <p className="text-sm text-amber-500">
                  Доверенных поставщиков нет.{' '}
                  <Link href="/expense-whitelist" className="underline">Добавить</Link>
                </p>
              ) : (
                <>
                  <select
                    value={payload.whitelist_vendor_id || ''}
                    onChange={(e) => setPayload((p) => ({ ...p, whitelist_vendor_id: e.target.value || null }))}
                    className={`${inputBaseClass} ${!payload.whitelist_vendor_id ? inputErrorClass : ''}`}
                  >
                    <option value="">— Выберите поставщика —</option>
                    {eligibleWhitelist.map((v) => (
                      <option key={v.id} value={v.id}>{v.vendor_name}</option>
                    ))}
                  </select>
                  {payload.whitelist_vendor_id ? <p className={validHintClass}>Поставщик выбран</p> : null}
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setPayload((p) => ({ ...p, document_kind: 'one_off', document_url: null, whitelist_vendor_id: null }))}
            className={`w-full text-left p-4 rounded-lg border transition ${
              payload.document_kind === 'one_off' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
          >
            <div className="flex items-start gap-3">
              <HelpCircle className="w-5 h-5 mt-0.5 text-amber-500" />
              <div className="flex-1">
                <div className="font-medium">Без документа — разовая услуга</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Расход уйдёт на одобрение владельцу. От владельца — сразу подтверждается.
                </p>
              </div>
            </div>
          </button>

          {payload.document_kind === 'one_off' && (
            <div className="ml-8 space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Кому платим</label>
                <input
                  value={payload.one_off_payee}
                  onChange={(e) => setPayload((p) => ({ ...p, one_off_payee: e.target.value }))}
                  placeholder="Имя или название"
                  className={`${inputBaseClass} ${payload.one_off_payee.trim().length < 3 ? inputErrorClass : ''}`}
                />
                {payload.one_off_payee.trim().length >= 3 ? <p className={validHintClass}>Получатель указан</p> : null}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Почему нет чека</label>
                <textarea
                  rows={3}
                  value={payload.one_off_reason}
                  onChange={(e) => setPayload((p) => ({ ...p, one_off_reason: e.target.value }))}
                  placeholder="Подробно: что, у кого, почему чек не выдали"
                  className={`w-full px-3 py-2 rounded-md border bg-background resize-none ${payload.one_off_reason.trim().length < 30 ? inputErrorClass : ''}`}
                />
                <p className="text-xs text-muted-foreground mt-1">Минимум 30 символов ({payload.one_off_reason.trim().length})</p>
                {payload.one_off_reason.trim().length >= 30 ? <p className={validHintClass}>Причина заполнена</p> : null}
              </div>
            </div>
          )}
        </Card>
      )}

      {step === 3 && (
        <Card className="p-6 space-y-4">
          <h3 className="font-semibold">Подтверждение</h3>

          <SummaryRow label="Точка" value={companies.find((c) => c.id === payload.company_id)?.name || '—'} />
          <SummaryRow label="Категория" value={`${payload.category_name} (${getFinancialGroupLabel(categories.find((c) => c.id === payload.category_id)?.accounting_group as FinancialGroup)})`} />
          <SummaryRow label="Краткое название" value={payload.item_name} />
          <SummaryRow label="Комментарий" value={payload.comment} multiline />
          <SummaryRow label="Сумма" value={fmtMoney(total)} />
          {payload.amount_cash > 0 && <SummaryRow label="  Наличные" value={fmtMoney(payload.amount_cash)} />}
          {payload.amount_kaspi > 0 && <SummaryRow label="  Kaspi/карта" value={fmtMoney(payload.amount_kaspi)} />}
          <SummaryRow label="Дата" value={payload.date} />
          {payload.operator_id && (
            <SummaryRow label="Оператор" value={operators.find((o) => o.id === payload.operator_id)?.short_name || operators.find((o) => o.id === payload.operator_id)?.name || ''} />
          )}
          <SummaryRow
            label="Документ"
            value={
              payload.document_kind === 'receipt' ? 'Чек'
                : payload.document_kind === 'invoice' ? 'Накладная'
                : payload.document_kind === 'bill' ? 'Счёт'
                : payload.document_kind === 'whitelist'
                  ? `Доверенный поставщик: ${whitelist.find((v) => v.id === payload.whitelist_vendor_id)?.vendor_name || ''}`
                  : payload.document_kind === 'one_off'
                    ? `Разовая услуга → ${payload.one_off_payee} (на одобрение)`
                    : '—'
            }
          />
        </Card>
      )}

      <div className="flex gap-3 mt-6">
        {step > 1 ? (
          <Button variant="outline" onClick={() => { setStep((s) => (s - 1) as 1 | 2 | 3); setError(null) }}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Назад
          </Button>
        ) : (
          <Link href="/expenses">
            <Button variant="outline">Отмена</Button>
          </Link>
        )}

        <div className="flex-1" />

        {step === 1 && (
          <Button onClick={handleNextFromStep1} disabled={!step1Valid || saving || !sessionId}>
            Далее <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
        {step === 2 && (
          <Button onClick={handleNextFromStep2} disabled={!step2Valid || saving}>
            Далее <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
        {step === 3 && (
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
            Создать расход
          </Button>
        )}
      </div>
    </div>
  )
}

function ExpenseWizardPageFallback() {
  return (
    <div className="app-page-tight max-w-3xl mx-auto py-6">
      <Card className="p-6">
        <div className="text-sm text-muted-foreground">Загрузка мастера расхода...</div>
      </Card>
    </div>
  )
}

function SummaryRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? '' : 'flex items-baseline gap-3'}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground min-w-[140px]">{label}</div>
      <div className={`text-sm ${multiline ? 'mt-1' : ''}`}>{value || '—'}</div>
    </div>
  )
}
