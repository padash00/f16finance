import { NextResponse } from 'next/server'

import { getAdminEmails } from '@/lib/server/admin'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null

    const env = {
      supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      telegramBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
      adminEmails: getAdminEmails(),
      serviceRole: hasAdminSupabaseCredentials(),
    }

    if (!supabase) {
      return json({
        ok: true,
        env,
        checks: {
          summary: { warnings: ['Нет service role key, health route работает в ограниченном режиме.'] },
        },
      })
    }

    const [
      tasksRes,
      commentsRes,
      shiftsRes,
      operatorsRes,
      taskWithoutOperatorRes,
      operatorsWithoutTelegramRes,
      tasksOverdueRes,
    ] = await Promise.all([
      supabase.from('tasks').select('*', { count: 'exact', head: true }),
      supabase.from('task_comments').select('*', { count: 'exact', head: true }),
      supabase.from('shifts').select('*', { count: 'exact', head: true }),
      supabase.from('operators').select('*', { count: 'exact', head: true }),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).is('operator_id', null),
      supabase.from('operators').select('id', { count: 'exact', head: true }).eq('is_active', true).is('telegram_chat_id', null),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '(done,archived)')
        .lt('due_date', new Date().toISOString().slice(0, 10)),
    ])

    return json({
      ok: true,
      env,
      checks: {
        totals: {
          tasks: tasksRes.count || 0,
          taskComments: commentsRes.count || 0,
          shifts: shiftsRes.count || 0,
          operators: operatorsRes.count || 0,
        },
        dataQuality: {
          tasksWithoutOperator: taskWithoutOperatorRes.count || 0,
          overdueOpenTasks: tasksOverdueRes.count || 0,
          activeOperatorsWithoutTelegram: operatorsWithoutTelegramRes.count || 0,
        },
      },
    })
  } catch (error: any) {
    console.error('Admin health route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/health',
      message: error?.message || 'Admin health route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
