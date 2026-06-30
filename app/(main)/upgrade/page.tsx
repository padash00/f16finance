'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, Lock, Package, Puzzle, Sparkles, Loader2 } from 'lucide-react'
import { SUPPORT_CONTACT } from '@/lib/core/site'

const money = (n: number) => `${(Number(n) || 0).toLocaleString('ru-RU')} ₸`
const unitLabel = (u: string) => (u === 'company' ? 'за точку/мес' : u === 'device' ? 'за устройство/мес' : 'в месяц')

type Info = {
  pageLabel: string
  packages: { code: string; name: string; description: string | null; price_kzt: number }[]
  addons: { code: string; name: string; description: string | null; price_kzt: number; billing_unit: string }[]
}

export default function UpgradePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
      <UpgradeContent />
    </Suspense>
  )
}

function UpgradeContent() {
  const params = useSearchParams()
  const router = useRouter()
  const feature = params.get('feature') || params.get('upgrade') || ''
  const [info, setInfo] = useState<Info | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!feature) { setLoading(false); return }
    fetch(`/api/upgrade-info?feature=${encodeURIComponent(feature)}`)
      .then((r) => r.json())
      .then((d) => setInfo(d?.ok ? d : null))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false))
  }, [feature])

  const pageLabel = info?.pageLabel || 'Эта страница'

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <button onClick={() => router.push('/dashboard')} className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />На дашборд
      </button>

      <div className="overflow-hidden rounded-[2rem] border border-border bg-white shadow-[var(--card-shadow)] dark:bg-white/5">
        <div className="bg-[linear-gradient(135deg,#0a7d4a,#0f6b40)] px-8 py-10 text-white">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
            <Lock className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.02em]">«{pageLabel}» не входит в ваш тариф</h1>
          <p className="mt-2 max-w-xl text-sm leading-7 text-emerald-50/85">
            Эта страница доступна в подходящем пакете или как отдельный модуль. Подключите её — и она появится в меню.
          </p>
        </div>

        <div className="space-y-6 p-8">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Загрузка вариантов…</div>
          ) : (
            <>
              {info && info.packages.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Package className="h-4 w-4 text-emerald-600" />Входит в пакеты</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {info.packages.map((p) => (
                      <div key={p.code} className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/[0.07]">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="font-semibold text-foreground">{p.name}</div>
                          <div className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-300">{money(p.price_kzt)}<span className="text-xs font-normal text-muted-foreground">/мес</span></div>
                        </div>
                        {p.description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{p.description}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {info && info.addons.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Puzzle className="h-4 w-4 text-emerald-600" />Или докупите отдельно</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {info.addons.map((a) => (
                      <div key={a.code} className="rounded-2xl border border-border bg-surface-muted p-4">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="font-semibold text-foreground">{a.name}</div>
                          <div className="shrink-0 font-semibold text-foreground">{money(a.price_kzt)}<span className="text-xs font-normal text-muted-foreground"> {unitLabel(a.billing_unit)}</span></div>
                        </div>
                        {a.description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{a.description}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!info || (info.packages.length === 0 && info.addons.length === 0)) && (
                <p className="text-sm text-muted-foreground">Свяжитесь с менеджером Orda — подберём, как подключить эту страницу.</p>
              )}

              <div className="rounded-2xl border border-border bg-surface-muted p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Sparkles className="h-4 w-4 text-amber-500" />Как подключить</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Подключение оформляет менеджер Orda. Напишите в поддержку или вашему менеджеру — активируем нужный пакет/модуль, и страница сразу появится.
                </p>
                <a href={SUPPORT_CONTACT} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700">
                  Связаться с менеджером
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
