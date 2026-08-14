import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { generateExamQuestions, generateOpenQuestions } from '@/lib/server/operator-exams'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

/**
 * Аттестация новичка собирается сама.
 *
 * Экзамен новому оператору назначают руками — и забывают именно в первые недели,
 * когда он нужнее всего. Крон находит тех, кто отработал заданный срок и ни разу
 * не аттестовывался, и собирает им билет.
 *
 * Черновик, а не рассылка: вопросы пишет модель, и кривой вопрос дешевле
 * выкинуть до отправки, чем объясняться перед семью людьми. Владельцу уходит
 * сообщение «билет готов, проверьте и разошлите».
 *
 *   GET /api/cron/auto-exam-newcomers
 */

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (auth !== `Bearer ${requiredEnv('CRON_SECRET')}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminSupabaseClient()

    const { data: organizations, error: orgError } = await supabase
      .from('organizations')
      .select(
        'id, name, telegram_owner_chat_id, auto_exam_enabled, auto_exam_days, auto_exam_questions, auto_exam_open, auto_exam_pass_score',
      )
      .eq('auto_exam_enabled', true)
    // Колонок нет, пока не применена миграция — это не ошибка крона.
    if (orgError) return NextResponse.json({ ok: true, created: 0, reason: 'not-configured' })
    if (!organizations?.length) return NextResponse.json({ ok: true, created: 0, reason: 'disabled' })

    let created = 0

    for (const org of organizations as any[]) {
      const days = Math.max(1, Number(org.auto_exam_days || 7))
      const questionCount = Math.max(3, Math.min(20, Number(org.auto_exam_questions || 10)))
      const openCount = Math.max(0, Math.min(5, Number(org.auto_exam_open || 2)))
      const passScore = Math.max(1, Math.min(100, Number(org.auto_exam_pass_score || 70)))
      const threshold = new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10)

      const { data: companies } = await supabase
        .from('companies')
        .select('id')
        .eq('organization_id', String(org.id))
      const companyIds = ((companies || []) as any[]).map((row) => String(row.id))
      if (companyIds.length === 0) continue

      const { data: assignments } = await supabase
        .from('operator_company_assignments')
        .select('operator_id, company_id')
        .in('company_id', companyIds)
        .eq('is_active', true)

      const operatorIds = Array.from(
        new Set(((assignments || []) as any[]).map((row) => String(row.operator_id))),
      )
      if (operatorIds.length === 0) continue

      const { data: operators } = await supabase
        .from('operators')
        .select('id, name, is_active, dismissed_at, auto_exam_created_at')
        .in('id', operatorIds)

      const { data: profiles } = await supabase
        .from('operator_profiles')
        .select('operator_id, hire_date')
        .in('operator_id', operatorIds)
      const hireByOperator = new Map(
        ((profiles || []) as any[]).map((row) => [String(row.operator_id), String(row.hire_date || '')]),
      )

      // Кто уже когда-либо участвовал в экзамене — таким автоаттестация не нужна.
      const { data: attempts } = await supabase
        .from('operator_exam_attempts')
        .select('operator_id')
        .in('operator_id', operatorIds)
        .limit(2000)
      const examined = new Set(((attempts || []) as any[]).map((row) => String(row.operator_id)))

      const companyByOperator = new Map<string, string>()
      for (const row of (assignments || []) as any[]) {
        if (!companyByOperator.has(String(row.operator_id))) {
          companyByOperator.set(String(row.operator_id), String(row.company_id))
        }
      }

      for (const operator of (operators || []) as any[]) {
        if (operator.is_active === false || operator.dismissed_at) continue
        if (operator.auto_exam_created_at) continue
        if (examined.has(String(operator.id))) continue

        const hireDate = hireByOperator.get(String(operator.id))
        // Без даты найма непонятно, новичок это или человек работает третий год.
        if (!hireDate || hireDate > threshold) continue

        const companyId = companyByOperator.get(String(operator.id))
        if (!companyId) continue

        const poolSize = Math.min(questionCount * 2, 20)
        const { questions: pool, error: generationError } = await generateExamQuestions({
          supabase,
          organizationId: String(org.id),
          companyIds: [companyId],
          questionCount: poolSize,
        })
        // Нет регламентов — не беда крона: владелец увидит это на странице базы.
        if (generationError || pool.length === 0) continue

        const openPool =
          openCount > 0
            ? await generateOpenQuestions({
                supabase,
                organizationId: String(org.id),
                companyIds: [companyId],
                count: Math.min(openCount * 2, 8),
              })
            : []

        const title = `Аттестация новичка: ${String(operator.name || 'оператор')}`
        const { data: exam, error: examError } = await supabase
          .from('operator_exams')
          .insert([
            {
              organization_id: String(org.id),
              title,
              company_ids: [companyId],
              operator_ids: [String(operator.id)],
              question_count: questionCount,
              open_count: Math.min(openCount, openPool.length),
              pass_score: passScore,
              status: 'draft',
              question_pool: pool,
              open_pool: openPool,
              created_by: null,
            },
          ])
          .select('id')
          .single()
        if (examError || !exam) continue

        await supabase
          .from('operators')
          .update({ auto_exam_created_at: new Date().toISOString() })
          .eq('id', String(operator.id))
          .then(() => null, () => null)

        await writeAuditLog(supabase as any, {
          actorUserId: null,
          action: 'operator_exam.auto_draft',
          entityType: 'operator_exam',
          entityId: String((exam as any).id),
          payload: { operator_id: String(operator.id), hire_date: hireDate, questions: pool.length },
        })

        if (org.telegram_owner_chat_id) {
          await sendTelegramMessage(
            String(org.telegram_owner_chat_id),
            [
              '🎓 <b>Собрана аттестация новичка</b>',
              '',
              escapeTelegramHtml(`${String(operator.name || 'Оператор')} работает ${days}+ дней и ещё не аттестован.`),
              `Билет готов: ${pool.length} вопросов${openPool.length ? ` и ${openPool.length} ситуационных` : ''}.`,
              '',
              'Проверьте вопросы и разошлите: «Регламенты точки» → «Экзамены».',
            ].join('\n'),
          ).catch(() => null)
        }

        created += 1
      }
    }

    return NextResponse.json({ ok: true, created })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'cron/auto-exam-newcomers',
      message: error?.message || 'error',
    })
    return NextResponse.json({ ok: false, error: 'auto-exam-failed' }, { status: 500 })
  }
}
