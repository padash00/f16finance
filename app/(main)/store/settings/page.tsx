'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Settings, Store, Check, Loader2, Save } from 'lucide-react'

type Company = { id: string; name: string; code: string | null }

export default function StoreSettingsPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [storeCompanyId, setStoreCompanyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/store/config', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка')
      setCompanies(j.data.companies || [])
      setStoreCompanyId(j.data.store_company_id || null)
      setSelected(j.data.store_company_id || '')
      setCanManage(!!j.data.can_manage)
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/admin/store/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_company_id: selected || null }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка сохранения')
      setStoreCompanyId(j.data.store_company_id || null)
      setMsg('Сохранено')
      setTimeout(() => setMsg(null), 2500)
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setSaving(false) }
  }

  const dirty = (selected || '') !== (storeCompanyId || '')

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Настройки магазина"
        description="Выберите точку, которая является магазином — модуль будет работать только с ней"
        icon={<Settings className="h-5 w-5" />}
        accent="emerald"
        backHref="/store"
      />

      <div className="rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/60 p-4 sm:p-5 shadow-lg shadow-black/20">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Store className="h-4 w-4 text-emerald-300" /> Точка магазина
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Склад, витрина, ревизия, документы, аналитика и смены будут показываться только по этой точке.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
        ) : companies.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Нет доступных точек</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {companies.map((c) => {
              const active = selected === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!canManage}
                  onClick={() => setSelected(c.id)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    active ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/20'
                  } ${!canManage ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                    {c.code ? <div className="text-xs text-slate-500">{c.code}</div> : null}
                  </div>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${active ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 text-transparent dark:border-white/15'}`}>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={!canManage || saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </button>
          {msg && <span className="text-sm text-emerald-700 dark:text-emerald-300">{msg}</span>}
          {err && <span className="text-sm text-rose-700 dark:text-rose-300">{err}</span>}
          {!canManage && <span className="text-xs text-slate-500">Только владелец/менеджер может менять</span>}
        </div>
      </div>
    </div>
  )
}
