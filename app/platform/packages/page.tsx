'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Plus, Puzzle, Save, Trash2, Building2 } from 'lucide-react'

type PageFeature = { path: string; label: string; feature: string; group: string; base: boolean }
type Pkg = { code: string; name: string; vertical: string; description: string | null; feature_codes: string[]; price_kzt: number; status: string }
type Addon = { code: string; name: string; description: string | null; feature_codes: string[]; price_kzt: number; billing_unit: string; status: string }
type Org = { id: string; name: string; slug?: string | null }

const money = (n: number) => `${(Number(n) || 0).toLocaleString('ru-RU')} ₸`

async function api(method: 'GET' | 'POST', body?: any, qs = '') {
  const res = await fetch(`/api/admin/platform/packages${qs}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json
}

export default function PackagesConstructorPage() {
  const [tab, setTab] = useState<'packages' | 'addons' | 'assign'>('packages')
  const [pages, setPages] = useState<PageFeature[]>([])
  const [packages, setPackages] = useState<Pkg[]>([])
  const [addons, setAddons] = useState<Addon[]>([])
  const [orgs, setOrgs] = useState<Org[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000) }

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [data, orgRes] = await Promise.all([
        api('GET'),
        fetch('/api/admin/organizations').then((r) => r.json()).catch(() => ({})),
      ])
      setPages(data.pages || [])
      setPackages(data.packages || [])
      setAddons(data.addons || [])
      setOrgs((orgRes?.organizations || orgRes?.data || []).map((o: any) => ({ id: o.id, name: o.name, slug: o.slug })))
    } catch (e: any) { setError(e?.message || 'Ошибка загрузки') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  // Каталог страниц, сгруппированный по разделу (для пикера).
  const grouped = useMemo(() => {
    const map = new Map<string, PageFeature[]>()
    for (const p of pages) {
      if (!map.has(p.group)) map.set(p.group, [])
      map.get(p.group)!.push(p)
    }
    return Array.from(map.entries())
  }, [pages])

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Загрузка конструктора…</div>

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Конструктор тарифов</h1>
        <p className="mt-1 text-sm text-muted-foreground">Собирай пакеты из страниц, заводи докупаемые модули (аддоны) и назначай организациям. 1 фича = 1 страница.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}

      <div className="inline-flex rounded-xl border border-border bg-surface-muted p-1">
        {([['packages', 'Пакеты', Package], ['addons', 'Аддоны', Puzzle], ['assign', 'Назначение', Building2]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === key ? 'bg-emerald-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'packages' && <PackageEditor packages={packages} grouped={grouped} saving={saving} setSaving={setSaving} reload={load} showToast={showToast} />}
      {tab === 'addons' && <AddonEditor addons={addons} grouped={grouped} saving={saving} setSaving={setSaving} reload={load} showToast={showToast} />}
      {tab === 'assign' && <AssignTab orgs={orgs} packages={packages} addons={addons} saving={saving} setSaving={setSaving} showToast={showToast} />}
    </div>
  )
}

// ─── Пикер страниц (общий для пакета и аддона) ──────────────────────────────
function PagePicker({ grouped, selected, toggle, setMany }: { grouped: [string, PageFeature[]][]; selected: Set<string>; toggle: (f: string) => void; setMany: (features: string[], on: boolean) => void }) {
  const [q, setQ] = useState('')
  const norm = (s: string) => s.toLowerCase()
  const filtered = grouped
    .map(([group, items]) => [group, q ? items.filter((p) => norm(p.label).includes(norm(q)) || norm(p.path).includes(norm(q))) : items] as [string, PageFeature[]])
    .filter(([, items]) => items.length > 0)

  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск страницы…" className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground dark:bg-white/5" />
      <div className="max-h-[400px] space-y-4 overflow-y-auto rounded-xl border border-border bg-surface-muted p-4">
        {filtered.map(([group, items]) => {
          const sellable = items.filter((p) => !p.base)
          const selCount = sellable.filter((p) => selected.has(p.feature)).length
          const allOn = sellable.length > 0 && selCount === sellable.length
          return (
            <div key={group}>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group} <span className="text-emerald-600">{selCount}/{sellable.length}</span></div>
                {sellable.length > 0 && (
                  <button type="button" onClick={() => setMany(sellable.map((p) => p.feature), !allOn)} className="text-[11px] font-medium text-emerald-600 hover:text-emerald-700">
                    {allOn ? 'снять раздел' : 'выбрать раздел'}
                  </button>
                )}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {items.map((p) => (
                  <label key={p.feature} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${p.base ? 'border-border bg-surface-hover opacity-70' : selected.has(p.feature) ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' : 'border-border bg-white dark:bg-white/5 hover:border-emerald-300'}`}>
                    <input type="checkbox" disabled={p.base} checked={p.base || selected.has(p.feature)} onChange={() => toggle(p.feature)} className="h-4 w-4 accent-emerald-600" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{p.label}</span>
                    {p.base && <span className="shrink-0 text-[10px] text-muted-foreground">базовая</span>}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Ничего не найдено</div>}
      </div>
    </div>
  )
}

