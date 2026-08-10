import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import {
  buildOperatorTicket,
  generateExamQuestions,
  sendExamQuestion,
  type ExamAttemptRow,
  type ExamQuestion,
} from '@/lib/server/operator-exams'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Экзамены операторов: назначение аттестации по точкам и сводка результатов.
 * Сам диалог живёт в Telegram — см. lib/server/operator-exams.ts и обработчик
 * `exam:` в /api/telegram/webhook.
 */

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type ExamRow = {
  id: string
  title: string
  company_ids: string[]
  question_count: number
  pass_score: number
  deadline_at: string | null
  status: string
  created_at: string
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'operator-exams.view')
    if (denied) return denied

    const orgId = access.activeOrganization?.id || null
    if (!orgId && !access.isSuperAdmin) return json({ ok: true, data: { exams: [], companies: [], operators: [] } })

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: orgId,
      isSuperAdmin: access.isSuperAdmin,
    })

    const url = new URL(request.url)
    const examId = url.searchParams.get('id')

    // ─── Детали одного экзамена ───────────────────────────────────────────
    if (examId) {
      let examQuery = supabase.from('operator_exams').select('*').eq('id', examId)
      if (orgId) examQuery = examQuery.eq('organization_id', orgId)
      const { data: exam } = await examQuery.maybeSingle()
      if (!exam) return json({ error: 'exam-not-found' }, 404)

      const { data: attempts } = await supabase
        .from('operator_exam_attempts')
        .select('id, operator_id, status, score, passed, correct_answers, total_questions, current_index, delivery_error, sent_at, started_at, completed_at')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true })

      const operatorIds = Array.from(new Set(((attempts || []) as any[]).map((a) => a.operator_id)))
      const namesById = new Map<string, string>()
      if (operatorIds.length > 0) {
        const { data: operators } = await supabase
          .from('operators')
          .select('id, name, short_name, operator_profiles(full_name)')
          .in('id', operatorIds)
        for (const row of (operators || []) as any[]) {
          const profile = Array.isArray(row.operator_profiles) ? row.operator_profiles[0] : row.operator_profiles
          namesById.set(String(row.id), profile?.full_name || row.name || row.short_name || 'Без имени')
        }
      }

      return json({
        ok: true,
        data: {
          exam,
          attempts: ((attempts || []) as any[]).map((a) => ({
            ...a,
            operator_name: namesById.get(String(a.operator_id)) || 'Без имени',
          })),
        },
      })
    }

    // ─── Список экзаменов + справочники для формы ─────────────────────────
    let examsQuery = supabase
      .from('operator_exams')
      .select('id, title, company_ids, question_count, pass_score, deadline_at, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (orgId) examsQuery = examsQuery.eq('organization_id', orgId)

    const { data: exams, error: examsError } = await examsQuery
    if (examsError) throw examsError

    const examIds = ((exams || []) as ExamRow[]).map((e) => e.id)
    const statsByExam = new Map<string, { assigned: number; completed: number; passed: number; scoreSum: number }>()
    if (examIds.length > 0) {
      const { data: attempts } = await supabase
        .from('operator_exam_attempts')
        .select('exam_id, status, score, passed')
        .in('exam_id', examIds)
        .limit(5000)
      for (const row of (attempts || []) as any[]) {
        const stat = statsByExam.get(row.exam_id) || { assigned: 0, completed: 0, passed: 0, scoreSum: 0 }
        stat.assigned += 1
        if (row.status === 'completed') {
          stat.completed += 1
          stat.scoreSum += Number(row.score || 0)
          if (row.passed) stat.passed += 1
        }
        statsByExam.set(row.exam_id, stat)
      }
    }

    // Точки организации.
    let companiesQuery = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', companyScope.allowedCompanyIds)
    const { data: companies } = await companiesQuery

    // Операторы с привязкой к точкам — форма показывает только тех, кто работает
    // на выбранных точках.
    const allowedCompanyIds = companyScope.allowedCompanyIds
    let assignmentsQuery = supabase
      .from('operator_company_assignments')
      .select('operator_id, company_id')
      .eq('is_active', true)
      .limit(5000)
    if (allowedCompanyIds) assignmentsQuery = assignmentsQuery.in('company_id', allowedCompanyIds)
    const { data: assignments } = await assignmentsQuery

    const companyIdsByOperator = new Map<string, string[]>()
    for (const row of (assignments || []) as any[]) {
      const list = companyIdsByOperator.get(String(row.operator_id)) || []
      list.push(String(row.company_id))
      companyIdsByOperator.set(String(row.operator_id), list)
    }

    const operatorIds = Array.from(companyIdsByOperator.keys())
    let operators: any[] = []
    if (operatorIds.length > 0) {
      const { data: operatorRows } = await supabase
        .from('operators')
        .select('id, name, short_name, telegram_chat_id, is_active, operator_profiles(full_name)')
        .in('id', operatorIds)
        .eq('is_active', true)
      operators = ((operatorRows || []) as any[]).map((row) => {
        const profile = Array.isArray(row.operator_profiles) ? row.operator_profiles[0] : row.operator_profiles
        return {
          id: String(row.id),
          name: profile?.full_name || row.name || row.short_name || 'Без имени',
          telegram_chat_id: row.telegram_chat_id || null,
          company_ids: companyIdsByOperator.get(String(row.id)) || [],
        }
      })
    }

    return json({
      ok: true,
      data: {
        exams: ((exams || []) as ExamRow[]).map((exam) => {
          const stat = statsByExam.get(exam.id) || { assigned: 0, completed: 0, passed: 0, scoreSum: 0 }
          return {
            ...exam,
            assigned: stat.assigned,
            completed: stat.completed,
            passed: stat.passed,
            avg_score: stat.completed > 0 ? Math.round(stat.scoreSum / stat.completed) : null,
          }
        }),
        companies: companies || [],
        operators,
      },
    })
  } catch (error: any) {
    return json({ error: 'operator-exams-failed', detail: error?.message || String(error) }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as
      | {
          action?: string
          exam_id?: string
          title?: string
          company_ids?: string[]
          operator_ids?: string[]
          question_count?: number
          pass_score?: number
          deadline_at?: string | null
        }
      | null
    if (!body?.action) return json({ error: 'action обязателен' }, 400)

    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ error: 'Требуется активная организация' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: orgId,
      isSuperAdmin: access.isSuperAdmin,
    })

    // ─── Создать и разослать ───────────────────────────────────────────────
    if (body.action === 'create') {
      const denied = await requireCapability(access, 'operator-exams.create')
      if (denied) return denied

      const title = String(body.title || '').trim()
      if (!title) return json({ error: 'Укажите название экзамена' }, 400)

      const companyIds = Array.from(new Set((body.company_ids || []).map(String).filter(Boolean)))
      if (companyIds.length === 0) return json({ error: 'Выберите хотя бы одну точку' }, 400)
      if (companyScope.allowedCompanyIds) {
        const allowed = new Set(companyScope.allowedCompanyIds)
        if (companyIds.some((id) => !allowed.has(id))) return json({ error: 'company-out-of-scope' }, 403)
      }

      const operatorIds = Array.from(new Set((body.operator_ids || []).map(String).filter(Boolean)))
      if (operatorIds.length === 0) return json({ error: 'Выберите операторов' }, 400)

      const questionCount = Math.max(3, Math.min(20, Number(body.question_count) || 10))
      const passScore = Math.max(1, Math.min(100, Number(body.pass_score) || 70))

      // Операторы обязаны работать на выбранных точках — иначе экзамен по чужому
      // регламенту и утечка стандартов другой точки.
      const { data: assignments } = await supabase
        .from('operator_company_assignments')
        .select('operator_id')
        .in('operator_id', operatorIds)
        .in('company_id', companyIds)
        .eq('is_active', true)
      const eligible = new Set(((assignments || []) as any[]).map((a) => String(a.operator_id)))
      const foreign = operatorIds.filter((id) => !eligible.has(id))
      if (foreign.length > 0) return json({ error: 'operator-not-in-selected-points', detail: foreign }, 403)

      // Пул вопросов: с запасом, чтобы билеты у людей отличались.
      const poolSize = Math.min(questionCount * 2, 20)
      const { questions: pool, error: generationError } = await generateExamQuestions({
        supabase,
        organizationId: orgId,
        companyIds,
        questionCount: poolSize,
      })
      if (generationError || pool.length === 0) {
        const message =
          generationError === 'not-enough-articles'
            ? 'В базе знаний выбранных точек меньше 3 статей с текстом. Заполните регламенты на странице «База знаний».'
            : generationError === 'openai-not-configured'
              ? 'Не настроен OPENAI_API_KEY.'
              : 'Не удалось сгенерировать вопросы.'
        return json({ error: message }, 400)
      }

      const { data: exam, error: examError } = await supabase
        .from('operator_exams')
        .insert([{
          organization_id: orgId,
          title,
          company_ids: companyIds,
          question_count: questionCount,
          pass_score: passScore,
          deadline_at: body.deadline_at || null,
          status: 'active',
          created_by: access.user?.id || null,
        }])
        .select('id')
        .single()
      if (examError) return json({ error: 'exam-create-failed', detail: examError.message }, 500)

      const examId = String((exam as any).id)

      const { data: operatorRows } = await supabase
        .from('operators')
        .select('id, name, short_name, telegram_chat_id')
        .in('id', operatorIds)

      const attemptsToInsert = ((operatorRows || []) as any[]).map((operator) => {
        const ticket: ExamQuestion[] = buildOperatorTicket(pool, questionCount)
        const chatId = operator.telegram_chat_id ? String(operator.telegram_chat_id) : null
        return {
          exam_id: examId,
          organization_id: orgId,
          operator_id: String(operator.id),
          telegram_chat_id: chatId,
          status: chatId ? 'pending' : 'undeliverable',
          delivery_error: chatId ? null : 'У оператора не указан Telegram',
          questions: ticket,
          total_questions: ticket.length,
        }
      })

      const { data: inserted, error: attemptsError } = await supabase
        .from('operator_exam_attempts')
        .insert(attemptsToInsert)
        .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status, questions, answers, current_index, total_questions, correct_answers, score, passed')
      if (attemptsError) return json({ error: 'attempts-create-failed', detail: attemptsError.message }, 500)

      // Рассылка первого вопроса.
      let sent = 0
      const failures: Array<{ operator_id: string; error: string }> = []
      for (const attempt of (inserted || []) as ExamAttemptRow[]) {
        if (attempt.status !== 'pending') continue
        const result = await sendExamQuestion({ attempt, examTitle: title })
        if (result.ok) {
          sent += 1
          await supabase
            .from('operator_exam_attempts')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', attempt.id)
        } else {
          failures.push({ operator_id: attempt.operator_id, error: result.error || 'Ошибка отправки' })
          await supabase
            .from('operator_exam_attempts')
            .update({ status: 'undeliverable', delivery_error: result.error || 'Ошибка отправки' })
            .eq('id', attempt.id)
        }
      }

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'operator_exam.create',
        entityType: 'operator_exam',
        entityId: examId,
        payload: { title, companyIds, operators: operatorIds.length, questionCount, passScore, sent },
      })

      return json({ ok: true, data: { exam_id: examId, assigned: attemptsToInsert.length, sent, failures } })
    }

    // ─── Напомнить (переслать текущий вопрос) ─────────────────────────────
    if (body.action === 'remind') {
      const denied = await requireCapability(access, 'operator-exams.remind')
      if (denied) return denied

      const examId = String(body.exam_id || '')
      if (!examId) return json({ error: 'exam_id обязателен' }, 400)

      const { data: exam } = await supabase
        .from('operator_exams')
        .select('id, title')
        .eq('id', examId)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!exam) return json({ error: 'exam-not-found' }, 404)

      const { data: attempts } = await supabase
        .from('operator_exam_attempts')
        .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status, questions, answers, current_index, total_questions, correct_answers, score, passed')
        .eq('exam_id', examId)
        .in('status', ['sent', 'in_progress'])

      let reminded = 0
      for (const attempt of (attempts || []) as ExamAttemptRow[]) {
        const result = await sendExamQuestion({ attempt, examTitle: String((exam as any).title) })
        if (result.ok) reminded += 1
      }

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'operator_exam.remind',
        entityType: 'operator_exam',
        entityId: examId,
        payload: { reminded },
      })

      return json({ ok: true, data: { reminded } })
    }

    // ─── Завершить: незакрытые попытки помечаем просроченными ─────────────
    if (body.action === 'finish' || body.action === 'cancel') {
      const denied = await requireCapability(access, 'operator-exams.cancel')
      if (denied) return denied

      const examId = String(body.exam_id || '')
      if (!examId) return json({ error: 'exam_id обязателен' }, 400)

      const { data: exam } = await supabase
        .from('operator_exams')
        .select('id')
        .eq('id', examId)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!exam) return json({ error: 'exam-not-found' }, 404)

      await supabase
        .from('operator_exams')
        .update({ status: body.action === 'finish' ? 'finished' : 'cancelled' })
        .eq('id', examId)

      await supabase
        .from('operator_exam_attempts')
        .update({ status: 'expired' })
        .eq('exam_id', examId)
        .in('status', ['pending', 'sent', 'in_progress'])

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: `operator_exam.${body.action}`,
        entityType: 'operator_exam',
        entityId: examId,
        payload: {},
      })

      return json({ ok: true })
    }

    return json({ error: `Неизвестное action: ${body.action}` }, 400)
  } catch (error: any) {
    return json({ error: 'operator-exams-failed', detail: error?.message || String(error) }, 500)
  }
}
