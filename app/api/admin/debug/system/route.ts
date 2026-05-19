import { NextResponse } from 'next/server'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type CronEntry = { path: string; schedule: string }
type VercelConfig = { crons?: CronEntry[] }

async function readVercelCrons(): Promise<CronEntry[]> {
  try {
    const root = process.cwd()
    const raw = await readFile(path.join(root, 'vercel.json'), 'utf-8')
    const cfg = JSON.parse(raw) as VercelConfig
    return Array.isArray(cfg.crons) ? cfg.crons : []
  } catch {
    return []
  }
}

async function readMigrationFiles(): Promise<string[]> {
  try {
    const dir = path.join(process.cwd(), 'supabase', 'migrations')
    const entries = await readdir(dir)
    return entries
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort()
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const [crons, fileMigrations] = await Promise.all([readVercelCrons(), readMigrationFiles()])

    // Применённые миграции (Supabase Studio пишет в supabase_migrations.schema_migrations).
    // PostgREST по умолчанию не отдаёт нестандартные схемы — пробуем через RPC или сырым SQL.
    let appliedMigrations: string[] = []
    let migrationsError: string | null = null
    try {
      const { data, error } = await (supabase as any)
        .schema('supabase_migrations')
        .from('schema_migrations')
        .select('version')
        .order('version', { ascending: true })
      if (error) throw error
      appliedMigrations = (data || []).map((r: any) => String(r.version))
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('not exist') || (e as any)?.code === '42P01' || (e as any)?.code === 'PGRST205') {
        migrationsError =
          'Таблица supabase_migrations.schema_migrations не существует. Она создаётся при применении миграций через `supabase db push` (CLI). Если применяешь миграции вручную через SQL Editor — drift невозможно посчитать автоматически.'
      } else {
        migrationsError = msg || 'не удалось прочитать supabase_migrations.schema_migrations'
      }
    }

    const appliedSet = new Set(appliedMigrations)
    const fileSet = new Set(fileMigrations)
    const pending = fileMigrations.filter((f) => {
      // formats: 20260322120000, 20260322120000_name — версия = leading timestamp
      const version = f.split('_')[0]
      return !appliedSet.has(version) && !appliedSet.has(f)
    })
    const extra = appliedMigrations.filter((a) => !fileSet.has(a) && !fileSet.has(`${a}`))

    // По каждому крону вытащим последнюю запись audit_log
    // (только те, что пишут с entity_type='cron' — этого делают мало мест,
    // но всё равно отдаём что есть).
    const cronPaths = crons.map((c) => c.path)
    let lastRunsByCron: Record<string, string> = {}
    if (cronPaths.length > 0) {
      const { data: auditRows } = await supabase
        .from('audit_log')
        .select('entity_id, created_at')
        .eq('entity_type', 'cron')
        .in('entity_id', cronPaths)
        .order('created_at', { ascending: false })
        .limit(cronPaths.length * 2)
      for (const row of (auditRows || []) as any[]) {
        const k = String(row.entity_id)
        if (!lastRunsByCron[k]) lastRunsByCron[k] = row.created_at
      }
    }

    return json({
      ok: true,
      data: {
        crons: crons.map((c) => ({
          path: c.path,
          schedule: c.schedule,
          last_run_at: lastRunsByCron[c.path] || null,
        })),
        migrations: {
          applied_count: appliedMigrations.length,
          file_count: fileMigrations.length,
          pending,
          extra,
          error: migrationsError,
        },
      },
    })
  } catch (error: any) {
    return json(
      { error: 'debug-system-failed', detail: error?.message || String(error) },
      500,
    )
  }
}
