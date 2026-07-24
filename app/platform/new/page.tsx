'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Pkg = { code: string; name: string; description: string | null; feature_codes: string[]; price_kzt: number }
const money = (n: number) => `${(Number(n) || 0).toLocaleString('ru-RU')} ₸/мес`

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[а-яёa-z0-9]/gi, c => {
      const m: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' }
      return m[c] ?? c
    })
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

type CreatedOrg = {
  name: string
  slug: string
  primaryDomain: string
  appUrl: string
  planCode: string
  ownerEmail?: string | null
  ownerPassword?: string | null
}

const inputClass =
  'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 dark:border-white/10 dark:bg-slate-900/60 dark:text-white dark:placeholder:text-slate-600'

export default function NewOrganizationPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [ownerFullName, setOwnerFullName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [trialDays, setTrialDays] = useState('14')
  const [packages, setPackages] = useState<Pkg[]>([])
  const [packageCode, setPackageCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdOrg, setCreatedOrg] = useState<CreatedOrg | null>(null)

  useEffect(() => {
    fetch('/api/admin/platform/packages')
      .then((r) => r.json())
      .then((d) => setPackages((d?.packages || []).filter((p: any) => p.status !== 'archived')))
      .catch(() => {})
  }, [])

  const handleNameChange = (v: string) => {
    setName(v)
    if (!slugManual) setSlug(slugify(v))
  }

  const handleCreate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          packageCode: packageCode || null,
          trialDays: Number(trialDays) || 14,
          createPrimaryDomain: true,
          ownerFullName: ownerFullName.trim() || null,
          ownerEmail: ownerEmail.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка создания')
      setCreatedOrg(data.organization)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setCreatedOrg(null)
    setStep(1)
    setName('')
    setSlug('')
    setSlugManual(false)
    setOwnerFullName('')
    setOwnerEmail('')
    setTrialDays('14')
    setPackageCode('')
    setError(null)
  }

  if (createdOrg) {
    return (
      <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-white/10 dark:bg-slate-900/40">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-semibold">Клиент заведён</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Поддомен <span className="text-violet-600 dark:text-violet-300">{createdOrg.primaryDomain}</span> активирован.
            После обновления DNS клиент сможет войти.
          </p>
          {createdOrg.appUrl && (
            <a
              href={createdOrg.appUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть рабочее пространство
            </a>
          )}
          {createdOrg.ownerEmail && (
            <div className="mt-5 w-full rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-4 text-left">
              <p className="mb-2 text-xs font-semibold text-amber-700 dark:text-amber-300">Доступ владельца (передайте клиенту)</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">Email</span>
                  <span className="font-mono text-slate-900 dark:text-white">{createdOrg.ownerEmail}</span>
                </div>
                {createdOrg.ownerPassword ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500 dark:text-slate-400">Пароль</span>
                    <span className="font-mono text-slate-900 dark:text-white">{createdOrg.ownerPassword}</span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Аккаунт с таким email уже существовал — пароль не менялся.</p>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Вход на {createdOrg.primaryDomain}. При первом входе клиент сменит пароль.
              </p>
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <Button
              variant="outline"
              onClick={() => router.push('/platform/organizations')}
              className="border-slate-200 text-slate-900 hover:bg-slate-100 dark:border-white/10 dark:text-white dark:hover:bg-white/[0.04]"
            >
              К списку клиентов
            </Button>
            <Button
              onClick={handleReset}
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
              Завести ещё
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      {/* Шапка */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.push('/platform')} className="text-slate-400 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold">Новый клиент</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Шаг {step} из 2</p>
        </div>
      </div>

      {/* Прогресс */}
      <div className="mb-6 flex max-w-lg gap-2">
        {[1, 2].map(s => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-violet-500' : 'bg-slate-200 dark:bg-white/10'}`} />
        ))}
      </div>

      <div className="max-w-lg">
        {step === 1 && (
          <div className="space-y-4">
            {/* Клиент */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <h2 className="text-sm font-semibold">Клиент</h2>
              <div className="mt-4 space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Название клуба *</label>
                <Input
                  value={name}
                  onChange={e => handleNameChange(e.target.value)}
                  placeholder="F16 Arena"
                  className={inputClass}
                  autoFocus
                />
              </div>
            </div>

            {/* Поддомен */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <h2 className="text-sm font-semibold">Поддомен</h2>
              <div className="mt-4 space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Адрес входа *</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={slug}
                    onChange={e => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setSlugManual(true) }}
                    placeholder="f16"
                    className={inputClass}
                  />
                  <span className="shrink-0 text-sm text-slate-500">.ordaops.kz</span>
                </div>
                {slug && (
                  <p className="text-xs text-slate-500">
                    Клиент зайдёт по адресу: <span className="text-violet-600 dark:text-violet-300">{slug}.ordaops.kz</span>
                  </p>
                )}
              </div>
            </div>

            {/* Владелец */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <h2 className="text-sm font-semibold">Владелец <span className="font-normal text-slate-400">(необязательно)</span></h2>
              <div className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Имя и фамилия</label>
                  <Input
                    value={ownerFullName}
                    onChange={e => setOwnerFullName(e.target.value)}
                    placeholder="Алибек Сейткали"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Email</label>
                  <Input
                    type="email"
                    value={ownerEmail}
                    onChange={e => setOwnerEmail(e.target.value)}
                    placeholder="alibek@example.com"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            {/* Пробный период */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <h2 className="text-sm font-semibold">Пробный период</h2>
              <div className="mt-4 space-y-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Сколько дней бесплатно</label>
                <Input
                  type="number"
                  value={trialDays}
                  onChange={e => setTrialDays(e.target.value)}
                  min={0}
                  max={90}
                  className={`${inputClass} w-28 tabular-nums`}
                />
              </div>
            </div>

            <Button
              onClick={() => setStep(2)}
              disabled={!name.trim() || !slug.trim()}
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
              Далее <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* Пакет (тариф) — задаёт доступные страницы клиента */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <h2 className="text-sm font-semibold">Пакет</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Определяет, какие страницы будут у клиента. Позже можно сменить на карточке организации.</p>
              <div className="mt-4 space-y-2">
                {packages.length === 0 && (
                  <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    Пакетов пока нет. Создай их в «Конструкторе тарифов» — или заведи без пакета (полный доступ).
                  </p>
                )}
                {packages.map(pkg => (
                  <button
                    key={pkg.code}
                    type="button"
                    onClick={() => setPackageCode(packageCode === pkg.code ? '' : pkg.code)}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      packageCode === pkg.code
                        ? 'border-violet-500/50 bg-violet-500/10'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-slate-900 dark:text-white">{pkg.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{money(pkg.price_kzt)}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{pkg.description || `${pkg.feature_codes?.length || 0} страниц`}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Проверь перед созданием */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <h2 className="text-sm font-semibold">Проверь перед созданием</h2>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Клиент</span>
                  <span className="font-medium">{name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Поддомен</span>
                  <span className="font-medium text-violet-600 dark:text-violet-300">{slug}.ordaops.kz</span>
                </div>
                {ownerEmail && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Владелец</span>
                    <span className="font-medium">{ownerFullName || ownerEmail}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Пакет</span>
                  <span className="font-medium">{packages.find(p => p.code === packageCode)?.name || 'Без пакета (полный доступ)'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Пробный период</span>
                  <span className="font-medium tabular-nums">{trialDays} дней</span>
                </div>
              </div>
            </div>

            {error && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="border-slate-200 text-slate-900 hover:bg-slate-100 dark:border-white/10 dark:text-white dark:hover:bg-white/[0.04]">
                <ArrowLeft className="mr-2 h-4 w-4" /> Назад
              </Button>
              <Button
                onClick={handleCreate}
                disabled={loading}
                className="bg-violet-600 text-white hover:bg-violet-700"
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
                Завести клиента
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
