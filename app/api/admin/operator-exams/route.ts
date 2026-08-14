import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import {
  buildOperatorTicket,
  generateExamQuestions,
  generateOpenQuestions,
  isOpenAnswer,
  recomputeAttempt,
  sendExamQuestion,
  type ExamAttemptRow,
  type ExamQuestion,
} from '@/lib/server/operator-exams'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { pushToOperators } from '@/lib/server/push'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Экзамены операторов: назначение аттестации по точкам и сводка результатов.
 *
 * Диалог живёт в двух местах: Telegram (см. lib/server/operator-exams.ts и
 * обработчик `exam:` в /api/telegram/webhook) и мобильное приложение
 * (/api/operator/exams). Билет и подсчёт общие — сдать дважды нельзя.
 */

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** «5 вопросов», «1 вопрос», «2 вопроса». */
function pluralQuestions(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'вопрос'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'вопроса'
  return 'вопросов'
}

type ExamRow = {
  id: string
  title: string
  company_ids: string[]
  question_count: number
  open_count: number
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

      // Черновик: отдаём вопросы целиком, с правильными ответами. Их читает
      // владелец, чтобы выкинуть неудачные ДО рассылки.
      if ((exam as any).status === 'draft') {
        const pool = (((exam as any).question_pool || []) as ExamQuestion[]).map((q, index) => ({
          index,
          pool: 'choice' as const,
          q: q.q,
          choices: q.choices,
          correct: q.correct,
          article_title: q.article_title,
        }))
        const openPool = (((exam as any).open_pool || []) as ExamQuestion[]).map((q, index) => ({
          index,
          pool: 'open' as const,
          q: q.q,
          rubric: q.rubric || [],
          article_title: q.article_title,
        }))
        return json({ ok: true, data: { exam, attempts: [], draftQuestions: pool, draftOpenQuestions: openPool } })
      }

      const { data: attempts } = await supabase
        .from('operator_exam_attempts')
        .select('id, operator_id, status, score, passed, correct_answers, total_questions, current_index, delivery_error, sent_at, started_at, completed_at, manual_override, questions, answers')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true })

      // Разбор с правильными вариантами прячем только от того, кому этот же
      // экзамен ещё предстоит сдавать: свою незакрытую попытку видно сразу.
      let viewerHasOpenAttempt = false
      if (access.staffMember?.id) {
        const { data: viewerLink } = await supabase
          .from('operator_staff_links')
          .select('operator_id')
          .eq('staff_id', String(access.staffMember.id))
          .maybeSingle()
        const viewerOperatorId = (viewerLink as any)?.operator_id
        if (viewerOperatorId) {
          const { data: viewerAttempt } = await supabase
            .from('operator_exam_attempts')
            .select('id')
            .eq('exam_id', examId)
            .eq('operator_id', String(viewerOperatorId))
            .in('status', ['pending', 'sent', 'in_progress'])
            .maybeSingle()
          viewerHasOpenAttempt = !!viewerAttempt
        }
      }

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
          attempts: ((attempts || []) as any[]).map((a) => {
            const questions = (a.questions || []) as ExamQuestion[]
            const answers = (a.answers || {}) as Record<string, unknown>
            // Тестовые ответы: что спросили, что выбрал человек и где ошибся.
            // Без этого владелец видит «7 из 10» и не знает, чего не знает
            // оператор, — а именно это и нужно, чтобы дообучить.
            const choiceAnswers = viewerHasOpenAttempt
              ? []
              : questions
                  .map((question, index) => ({ question, index, answer: answers[String(index)] }))
                  .filter((item) => item.question.type !== 'open')
                  .map((item) => {
                    const selected = typeof item.answer === 'number' ? item.answer : null
                    const correct = Number(item.question.correct ?? -1)
                    return {
                      index: item.index,
                      question: item.question.q,
                      choices: item.question.choices || [],
                      article_title: item.question.article_title,
                      selected,
                      correct,
                      answered: selected !== null,
                      is_correct: selected !== null && selected === correct,
                    }
                  })

            const openAnswers = questions
              .map((question, index) => ({ question, index, answer: answers[String(index)] }))
              .filter((item) => item.question.type === 'open')
              .map((item) => ({
                index: item.index,
                question: item.question.q,
                rubric: item.question.rubric || [],
                article_title: item.question.article_title,
                max: Number(item.question.max_score || 5),
                answer: isOpenAnswer(item.answer) ? item.answer : null,
              }))

            return {
              id: a.id,
              operator_id: a.operator_id,
              status: a.status,
              score: a.score,
              passed: a.passed,
              correct_answers: a.correct_answers,
              total_questions: a.total_questions,
              current_index: a.current_index,
              delivery_error: a.delivery_error,
              sent_at: a.sent_at,
              started_at: a.started_at,
              completed_at: a.completed_at,
              manual_override: a.manual_override,
              open_answers: openAnswers,
              choice_answers: choiceAnswers,
              answers_hidden: viewerHasOpenAttempt,
              operator_name: namesById.get(String(a.operator_id)) || 'Без имени',
            }
          }),
        },
      })
    }

    // ─── Список экзаменов + справочники для формы ─────────────────────────
    let examsQuery = supabase
      .from('operator_exams')
      .select('id, title, company_ids, question_count, open_count, pass_score, deadline_at, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (orgId) examsQuery = examsQuery.eq('organization_id', orgId)

    const { data: exams, error: examsError } = await examsQuery
    if (examsError) throw examsError

    // Ленивое закрытие по дедлайну: отдельного крона нет, а поле «дедлайн» без
    // последствий — обманка. Просроченные незавершённые попытки гасим при
    // первом же открытии страницы.
    const overdue = ((exams || []) as ExamRow[]).filter(
      (exam) => exam.status === 'active' && exam.deadline_at && new Date(exam.deadline_at) < new Date(),
    )
    if (overdue.length > 0) {
      const overdueIds = overdue.map((exam) => exam.id)
      await supabase
        .from('operator_exam_attempts')
        .update({ status: 'expired' })
        .in('exam_id', overdueIds)
        .in('status', ['pending', 'sent', 'in_progress'])
      await supabase.from('operator_exams').update({ status: 'finished' }).in('id', overdueIds)
      for (const exam of overdue) exam.status = 'finished'
    }

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
    let companiesQuery = supabase.from('companies').select('id, name, code, industry').order('name')
    if (companyScope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', companyScope.allowedCompanyIds)
    const { data: companies } = await companiesQuery

    // Готовность цепочки: экзамен собирается из опубликованных регламентов, а те
    // привязаны к нише. Показываем это на странице, чтобы «не хватает статей»
    // не всплывало сюрпризом уже при отправке.
    let articlesQuery = supabase
      .from('knowledge_articles')
      .select('id', { count: 'exact', head: true })
      .eq('is_published', true)
    if (orgId) articlesQuery = articlesQuery.eq('organization_id', orgId)
    const { count: publishedArticles } = await articlesQuery

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

    // Настройки автоаттестации: колонок может не быть до применения миграции,
    // поэтому ошибку читаем как «выключено», а не как поломку страницы.
    const { data: orgSettings } = orgId
      ? await supabase
          .from('organizations')
          .select('auto_exam_enabled, auto_exam_days, auto_exam_questions, auto_exam_open, auto_exam_pass_score')
          .eq('id', orgId)
          .maybeSingle()
      : { data: null }

    return json({
      ok: true,
      data: {
        auto_exam: {
          available: !!orgSettings,
          enabled: (orgSettings as any)?.auto_exam_enabled === true,
          days: Number((orgSettings as any)?.auto_exam_days ?? 7),
          questions: Number((orgSettings as any)?.auto_exam_questions ?? 10),
          open: Number((orgSettings as any)?.auto_exam_open ?? 2),
          pass_score: Number((orgSettings as any)?.auto_exam_pass_score ?? 70),
        },
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
        readiness: {
          pointsTotal: (companies || []).length,
          pointsWithIndustry: ((companies || []) as any[]).filter((c) => !!c.industry).length,
          publishedArticles: Number(publishedArticles || 0),
          operatorsWithTelegram: operators.filter((o) => !!o.telegram_chat_id).length,
          operatorsTotal: operators.length,
        },
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
          pool?: string
          title?: string
          company_ids?: string[]
          operator_ids?: string[]
          question_count?: number
          open_count?: number
          pass_score?: number
          deadline_at?: string | null
          attempt_id?: string
          question_index?: number
          score?: number
          comment?: string | null
          // Настройки автоаттестации новичка.
          enabled?: boolean
          days?: number
          questions?: number
          open?: number
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
      const openCount = Math.max(0, Math.min(5, Number(body.open_count) || 0))
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

      // Ситуационные генерим отдельно: у них другой промпт, рубрика и вес.
      // Пул общий на экзамен — билеты собираются из него.
      const openPool = openCount > 0
        ? await generateOpenQuestions({
            supabase,
            organizationId: orgId,
            companyIds,
            count: Math.min(openCount * 2, 8),
          })
        : []

      // Создание НЕ рассылает: сохраняем пул и ждём, пока владелец прочитает
      // вопросы. Кривой вопрос дешевле выкинуть здесь, чем узнать о нём от семи
      // человек, которым экзамен уже ушёл.
      const { data: exam, error: examError } = await supabase
        .from('operator_exams')
        .insert([{
          organization_id: orgId,
          title,
          company_ids: companyIds,
          operator_ids: operatorIds,
          question_count: questionCount,
          open_count: Math.min(openCount, openPool.length),
          pass_score: passScore,
          deadline_at: body.deadline_at || null,
          status: 'draft',
          question_pool: pool,
          open_pool: openPool,
          created_by: access.user?.id || null,
        }])
        .select('id')
        .single()
      if (examError) return json({ error: 'exam-create-failed', detail: examError.message }, 500)

      const examId = String((exam as any).id)

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'operator_exam.draft',
        entityType: 'operator_exam',
        entityId: examId,
        payload: { title, companyIds, operators: operatorIds.length, questions: pool.length, open: openPool.length },
      })

      return json({
        ok: true,
        data: { exam_id: examId, questions: pool.length, open: openPool.length, operators: operatorIds.length },
      })
    }

    // ─── Выкинуть неудачный вопрос из черновика ───
    if (body.action === 'drop_question') {
      const denied = await requireCapability(access, 'operator-exams.create')
      if (denied) return denied

      const examId = String(body.exam_id || '')
      const index = Number(body.question_index)
      const poolField = body.pool === 'open' ? 'open_pool' : 'question_pool'
      if (!examId || !Number.isInteger(index)) return json({ error: 'exam_id и question_index обязательны' }, 400)

      const { data: exam } = await supabase
        .from('operator_exams')
        .select('id, status, question_pool, open_pool')
        .eq('id', examId)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!exam) return json({ error: 'exam-not-found' }, 404)
      if ((exam as any).status !== 'draft') {
        return json({ error: 'Вопросы можно править только до рассылки' }, 409)
      }

      const current = (((exam as any)[poolField] || []) as ExamQuestion[]).slice()
      if (index < 0 || index >= current.length) return json({ error: 'Вопрос не найден' }, 400)
      current.splice(index, 1)

      const { error } = await supabase.from('operator_exams').update({ [poolField]: current }).eq('id', examId)
      if (error) return json({ error: 'drop-failed', detail: error.message }, 500)

      return json({ ok: true, data: { left: current.length } })
    }

    // ─── Разослать черновик ───
    if (body.action === 'send') {
      const denied = await requireCapability(access, 'operator-exams.create')
      if (denied) return denied

      const examId = String(body.exam_id || '')
      if (!examId) return json({ error: 'exam_id обязателен' }, 400)

      const { data: examRow } = await supabase
        .from('operator_exams')
        .select('*')
        .eq('id', examId)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!examRow) return json({ error: 'exam-not-found' }, 404)

      const draft = examRow as any
      if (draft.status !== 'draft') return json({ error: 'Экзамен уже разослан' }, 409)

      const pool = (draft.question_pool || []) as ExamQuestion[]
      const openPool = (draft.open_pool || []) as ExamQuestion[]
      if (pool.length === 0 && openPool.length === 0) {
        return json({ error: 'В черновике не осталось вопросов' }, 400)
      }

      const draftOperatorIds = ((draft.operator_ids || []) as string[]).map(String)
      if (draftOperatorIds.length === 0) return json({ error: 'Не выбраны операторы' }, 400)

      const ticketSize = Math.min(Number(draft.question_count || 10), pool.length)
      const ticketOpen = Math.min(Number(draft.open_count || 0), openPool.length)
      const title = String(draft.title || 'Экзамен')

      const { data: operatorRows } = await supabase
        .from('operators')
        .select('id, name, short_name, telegram_chat_id')
        .in('id', draftOperatorIds)

      const attemptsToInsert = ((operatorRows || []) as any[]).map((operator) => {
        const ticket: ExamQuestion[] = buildOperatorTicket(pool, ticketSize, openPool, ticketOpen)
        const chatId = operator.telegram_chat_id ? String(operator.telegram_chat_id) : null
        // Без Telegram экзамен больше не «недоставлен»: оператор сдаёт его в
        // приложении. Раньше такая попытка сразу помечалась ошибкой, и человек
        // числился обязанным сдать то, чего не видел.
        return {
          exam_id: examId,
          organization_id: orgId,
          operator_id: String(operator.id),
          telegram_chat_id: chatId,
          status: 'pending',
          delivery_error: null,
          questions: ticket,
          total_questions: ticket.length,
        }
      })

      const { data: inserted, error: attemptsError } = await supabase
        .from('operator_exam_attempts')
        .insert(attemptsToInsert)
        .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status, questions, answers, current_index, total_questions, correct_answers, score, passed')
      if (attemptsError) return json({ error: 'attempts-create-failed', detail: attemptsError.message }, 500)

      let sent = 0
      const failures: Array<{ operator_id: string; error: string }> = []
      for (const attempt of (inserted || []) as ExamAttemptRow[]) {
        if (attempt.status !== 'pending') continue

        // Telegram — если он есть. Приложение получает экзамен в любом случае:
        // попытка уже создана, а вопрос оператор откроет сам.
        const result = attempt.telegram_chat_id
          ? await sendExamQuestion({ attempt, examTitle: title })
          : { ok: true as const }

        if (!result.ok) {
          failures.push({ operator_id: attempt.operator_id, error: result.error || 'Ошибка отправки' })
        }
        sent += 1
        await supabase
          .from('operator_exam_attempts')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            delivery_error: result.ok ? null : result.error || 'Ошибка отправки Telegram',
          })
          .eq('id', attempt.id)
      }

      // Уведомление на телефон. Экзамен с дедлайном, о котором узнают через
      // неделю, — это не аттестация, а повод для спора.
      await pushToOperators(
        supabase as any,
        ((inserted || []) as ExamAttemptRow[]).map((attempt) => String(attempt.operator_id)),
        {
          title: 'Экзамен',
          body: `${title}: ${ticketSize + ticketOpen} ${pluralQuestions(ticketSize + ticketOpen)}. Откройте «Профиль» → «Экзамены».`,
          data: { kind: 'operator-exam' },
        },
      )

      await supabase
        .from('operator_exams')
        .update({ status: 'active', sent_at: new Date().toISOString() })
        .eq('id', examId)

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'operator_exam.send',
        entityType: 'operator_exam',
        entityId: examId,
        payload: { assigned: attemptsToInsert.length, sent, failed: failures.length },
      })

      return json({ ok: true, data: { assigned: attemptsToInsert.length, sent, failures } })
    }

    // ─── Ручная правка балла за развёрнутый ответ ─────────────────────────
    // Оценка ИИ — предложение. Последнее слово за человеком, иначе первый же
    // спорный балл убьёт доверие ко всей аттестации.
    if (body.action === 'grade_override') {
      const denied = await requireCapability(access, 'operator-exams.grade')
      if (denied) return denied

      const attemptId = String(body.attempt_id || '')
      const questionIndex = Number(body.question_index)
      if (!attemptId || !Number.isInteger(questionIndex)) {
        return json({ error: 'attempt_id и question_index обязательны' }, 400)
      }

      const { data: attempt } = await supabase
        .from('operator_exam_attempts')
        .select('id, exam_id, organization_id, questions, answers')
        .eq('id', attemptId)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!attempt) return json({ error: 'attempt-not-found' }, 404)

      const questions = ((attempt as any).questions || []) as ExamQuestion[]
      const question = questions[questionIndex]
      if (!question || question.type !== 'open') return json({ error: 'Это не развёрнутый ответ' }, 400)

      const answers = { ...(((attempt as any).answers || {}) as Record<string, unknown>) }
      const current = answers[String(questionIndex)]
      if (!isOpenAnswer(current)) return json({ error: 'Ответа на этот вопрос ещё нет' }, 400)

      const max = Number(question.max_score || 5)
      const score = Math.max(0, Math.min(max, Math.round(Number(body.score))))
      if (!Number.isFinite(score)) return json({ error: 'Некорректный балл' }, 400)

      answers[String(questionIndex)] = {
        ...current,
        score,
        overridden: true,
        override_comment: body.comment ? String(body.comment) : null,
      }

      const { error: updateError } = await supabase
        .from('operator_exam_attempts')
        .update({ answers })
        .eq('id', attemptId)
      if (updateError) return json({ error: 'override-failed', detail: updateError.message }, 500)

      const { data: exam } = await supabase
        .from('operator_exams')
        .select('pass_score')
        .eq('id', (attempt as any).exam_id)
        .maybeSingle()

      const recomputed = await recomputeAttempt({
        supabase,
        attemptId,
        passScore: Number((exam as any)?.pass_score ?? 70),
        gradedBy: access.user?.id || null,
      })

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'operator_exam.grade_override',
        entityType: 'operator_exam_attempt',
        entityId: attemptId,
        payload: { questionIndex, from: current.score, to: score, comment: body.comment || null },
      })

      return json({ ok: true, data: recomputed })
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

    // ─── Пересдача ────────────────────────────────────────────────────────
    //
    // Не сдал — не приговор: человек мог заболеть, попасть на аврал или просто
    // не понять формулировку. Сейчас единственным выходом было завести экзамен
    // заново на всю точку — ради одного оператора.
    //
    // Билет собирается новый из того же пула: пересдача по тем же вопросам,
    // ответы на которые уже разобрали, ничего не проверяет.
    if (body.action === 'retake') {
      const denied = await requireCapability(access, 'operator-exams.create')
      if (denied) return denied

      const attemptId = String(body.attempt_id || '')
      if (!attemptId) return json({ error: 'attempt_id обязателен' }, 400)

      const { data: attemptRow } = await supabase
        .from('operator_exam_attempts')
        .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status')
        .eq('id', attemptId)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!attemptRow) return json({ error: 'attempt-not-found' }, 404)

      const attempt = attemptRow as any
      if (!['completed', 'expired', 'undeliverable'].includes(String(attempt.status))) {
        return json({ error: 'Экзамен ещё не завершён — пересдавать нечего' }, 409)
      }

      const { data: examRow } = await supabase
        .from('operator_exams')
        .select('id, title, question_pool, open_pool, question_count, open_count')
        .eq('id', attempt.exam_id)
        .maybeSingle()
      if (!examRow) return json({ error: 'exam-not-found' }, 404)

      const exam = examRow as any
      const pool = (exam.question_pool || []) as ExamQuestion[]
      const openPool = (exam.open_pool || []) as ExamQuestion[]
      const ticket = buildOperatorTicket(
        pool,
        Math.min(Number(exam.question_count || 10), pool.length),
        openPool,
        Math.min(Number(exam.open_count || 0), openPool.length),
      )
      if (ticket.length === 0) return json({ error: 'В экзамене не осталось вопросов' }, 400)

      const { data: created, error: createError } = await supabase
        .from('operator_exam_attempts')
        .insert({
          exam_id: attempt.exam_id,
          organization_id: orgId,
          operator_id: attempt.operator_id,
          telegram_chat_id: attempt.telegram_chat_id,
          status: 'sent',
          sent_at: new Date().toISOString(),
          questions: ticket,
          total_questions: ticket.length,
        })
        .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status, questions, answers, current_index, total_questions, correct_answers, score, passed')
        .single()

      if (createError) return json({ error: 'retake-failed', detail: createError.message }, 500)

      const fresh = created as unknown as ExamAttemptRow
      if (fresh.telegram_chat_id) {
        await sendExamQuestion({ attempt: fresh, examTitle: String(exam.title || 'Экзамен') })
      }

      await pushToOperators(supabase as any, [String(attempt.operator_id)], {
        title: 'Пересдача',
        body: `${String(exam.title || 'Экзамен')}: назначена пересдача, ${ticket.length} ${pluralQuestions(ticket.length)}.`,
        data: { kind: 'operator-exam' },
      })

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'operator_exam.retake',
        entityType: 'operator_exam_attempt',
        entityId: String(fresh.id),
        payload: { exam_id: attempt.exam_id, operator_id: attempt.operator_id, previous_attempt: attemptId },
      })

      return json({ ok: true, data: { attempt_id: String(fresh.id), questions: ticket.length } })
    }

    // ─── Настройки автоаттестации новичка ─────────────────────────────────
    if (body.action === 'auto_settings') {
      const denied = await requireCapability(access, 'operator-exams.create')
      if (denied) return denied
      if (!orgId) return json({ error: 'no-organization' }, 400)

      const patch = {
        auto_exam_enabled: body.enabled === true,
        auto_exam_days: Math.max(1, Math.min(90, Number(body.days) || 7)),
        auto_exam_questions: Math.max(3, Math.min(20, Number(body.questions) || 10)),
        auto_exam_open: Math.max(0, Math.min(5, Number(body.open) || 0)),
        auto_exam_pass_score: Math.max(1, Math.min(100, Number(body.pass_score) || 70)),
      }

      const { error: settingsError } = await supabase.from('organizations').update(patch).eq('id', orgId)
      if (settingsError) {
        return json({ error: 'Не удалось сохранить: примените миграцию 20260815_auto_exam_for_newcomers', detail: settingsError.message }, 400)
      }

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'operator_exam.auto_settings',
        entityType: 'organization',
        entityId: orgId,
        payload: patch,
      })

      return json({ ok: true, data: patch })
    }

    // ─── Удалить экзамен вместе с попытками ───────────────────────────────
    if (body.action === 'delete') {
      const denied = await requireCapability(access, 'operator-exams.cancel')
      if (denied) return denied

      const examId = String(body.exam_id || '')
      if (!examId) return json({ error: 'exam_id обязателен' }, 400)

      const { data: exam } = await supabase
        .from('operator_exams')
        .select('id, title, status, created_at')
        .eq('id', examId)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!exam) return json({ error: 'exam-not-found' }, 404)

      // Что удаляем — фиксируем ДО удаления: попытки уйдут каскадом, и потом
      // по журналу нельзя будет понять, сколько результатов потеряно.
      const { data: attempts } = await supabase
        .from('operator_exam_attempts')
        .select('id, status, score')
        .eq('exam_id', examId)

      const { error: deleteError } = await supabase.from('operator_exams').delete().eq('id', examId)
      if (deleteError) return json({ error: 'exam-delete-failed', detail: deleteError.message }, 400)

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'operator_exam.delete',
        entityType: 'operator_exam',
        entityId: examId,
        payload: {
          title: (exam as any).title,
          status: (exam as any).status,
          attempts: (attempts || []).length,
          completed: (attempts || []).filter((row: any) => row.status === 'completed').length,
        },
      })

      return json({ ok: true, data: { deleted: true, attempts: (attempts || []).length } })
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