function PackageEditor({ packages, grouped, saving, setSaving, reload, showToast }: any) {
  const [editing, setEditing] = useState<Pkg | null>(null)
  const blank: Pkg = { code: '', name: '', vertical: 'custom', description: '', feature_codes: [], price_kzt: 0, status: 'active' }
  const cur = editing || blank
  const [sel, setSel] = useState<Set<string>>(new Set(cur.feature_codes))
  const start = (p: Pkg | null) => { const x = p || blank; setEditing(p || blank); setSel(new Set(x.feature_codes)) }
  const toggle = (f: string) => setSel((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n })
  const setMany = (fs: string[], on: boolean) => setSel((s) => { const n = new Set(s); fs.forEach((f) => (on ? n.add(f) : n.delete(f))); return n })
  const [form, setForm] = useState(cur)
  useEffect(() => { setForm(cur) /* eslint-disable-next-line */ }, [editing])

  const save = async () => {
    if (!form.code.trim()) { showToast('Укажи код пакета'); return }
    setSaving(true)
    try { await api('POST', { action: 'save_package', ...form, feature_codes: Array.from(sel) }); showToast('Пакет сохранён'); setEditing(null); await reload() }
    catch (e: any) { showToast(e?.message || 'Ошибка') } finally { setSaving(false) }
  }
  const del = async (code: string) => { if (!confirm(`Удалить пакет ${code}?`)) return; setSaving(true); try { await api('POST', { action: 'delete_package', code }); showToast('Удалён'); await reload() } catch (e: any) { showToast(e?.message) } finally { setSaving(false) } }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="space-y-2">
        <button onClick={() => start(null)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />Новый пакет</button>
        {packages.map((p: Pkg) => (
          <div key={p.code} className={`flex items-center justify-between rounded-xl border px-4 py-3 transition ${editing?.code === p.code ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' : 'border-border bg-white dark:bg-white/5 hover:border-emerald-300'}`}>
            <button onClick={() => start(p)} className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.feature_codes.length} стр. · {money(p.price_kzt)}/мес</div>
            </button>
            <button onClick={() => del(p.code)} className="ml-2 rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-white p-5 dark:bg-white/5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Код (латиницей, уникальный)" value={form.code} onChange={(v: string) => setForm({ ...form, code: v })} disabled={!!editing?.code} placeholder="finance" />
          <Field label="Название" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder="Orda Finance" />
          <Field label="Ниша" value={form.vertical} onChange={(v: string) => setForm({ ...form, vertical: v })} placeholder="finance / club / shop…" />
          <Field label="Цена в месяц, ₸" value={String(form.price_kzt)} onChange={(v: string) => setForm({ ...form, price_kzt: Number(v.replace(/\D/g, '')) || 0 })} placeholder="9900" />
        </div>
        <Field label="Описание" value={form.description || ''} onChange={(v: string) => setForm({ ...form, description: v })} placeholder="Для кого этот пакет" />
        <div>
          <div className="mb-2 text-sm font-medium text-foreground">Страницы в пакете <span className="text-muted-foreground">({sel.size} выбрано)</span></div>
          <PagePicker grouped={grouped} selected={sel} toggle={toggle} setMany={setMany} />
        </div>
        <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Сохранить пакет</button>
      </div>
    </div>
  )
}

function AddonEditor({ addons, grouped, saving, setSaving, reload, showToast }: any) {
  const [editing, setEditing] = useState<Addon | null>(null)
  const blank: Addon = { code: '', name: '', description: '', feature_codes: [], price_kzt: 0, billing_unit: 'organization', status: 'active' }
  const cur = editing || blank
  const [sel, setSel] = useState<Set<string>>(new Set(cur.feature_codes))
  const [form, setForm] = useState(cur)
  const start = (a: Addon | null) => { setEditing(a || blank); setSel(new Set((a || blank).feature_codes)) }
  useEffect(() => { setForm(cur) /* eslint-disable-next-line */ }, [editing])
  const toggle = (f: string) => setSel((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n })
  const setMany = (fs: string[], on: boolean) => setSel((s) => { const n = new Set(s); fs.forEach((f) => (on ? n.add(f) : n.delete(f))); return n })
  const save = async () => {
    if (!form.code.trim()) { showToast('Укажи код аддона'); return }
    setSaving(true)
    try { await api('POST', { action: 'save_addon', ...form, feature_codes: Array.from(sel) }); showToast('Аддон сохранён'); setEditing(null); await reload() }
    catch (e: any) { showToast(e?.message || 'Ошибка') } finally { setSaving(false) }
  }
  const del = async (code: string) => { if (!confirm(`Удалить аддон ${code}?`)) return; setSaving(true); try { await api('POST', { action: 'delete_addon', code }); showToast('Удалён'); await reload() } catch (e: any) { showToast(e?.message) } finally { setSaving(false) } }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="space-y-2">
        <button onClick={() => start(null)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />Новый аддон</button>
        {addons.map((a: Addon) => (
          <div key={a.code} className={`flex items-center justify-between rounded-xl border px-4 py-3 transition ${editing?.code === a.code ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' : 'border-border bg-white dark:bg-white/5 hover:border-emerald-300'}`}>
            <button onClick={() => start(a)} className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-medium text-foreground">{a.name}</div>
              <div className="text-xs text-muted-foreground">{a.feature_codes.length} стр. · {money(a.price_kzt)}/{a.billing_unit === 'company' ? 'точка' : a.billing_unit === 'device' ? 'устр.' : 'мес'}</div>
            </button>
            <button onClick={() => del(a.code)} className="ml-2 rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-white p-5 dark:bg-white/5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Код" value={form.code} onChange={(v: string) => setForm({ ...form, code: v })} disabled={!!editing?.code} placeholder="ai_cfo" />
          <Field label="Название" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder="AI CFO" />
          <Field label="Цена, ₸" value={String(form.price_kzt)} onChange={(v: string) => setForm({ ...form, price_kzt: Number(v.replace(/\D/g, '')) || 0 })} placeholder="9900" />
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Единица оплаты</label>
            <select value={form.billing_unit} onChange={(e) => setForm({ ...form, billing_unit: e.target.value })} className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground dark:bg-white/5">
              <option value="organization">за организацию</option>
              <option value="company">за точку</option>
              <option value="device">за устройство</option>
            </select>
          </div>
        </div>
        <Field label="Описание" value={form.description || ''} onChange={(v: string) => setForm({ ...form, description: v })} placeholder="Что даёт модуль" />
        <div>
          <div className="mb-2 text-sm font-medium text-foreground">Страницы аддона <span className="text-muted-foreground">({sel.size})</span></div>
          <PagePicker grouped={grouped} selected={sel} toggle={toggle} setMany={setMany} />
        </div>
        <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Сохранить аддон</button>
      </div>
    </div>
  )
}

function AssignTab({ orgs, packages, addons, saving, setSaving, showToast }: any) {
  const [orgId, setOrgId] = useState('')
  const [pkgCode, setPkgCode] = useState('')
  const [addonCodes, setAddonCodes] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const loadOrg = async (id: string) => {
    setOrgId(id); setPkgCode(''); setAddonCodes(new Set())
    if (!id) return
    setLoading(true)
    try { const d = await api('GET', undefined, `?organization_id=${encodeURIComponent(id)}`); setPkgCode(d.package_code || ''); setAddonCodes(new Set(d.addon_codes || [])) }
    catch (e: any) { showToast(e?.message) } finally { setLoading(false) }
  }
  const save = async () => {
    if (!orgId) { showToast('Выбери организацию'); return }
    setSaving(true)
    try { await api('POST', { action: 'assign_org', organization_id: orgId, package_code: pkgCode || null, addon_codes: Array.from(addonCodes) }); showToast('Назначено — доступ организации обновлён') }
    catch (e: any) { showToast(e?.message) } finally { setSaving(false) }
  }

  return (
    <div className="max-w-2xl space-y-5 rounded-2xl border border-border bg-white p-6 dark:bg-white/5">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Организация</label>
        <select value={orgId} onChange={(e) => loadOrg(e.target.value)} className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground dark:bg-white/5">
          <option value="">— выбери —</option>
          {orgs.map((o: Org) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      {loading && <div className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Загрузка…</div>}
      {orgId && !loading && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Пакет (база)</label>
            <select value={pkgCode} onChange={(e) => setPkgCode(e.target.value)} className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground dark:bg-white/5">
              <option value="">— без пакета (полный доступ) —</option>
              {packages.map((p: Pkg) => <option key={p.code} value={p.code}>{p.name} · {money(p.price_kzt)}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Без пакета организация имеет полный доступ (allAccess). С пакетом — только его страницы + аддоны.</p>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-foreground">Докупленные аддоны</div>
            <div className="space-y-1.5">
              {addons.map((a: Addon) => (
                <label key={a.code} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${addonCodes.has(a.code) ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' : 'border-border bg-white dark:bg-white/5'}`}>
                  <input type="checkbox" checked={addonCodes.has(a.code)} onChange={() => setAddonCodes((s) => { const n = new Set(s); n.has(a.code) ? n.delete(a.code) : n.add(a.code); return n })} className="h-4 w-4 accent-emerald-600" />
                  <span className="flex-1 text-foreground">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{money(a.price_kzt)}</span>
                </label>
              ))}
              {addons.length === 0 && <div className="text-sm text-muted-foreground">Аддонов пока нет — создай во вкладке «Аддоны».</div>}
            </div>
          </div>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Назначить организации</button>
        </>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, disabled }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60 dark:bg-white/5" />
    </div>
  )
}
