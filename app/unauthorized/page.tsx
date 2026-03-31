'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowUpRight, Brain, Boxes, CreditCard, Lock, MessageSquareMore, MonitorSmartphone } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SessionRoleInfo } from '@/lib/core/types'
import { getSubscriptionFeatureMeta, normalizeSubscriptionFeature, type SubscriptionFeature } from '@/lib/core/access'
import { supabase } from '@/lib/supabaseClient'

const FEATURE_ICONS: Record<SubscriptionFeature, typeof Brain> = {
  ai_reports: Brain,
  inventory: Boxes,
  web_pos: MonitorSmartphone,
  telegram: MessageSquareMore,
  custom_branding: CreditCard,
}

function isSafeInternalPath(value: string | null) {
  return !!value && value.startsWith('/') && !value.startsWith('//')
}

function UnauthorizedPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [session, setSession] = useState<SessionRoleInfo | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)

  const kind = searchParams.get('kind')
  const feature = useMemo(
    () => normalizeSubscriptionFeature(searchParams.get('feature')),
    [searchParams],
  )
  const nextPath = useMemo(() => {
    const next = searchParams.get('next')
    return isSafeInternalPath(next) ? next : null
  }, [searchParams])
  const featureMeta = getSubscriptionFeatureMeta(feature)
  const isPlanLock = kind === 'plan' && !!featureMeta
  const FeatureIcon = feature ? FEATURE_ICONS[feature] : Lock
  const activeSubscription = session?.activeSubscription ?? null
  const currentPlanName = activeSubscription?.plan?.name || 'Не определён'
  const activeOrganizationName = session?.activeOrganization?.name || 'Текущая организация'

  useEffect(() => {
    let mounted = true

    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/session-role', { cache: 'no-store' })
        const json = (await response.json().catch(() => null)) as SessionRoleInfo | null
        if (!mounted) return
        setSession(json)
      } finally {
        if (mounted) {
          setLoadingSession(false)
        }
      }
    }

    void loadSession()

    return () => {
      mounted = false
    }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#050505] text-foreground flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <div className="bg-[#0b0b0f] border border-white/10 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center ${isPlanLock ? 'bg-[#d7ff00]/10 border-[#d7ff00]/40' : 'bg-red-500/10 border-red-500/40'}`}>
                <FeatureIcon className={`w-7 h-7 ${isPlanLock ? 'text-[#d7ff00]' : 'text-red-400'}`} />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={isPlanLock ? 'default' : 'destructive'}>
                    {isPlanLock ? 'Upgrade Required' : 'Access Blocked'}
                  </Badge>
                  {featureMeta ? <Badge variant="outline">{featureMeta.label}</Badge> : null}
                  {session?.activeOrganization?.name ? <Badge variant="secondary">{activeOrganizationName}</Badge> : null}
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  {featureMeta?.headline || 'Нет доступа к странице'}
                </h1>
                <p className="text-sm text-muted-foreground max-w-2xl">
                  {featureMeta?.description ||
                    'У вас нет прав для просмотра этого раздела. Если это выглядит как ошибка, проверьте роль пользователя или обратитесь к владельцу системы.'}
                </p>
              </div>
            </div>

            {loadingSession ? (
              <div className="text-xs text-muted-foreground">Проверяем активный тариф…</div>
            ) : activeSubscription?.plan?.name ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-right min-w-[220px]">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Текущий тариф</div>
                <div className="mt-1 text-lg font-semibold">{activeSubscription.plan.name}</div>
                <div className="text-xs text-muted-foreground">
                  {activeSubscription.status === 'active' ? 'Подписка активна' : `Статус: ${activeSubscription.status}`}
                </div>
              </div>
            ) : null}
          </div>

          {isPlanLock && featureMeta ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Модуль</div>
                <div className="mt-2 text-lg font-semibold">{featureMeta.label}</div>
                <p className="mt-2 text-sm text-muted-foreground">{featureMeta.upgradeReason}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Ваш план</div>
                <div className="mt-2 text-lg font-semibold">{currentPlanName}</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeSubscription?.billingPeriod
                    ? `Период оплаты: ${activeSubscription.billingPeriod}`
                    : 'План ещё не привязан или не загружен.'}
                </p>
              </div>
              <div className="rounded-2xl border border-[#d7ff00]/20 bg-[#d7ff00]/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Рекомендуемый план</div>
                <div className="mt-2 text-lg font-semibold text-[#f3ff9d]">{featureMeta.recommendedPlanName}</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Переключите тариф в кабинете организации, чтобы открыть этот раздел.
                </p>
              </div>
            </div>
          ) : null}

          <Alert className={isPlanLock ? 'border-[#d7ff00]/20 bg-[#d7ff00]/5' : 'border-red-500/20 bg-red-500/5'}>
            <AlertTriangle className={isPlanLock ? 'text-[#d7ff00]' : 'text-red-400'} />
            <AlertTitle>{isPlanLock ? 'Почему раздел заблокирован' : 'Почему доступ закрыт'}</AlertTitle>
            <AlertDescription>
              <p>
                {isPlanLock
                  ? 'Эта страница зависит от функции, которой нет в активной подписке организации. После смены тарифа доступ откроется автоматически.'
                  : 'Текущий пользователь не проходит по роли или по tenant-доступу для этой страницы. Проверьте, в какую организацию вы вошли и какая у вас роль.'}
              </p>
              {nextPath ? (
                <p className="text-xs text-muted-foreground/80">
                  Попытка открыть: <span className="font-mono">{nextPath}</span>
                </p>
              ) : null}
            </AlertDescription>
          </Alert>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/select-organization" className="flex-1">
              <Button className="w-full h-11 text-sm font-medium bg-[#d7ff00] text-black hover:bg-[#c4f000]">
                {isPlanLock ? 'Открыть кабинет организации' : 'Вернуться в хаб проектов'}
              </Button>
            </Link>

            <Link href="/" className="flex-1">
              <Button className="w-full h-11 text-sm" variant="outline">
                На главную
              </Button>
            </Link>

            <Button
              onClick={handleLogout}
              className="flex-1 h-11 text-sm font-medium"
              variant="secondary"
            >
              Выйти и войти снова
            </Button>
          </div>

          {isPlanLock && featureMeta ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium">Нужен апгрейд до {featureMeta.recommendedPlanName}</div>
                <p className="text-xs text-muted-foreground">
                  Откройте кабинет организации и поменяйте тариф, чтобы включить {featureMeta.label.toLowerCase()}.
                </p>
              </div>
              <Link href="/select-organization">
                <Button variant="outline" className="gap-2">
                  К тарифам и лимитам
                  <ArrowUpRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          ) : null}

          <p className="text-[10px] text-muted-foreground/70">
            Orda Control · SaaS access layer
          </p>
        </div>
      </div>
    </div>
  )
}

export default function UnauthorizedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505]" />}>
      <UnauthorizedPageContent />
    </Suspense>
  )
}
