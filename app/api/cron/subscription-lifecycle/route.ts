import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export const runtime = 'nodejs'

// Grace (past_due) — сколько дней доступа после конца периода/триала до блокировки.
const GRACE_DAYS = 5

/**
 * Крон жизненного цикла подписки (раз в сутки).
 *
 * Двигает статусы по датам (без «ежедневных списаний» — просто сверка):
 *   trialing → past_due   когда trial_ends_at/ends_at прошёл (grace, доступ ещё есть)
 *   active   → past_due   когда ends_at прошёл
 *   past_due → expired    когда grace_until прошёл  (+ organizations.status='suspended')
 *
 * Организации с billing_exempt=true (F16 и грандфазер-клиенты) не трогаем.
 * Экран «подписка приостановлена» показывает уже существующий 403-гейт по
 * organizations.status='suspended'.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const now = Date.now()
  const graceUntilIso = new Date(now + GRACE_DAYS * 86_400_000).toISOString()

  const { data: subs, error } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, status, ends_at, trial_ends_at, grace_until, organization:organization_id(id, status, billing_exempt)')
    .in('status', ['trialing', 'active', 'past_due'])

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : null)
  let toGrace = 0
  let toExpired = 0

  for (const sub of (subs || []) as any[]) {
    const org = Array.isArray(sub.organization) ? sub.organization[0] : sub.organization
    if (!org || org.billing_exempt) continue

    if (sub.status === 'trialing' || sub.status === 'active') {
      const end = sub.status === 'trialing' ? ms(sub.trial_ends_at) ?? ms(sub.ends_at) : ms(sub.ends_at)
      if (end !== null && end <= now) {
        await supabase
          .from('organization_subscriptions')
          .update({ status: 'past_due', grace_until: graceUntilIso })
          .eq('id', sub.id)
        toGrace += 1
      }
    } else if (sub.status === 'past_due') {
      const graceEnd = ms(sub.grace_until)
      if (graceEnd !== null && graceEnd <= now) {
        await supabase.from('organization_subscriptions').update({ status: 'expired' }).eq('id', sub.id)
        if (org.status !== 'suspended') {
          await supabase.from('organizations').update({ status: 'suspended' }).eq('id', org.id)
        }
        toExpired += 1
      }
    }
  }

  return NextResponse.json({ ok: true, moved_to_grace: toGrace, moved_to_expired: toExpired })
}
