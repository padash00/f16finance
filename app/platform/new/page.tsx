'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PLANS = [
  { code: 'starter', name: 'Старт', description: 'До 2 точек, базовые отчёты', price: 'Бесплатно / Триал' },
  { code: 'growth', name: 'Рост', description: 'До 10 точек, AI-отчёты, инвентарь', price: '49 900 ₸/мес' },
  { code: 'enterprise', name: 'Предприятие', description: 'Без лимитов, white-label, поддержка', price: 'Договорная' },
]

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
}

export default function NewOrganizationPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [ownerFullName, setOwnerFullName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [trialDays, setTrialDays] = useState('14')
  const [planCode, setPlanCode] = useState('starter')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdOrg, setCreatedOrg] = useState<CreatedOrg | null>(null)

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
          planCode,
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
    setPlanCode('starter')
    setError(null)
  }

  if (createdOrg) {
    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-semibold text-white">Организация создана</h2>
        <p className="mt-2 text-sm text-slate-400">
          Поддомен <span className="text-violet-300">{createdOrg.primaryDomain}</span> активирован.
          После DNS-пропагации клиент сможет войти.
        </p>
        {createdOrg.appUrl && (
          <a
            href={createdOrg.appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Открыть рабочее пространство
          </a>
        )}
        <div className="mt-6 flex gap-3">
          <Button
            variant="outline"
            onClick={() => router.push('/platform/organizations')}
            className="border-white/10 text-white hover:bg-white/[0.04]"
          >
            К списку организаций
          </Button>
          <Button
            onClick={handleReset}
            className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
          >
            Создать ещё
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 text-white">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.push('/platform')} className="text-slate-400 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-white">Новая организация</h1>
          <p className="mt-0.5 text-sm text-slate-400">Шаг {step} из 2</p>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-8 flex gap-2">
        {[1, 2].map(s => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-violet-500' : 'bg-white/10'}`} />
        ))}
      </div>

      <div className="max-w-lg">
        {step === 1 && (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Название организации *</label>
              <Input
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="F16 Arena"
                className="border-white/10 bg-slate-900/60 text-white placeholder:text-slate-600"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Поддомен (slug) *</label>
              <div className="flex items-center gap-2">
                <Input
                  value={slug}
                  onChange={e => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setSlugManual(true) }}
                  placeholder="f16"
                  className="border-white/10 bg-slate-900/60 text-white placeholder:text-slate-600"
                />
                <span className="shrink-0 text-sm text-slate-500">.ordaops.kz</span>
              </div>
              {slug && (
                <p className="text-xs text-slate-500">
                  Клиент зайдёт по адресу: <span className="text-violet-300">{slug}.ordaops.kz</span>
                </p>
              )}
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-4">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Владелец (необязательно)</p>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500">Имя и фамилия</label>
                <Input
                  value={ownerFullName}
                  onChange={e => setOwnerFullName(e.target.value)}
                  placeholder="Алибек Сейткали"
                  className="border-white/10 bg-slate-900/60 text-white placeholder:text-slate-600"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500">Email</label>
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={e => setOwnerEmail(e.target.value)}
                  placeholder="alibek@example.com"
                  className="border-white/10 bg-slate-900/60 text-white placeholder:text-slate-600"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Пробный период (дней)</label>
              <Input
                type="number"
                value={trialDays}
                onChange={e => setTrialDays(e.target.value)}
                min={0}
                max={90}
                className="border-white/10 bg-slate-900/60 text-white w-28"
              />
            </div>
            <Button
              onClick={() => setStep(2)}
              disabled={!name.trim() || !slug.trim()}
              className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
            >
              Далее <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="space-y-3">
              <label className="text-xs font-medium text-slate-400">Тариф</label>
              {PLANS.map(plan => (
                <button
                  key={plan.code}
                  type="button"
                  onClick={() => setPlanCode(plan.code)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    planCode === plan.code
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-white">{plan.name}</p>
                    <p className="text-xs text-slate-400">{plan.price}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{plan.description}</p>
                </button>
              ))}
            </div>

            {/* Summary */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>Организация</span><span className="text-white">{name}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Поддомен</span><span className="text-violet-300">{slug}.ordaops.kz</span>
              </div>
              {ownerEmail && (
                <div className="flex justify-between text-slate-400">
                  <span>Владелец</span><span className="text-white">{ownerFullName || ownerEmail}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-400">
                <span>Пробный период</span><span className="text-white">{trialDays} дней</span>
              </div>
            </div>

            {error && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="border-white/10 text-white hover:bg-white/[0.04]">
                <ArrowLeft className="mr-2 h-4 w-4" /> Назад
              </Button>
              <Button
                onClick={handleCreate}
                disabled={loading}
                className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
                Создать организацию
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
