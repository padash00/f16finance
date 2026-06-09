'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { supabase } from '@/lib/supabaseClient'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  HardDrive,
  Key,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Timer,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react'

// ────────────────────────────────────────────────────────────────────────────
//  Реестр таблиц по доменам.
// ────────────────────────────────────────────────────────────────────────────
type TableGroup = { title: string; tables: string[] }

const TABLE_GROUPS: TableGroup[] = [
  {
    title: 'Организация и авторизация',
    tables: [
      'organizations',
      'organization_members',
      'organization_subscriptions',
      'organization_billing_events',
      'subscription_plans',
      'roles',
      'role_capabilities',
      'role_paths',
      'user_capability_overrides',
      'tenant_domains',
      'position_paths',
    ],
  },
  {
    title: 'Компании и сотрудники',
    tables: [
      'companies',
      'operators',
      'operator_profiles',
      'operator_staff_links',
      'operator_company_assignments',
      'operator_messages',
    ],
  },
  {
    title: 'Инвентарь — каталог',
    tables: [
      'inventory_items',
      'inventory_categories',
      'inventory_suppliers',
      'inventory_locations',
      'invoice_name_mappings',
    ],
  },
  {
    title: 'Инвентарь — операции',
    tables: [
      'inventory_balances',
      'inventory_movements',
      'inventory_receipts',
      'inventory_receipt_items',
      'inventory_receipt_drafts',
      'inventory_requests',
      'inventory_request_items',
      'inventory_writeoffs',
      'inventory_writeoff_items',
      'inventory_stocktakes',
      'inventory_stocktake_items',
      'inventory_purchase_orders',
      'inventory_purchase_order_items',
      'inventory_consumption_norms',
      'inventory_point_limits',
    ],
  },
  {
    title: 'Продажи / POS',
    tables: [
      'point_sales',
      'point_sale_items',
      'point_returns',
      'point_return_items',
      'point_products',
      'point_debt_items',
      'point_receipt_settings',
      'point_rules',
      'point_devices',
      'point_device_messages',
      'point_qr_login_challenges',
      'customers',
      'loyalty_config',
      'discounts',
    ],
  },
  {
    title: 'Смены и зарплата',
    tables: [
      'point_shifts',
      'shift_change_requests',
      'shift_operator_week_responses',
      'shift_week_publications',
      'payroll_periods',
      'operator_salary_weeks',
      'operator_salary_week_payments',
      'operator_salary_week_payment_expenses',
      'operator_salary_week_company_allocations',
      'salary_calculation_runs',
      'salary_calculation_items',
      'day_off_requests',
    ],
  },
  {
    title: 'Финансы',
    tables: [
      'incomes',
      'debts',
      'expense_attachments',
      'expense_vendor_whitelist',
      'expense_wizard_sessions',
      'monthly_profitability_inputs',
      'supplier_debts',
      'supplier_debt_payments',
    ],
  },
  {
    title: 'Чек-листы и инциденты',
    tables: [
      'checklist_templates',
      'checklist_items',
      'checklist_runs',
      'incidents',
      'late_reports',
    ],
  },
  {
    title: 'Знания и обучение',
    tables: [
      'knowledge_articles',
      'knowledge_categories',
      'knowledge_article_confirmations',
      'knowledge_quiz_attempts',
    ],
  },
  {
    title: 'Arena / Simulation / Kiosk',
    tables: [
      'arena_games_catalog',
      'arena_map_decorations',
      'arena_station_games',
      'arena_tech_logs',
      'simulation_tariffs',
      'simulation_zones',
      'kiosk_client_tokens',
    ],
  },
  {
    title: 'AI и логи',
    tables: [
      'ai_memory',
      'ai_usage_log',
      'audit_log',
      'notification_log',
      'telegram_chat_history',
      'telegram_invoice_sessions',
      'news_posts',
      'news_views',
    ],
  },
  {
    title: 'Командный чат и сообщения',
    tables: [
      'direct_messages',
      'team_chat_messages',
      'team_chat_polls',
      'team_chat_poll_votes',
      'team_chat_presence',
      'team_chat_reactions',
      'team_chat_read_state',
      'chat_moderation_flags',
    ],
  },
  {
    title: 'Клиентский портал',
    tables: ['client_bookings', 'client_notification_outbox', 'client_support_tickets'],
  },
  {
    title: 'Настройки и прочее',
    tables: [
      'app_settings',
      'branch_plan_drafts',
      'payment_providers',
      'payment_provider_products',
      'company_payment_product_rates',
      'reminders',
      'goals',
      'kpi_plans',
      'kz_holidays',
      'notification_prefs',
      'push_devices',
      'report_snapshots',
    ],
  },
]

const ALL_TABLES = TABLE_GROUPS.flatMap((g) => g.tables)

// Sanity-метрики: последние записи по ключевым таблицам.
const SANITY_QUERIES: Array<{
  key: string
  label: string
  table: string
  column: string
  warnAfterMin: number
}> = [
  { key: 'sale', label: 'Последняя продажа', table: 'point_sales', column: 'sold_at', warnAfterMin: 60 * 12 },
  { key: 'shift', label: 'Последняя смена', table: 'point_shifts', column: 'opened_at', warnAfterMin: 60 * 24 },
  { key: 'login', label: 'Последняя активность', table: 'audit_log', column: 'created_at', warnAfterMin: 60 * 12 },
  { key: 'incident', label: 'Последний инцидент', table: 'incidents', column: 'occurred_at', warnAfterMin: 60 * 24 * 30 },
]

// ────────────────────────────────────────────────────────────────────────────
//  Типы
// ────────────────────────────────────────────────────────────────────────────

type TableStatus = 'pending' | 'ok' | 'empty' | 'missing' | 'error'

type TableResult = {
  name: string
  group: string
  status: TableStatus
  count: number | null
  error: string | null
  ms: number | null
}

type BucketInfo = { name: string; public: boolean }

type CronInfo = {
  path: string
  schedule: string
  last_run_at: string | null
}

type MigrationInfo = {
  applied_count: number
  file_count: number
  pending: string[]
  extra: string[]
  error: string | null
}

type SanityRow = {
  key: string
  label: string
  ts: string | null
  ageMin: number | null
  warnAfterMin: number
  error: string | null
}

// ────────────────────────────────────────────────────────────────────────────
//  Утилиты
// ────────────────────────────────────────────────────────────────────────────

async function batchRun<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    const res = await Promise.all(chunk.map(fn))
    out.push(...res)
  }
  return out
}

function fmtCount(n: number | null) {
  return n === null ? '—' : n.toLocaleString('ru-RU')
}

function classifyTableError(err: { code?: string; message?: string } | null): TableStatus {
  if (!err) return 'ok'
  const code = err.code || ''
  const msg = (err.message || '').toLowerCase()
  if (code === 'PGRST205' || code === '42P01' || msg.includes('not exist') || msg.includes('not found')) {
    return 'missing'
  }
  return 'error'
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'нет данных'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'в будущем'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const d = Math.floor(hr / 24)
  return `${d} дн назад`
}

function ageMin(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
}

const CRON_SCHEDULE_LABEL: Record<string, string> = {
  '0 * * * *': 'каждый час',
  '*/5 * * * *': 'каждые 5 мин',
}

function fmtCronSchedule(s: string) {
  return CRON_SCHEDULE_LABEL[s] || s
}

// ────────────────────────────────────────────────────────────────────────────
//  Страница
// ────────────────────────────────────────────────────────────────────────────

export default function DebugPage() {
  const [tableResults, setTableResults] = useState<TableResult[]>(
    TABLE_GROUPS.flatMap((g) =>
      g.tables.map((t) => ({
        name: t,
        group: g.title,
        status: 'pending' as TableStatus,
        count: null,
        error: null,
        ms: null,
      })),
    ),
  )
  const [buckets, setBuckets] = useState<BucketInfo[] | null>(null)
  const [bucketsError, setBucketsError] = useState<string | null>(null)
  const [crons, setCrons] = useState<CronInfo[] | null>(null)
  const [migrations, setMigrations] = useState<MigrationInfo | null>(null)
  const [systemError, setSystemError] = useState<string | null>(null)
  const [sanity, setSanity] = useState<SanityRow[]>(
    SANITY_QUERIES.map((q) => ({
      key: q.key,
      label: q.label,
      ts: null,
      ageMin: null,
      warnAfterMin: q.warnAfterMin,
      error: null,
    })),
  )
  const [authEmail, setAuthEmail] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'ok' | 'missing' | 'error' | 'empty'>('all')
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [showDetails, setShowDetails] = useState(false)

  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  const runAll = async () => {
    setLoading(true)
    const startedAt = Date.now()

    // session (только для отображения)
    supabase.auth.getSession().then((res: any) => {
      setAuthEmail(res?.data?.session?.user?.email || null)
    })

    // storage
    const storagePromise = supabase.storage.listBuckets().then((res: any) => {
      if (res?.error) {
        setBucketsError(res.error.message)
        setBuckets([])
      } else {
        setBuckets(
          (res?.data || []).map((b: any) => ({
            name: b.name,
            public: !!b.public,
          })),
        )
      }
    })

    // system info (cron + migrations)
    const systemPromise = fetch('/api/admin/debug/system', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          setSystemError(`HTTP ${res.status}`)
          return
        }
        const json = await res.json()
        setCrons(json.data?.crons || [])
        setMigrations(json.data?.migrations || null)
      })
      .catch((e) => setSystemError(e?.message || 'system error'))

    // sanity metrics
    const sanityPromise = Promise.all(
      SANITY_QUERIES.map(async (q) => {
        const res: any = await supabase
          .from(q.table)
          .select(q.column)
          .order(q.column, { ascending: false })
          .limit(1)
          .maybeSingle()
        if (res?.error) {
          return {
            key: q.key,
            label: q.label,
            ts: null,
            ageMin: null,
            warnAfterMin: q.warnAfterMin,
            error: res.error.message as string,
          }
        }
        const ts = (res?.data?.[q.column] as string | null) || null
        return {
          key: q.key,
          label: q.label,
          ts,
          ageMin: ageMin(ts),
          warnAfterMin: q.warnAfterMin,
          error: null,
        }
      }),
    ).then((rows) => setSanity(rows as SanityRow[]))

    // tables — батчами по 8, estimated count
    setTableResults((prev) =>
      prev.map((r) => ({ ...r, status: 'pending', count: null, error: null, ms: null })),
    )
    const flat = TABLE_GROUPS.flatMap((g) =>
      g.tables.map((t) => ({ name: t, group: g.title })),
    )
    const results = await batchRun(flat, 8, async (t) => {
      const t0 = Date.now()
      try {
        const res: any = await supabase
          .from(t.name)
          .select('*', { count: 'estimated', head: true })
        const ms = Date.now() - t0
        if (res?.error) {
          return {
            name: t.name,
            group: t.group,
            status: classifyTableError(res.error),
            count: null,
            error: res.error.message as string,
            ms,
          } as TableResult
        }
        const c = (res?.count as number | null) ?? 0
        return {
          name: t.name,
          group: t.group,
          status: c > 0 ? 'ok' : 'empty',
          count: c,
          error: null,
          ms,
        } as TableResult
      } catch (err: any) {
        return {
          name: t.name,
          group: t.group,
          status: 'error' as TableStatus,
          count: null,
          error: err?.message || 'unknown',
          ms: Date.now() - t0,
        }
      }
    })
    setTableResults(results)

    await Promise.all([storagePromise, systemPromise, sanityPromise])

    setTotalMs(Date.now() - startedAt)
    setLastRun(Date.now())
    setLoading(false)
  }

  useEffect(() => {
    runAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(
    () => ({
      total: tableResults.length,
      ok: tableResults.filter((r) => r.status === 'ok').length,
      empty: tableResults.filter((r) => r.status === 'empty').length,
      missing: tableResults.filter((r) => r.status === 'missing').length,
      error: tableResults.filter((r) => r.status === 'error').length,
      totalRows: tableResults.reduce((s, r) => s + (r.count || 0), 0),
    }),
    [tableResults],
  )

  // Алёрты — что реально требует внимания
  const alerts = useMemo(() => {
    const out: Array<{ severity: 'error' | 'warn'; text: string }> = []
    if (stats.missing > 0)
      out.push({
        severity: 'error',
        text: `Не найдено таблиц в БД: ${stats.missing}. Проверь миграции.`,
      })
    if (stats.error > 0)
      out.push({
        severity: 'error',
        text: `Таблиц с ошибками: ${stats.error}.`,
      })
    if (migrations && !migrations.error && migrations.pending.length > 0)
      out.push({
        severity: 'error',
        text: `Миграций не применено: ${migrations.pending.length}.`,
      })
    if (migrations && !migrations.error && migrations.extra.length > 0)
      out.push({
        severity: 'warn',
        text: `В БД лишние миграции (нет файла): ${migrations.extra.length}.`,
      })
    for (const s of sanity) {
      if (s.error) continue
      if (s.ageMin !== null && s.ageMin > s.warnAfterMin) {
        out.push({
          severity: 'warn',
          text: `${s.label}: ${fmtRelative(s.ts)} (норма < ${
            s.warnAfterMin >= 60 ? `${Math.round(s.warnAfterMin / 60)}ч` : `${s.warnAfterMin}м`
          }).`,
        })
      }
    }
    return out
  }, [stats, migrations, sanity])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return TABLE_GROUPS.map((g) => {
      const rows = tableResults.filter((r) => {
        if (r.group !== g.title) return false
        if (filter !== 'all' && r.status !== filter) return false
        if (q && !r.name.toLowerCase().includes(q)) return false
        return true
      })
      const problemCount = rows.filter(
        (r) => r.status === 'missing' || r.status === 'error',
      ).length
      return { ...g, rows, problemCount }
    }).filter((g) => g.rows.length > 0)
  }, [tableResults, search, filter])

  return (
    <div className="app-page-wide space-y-5">
      <Header
        loading={loading}
        onRun={runAll}
        lastRun={lastRun}
        totalMs={totalMs}
        authEmail={authEmail}
      />

      {alerts.length > 0 && <AlertsBanner alerts={alerts} />}

      <SanityRow rows={sanity} />

      <div className="grid gap-4 md:grid-cols-2">
        <CronsCard crons={crons} loading={loading} error={systemError} />
        <MigrationsCard migrations={migrations} loading={loading} />
      </div>

      <TablesSection
        loading={loading}
        tableResults={tableResults}
        stats={stats}
        search={search}
        setSearch={setSearch}
        filter={filter}
        setFilter={setFilter}
        groups={filteredGroups}
        expandedGroups={expandedGroups}
        toggleGroup={toggleGroup}
      />

      <div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-white"
        >
          {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Технические детали
        </button>
        {showDetails && (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <StorageCard buckets={buckets} error={bucketsError} />
            <EnvCard />
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//  Подкомпоненты
// ────────────────────────────────────────────────────────────────────────────

function Header({
  loading,
  onRun,
  lastRun,
  totalMs,
  authEmail,
}: {
  loading: boolean
  onRun: () => void
  lastRun: number | null
  totalMs: number | null
  authEmail: string | null
}) {
  const status = lastRun
    ? `проверено ${new Date(lastRun).toLocaleTimeString('ru-RU')} • ${totalMs} мс`
    : 'проверка не запускалась'
  const description = authEmail ? `${authEmail} • ${status}` : status
  return (
    <AdminPageHeader
      title="Диагностика системы"
      description={description}
      icon={<Wrench className="h-5 w-5" />}
      accent="blue"
      backHref="/"
      actions={
        <Button onClick={onRun} disabled={loading} variant="outline" size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Перезапустить
        </Button>
      }
    />
  )
}

function AlertsBanner({
  alerts,
}: {
  alerts: Array<{ severity: 'error' | 'warn'; text: string }>
}) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.05] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-200">
        <AlertTriangle className="h-4 w-4" />
        Требует внимания • {alerts.length}
      </div>
      <ul className="space-y-1 text-xs">
        {alerts.map((a, i) => (
          <li
            key={i}
            className={`flex items-start gap-2 ${
              a.severity === 'error' ? 'text-rose-300' : 'text-amber-200'
            }`}
          >
            <span className="mt-1 h-1 w-1 rounded-full bg-current shrink-0" />
            {a.text}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function SanityRow({ rows }: { rows: SanityRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {rows.map((r) => {
        const stale = r.ageMin !== null && r.ageMin > r.warnAfterMin
        const color = r.error
          ? 'text-rose-400'
          : stale
            ? 'text-amber-400'
            : r.ts
              ? 'text-emerald-400'
              : 'text-slate-500'
        return (
          <Card key={r.key} className="border-white/5 bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
              <Timer className="h-3 w-3" /> {r.label}
            </div>
            <div className={`mt-1 text-sm font-semibold ${color}`}>
              {r.error ? '—' : fmtRelative(r.ts)}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function CronsCard({
  crons,
  loading,
  error,
}: {
  crons: CronInfo[] | null
  loading: boolean
  error: string | null
}) {
  return (
    <Card className="border-white/5 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
        <Clock className="h-4 w-4 text-cyan-400" />
        Cron jobs {crons && <span className="text-slate-500">• {crons.length}</span>}
      </div>
      {error ? (
        <div className="text-xs text-rose-300">{error}</div>
      ) : crons === null ? (
        loading ? (
          <div className="text-xs text-slate-500">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            Загружаем…
          </div>
        ) : (
          <div className="text-xs text-slate-500">Нет данных</div>
        )
      ) : crons.length === 0 ? (
        <div className="text-xs text-slate-500">Кроны не настроены</div>
      ) : (
        <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1 text-xs">
          {crons.map((c) => {
            const name = c.path.replace('/api/cron/', '')
            return (
              <div
                key={c.path}
                className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5"
              >
                <span className="font-mono text-slate-200 truncate flex-1">{name}</span>
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {fmtCronSchedule(c.schedule)}
                </span>
                <span className="text-[10px] text-slate-500 truncate w-24 text-right">
                  {c.last_run_at ? fmtRelative(c.last_run_at) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-600">
        «—» в колонке последнего запуска значит, что крон не пишет в audit_log, не что он не работал.
      </p>
    </Card>
  )
}

function MigrationsCard({
  migrations,
  loading,
}: {
  migrations: MigrationInfo | null
  loading: boolean
}) {
  return (
    <Card className="border-white/5 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
        <Database className="h-4 w-4 text-violet-400" />
        Миграции
      </div>
      {!migrations ? (
        loading ? (
          <div className="text-xs text-slate-500">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            Загружаем…
          </div>
        ) : (
          <div className="text-xs text-slate-500">Нет данных</div>
        )
      ) : migrations.error ? (
        <div className="space-y-2">
          <div className="text-xs text-slate-400">
            Файлов миграций: <span className="text-white">{migrations.file_count}</span>
          </div>
          <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] p-2.5 text-[11px] leading-relaxed text-amber-200/80">
            {migrations.error}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-md border border-white/5 bg-white/[0.02] p-2">
              <div className="text-[10px] uppercase text-slate-500">В файлах</div>
              <div className="text-base font-bold text-white">{migrations.file_count}</div>
            </div>
            <div className="rounded-md border border-white/5 bg-white/[0.02] p-2">
              <div className="text-[10px] uppercase text-slate-500">В БД</div>
              <div className="text-base font-bold text-white">{migrations.applied_count}</div>
            </div>
          </div>
          {migrations.pending.length === 0 && migrations.extra.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Всё синхронизировано
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              {migrations.pending.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-rose-300">
                    Не применены ({migrations.pending.length})
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(migrations.pending.join('\n'))
                      }
                      className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[9px] normal-case text-slate-400 hover:bg-white/5 hover:text-white"
                    >
                      копировать список
                    </button>
                  </div>
                  <div className="max-h-[240px] space-y-0.5 overflow-y-auto pr-1">
                    {migrations.pending.map((m) => (
                      <div
                        key={m}
                        title={m}
                        className="break-all rounded bg-rose-500/5 px-2 py-1 font-mono text-[11px] leading-snug text-rose-200/90"
                      >
                        {m}.sql
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] text-slate-500">
                    Файлы лежат в <span className="font-mono">supabase/migrations/</span>.
                    Применить: открой SQL Editor в Supabase Dashboard и выполни содержимое
                    каждого файла по очереди в порядке по дате.
                  </div>
                </div>
              )}
              {migrations.extra.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-amber-300">
                    В БД, но нет файла ({migrations.extra.length})
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(migrations.extra.join('\n'))
                      }
                      className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[9px] normal-case text-slate-400 hover:bg-white/5 hover:text-white"
                    >
                      копировать
                    </button>
                  </div>
                  <div className="max-h-[160px] space-y-0.5 overflow-y-auto pr-1">
                    {migrations.extra.map((m) => (
                      <div
                        key={m}
                        title={m}
                        className="break-all rounded bg-amber-500/5 px-2 py-1 font-mono text-[11px] leading-snug text-amber-200/90"
                      >
                        {m}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function TablesSection({
  loading,
  tableResults,
  stats,
  search,
  setSearch,
  filter,
  setFilter,
  groups,
  expandedGroups,
  toggleGroup,
}: {
  loading: boolean
  tableResults: TableResult[]
  stats: {
    total: number
    ok: number
    empty: number
    missing: number
    error: number
    totalRows: number
  }
  search: string
  setSearch: (s: string) => void
  filter: 'all' | 'ok' | 'missing' | 'error' | 'empty'
  setFilter: (f: 'all' | 'ok' | 'missing' | 'error' | 'empty') => void
  groups: Array<TableGroup & { rows: TableResult[]; problemCount: number }>
  expandedGroups: Set<string>
  toggleGroup: (s: string) => void
}) {
  return (
    <Card className="border-white/5 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-white">
          Таблицы БД <span className="text-slate-500">• {stats.total}</span>
        </h2>
        <div className="text-xs text-slate-500">
          <span className="text-emerald-400">{stats.ok}</span> OK ·{' '}
          <span className="text-slate-400">{stats.empty}</span> пусто ·{' '}
          <span className="text-amber-400">{stats.missing}</span> нет ·{' '}
          <span className="text-rose-400">{stats.error}</span> ошибки
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск…"
              className="h-7 w-48 rounded-md border border-white/10 bg-white/[0.03] pl-6 pr-2 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500/40"
            />
          </div>
          <div className="flex gap-0.5 rounded-md bg-white/5 p-0.5 text-[10px]">
            {(
              [
                { key: 'all', label: 'Все' },
                { key: 'missing', label: 'Нет' },
                { key: 'error', label: 'Ошибки' },
                { key: 'empty', label: 'Пусто' },
                { key: 'ok', label: 'OK' },
              ] as const
            ).map((b) => (
              <button
                key={b.key}
                onClick={() => setFilter(b.key)}
                className={`px-2 py-1 rounded ${
                  filter === b.key
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && tableResults.every((r) => r.status === 'pending') ? (
        <div className="py-10 text-center text-xs text-slate-500">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Проверяем {ALL_TABLES.length} таблиц…
        </div>
      ) : groups.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500">Ничего не найдено</div>
      ) : (
        <div className="space-y-1.5">
          {groups.map((g) => (
            <TableGroupBlock
              key={g.title}
              title={g.title}
              rows={g.rows}
              problemCount={g.problemCount}
              expanded={expandedGroups.has(g.title) || g.problemCount > 0 || filter !== 'all'}
              onToggle={() => toggleGroup(g.title)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function TableGroupBlock({
  title,
  rows,
  problemCount,
  expanded,
  onToggle,
}: {
  title: string
  rows: TableResult[]
  problemCount: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.01]">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/[0.02]"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-slate-500" />
        ) : (
          <ChevronRight className="h-3 w-3 text-slate-500" />
        )}
        <span className="font-medium text-slate-300">{title}</span>
        <span className="text-slate-500">• {rows.length}</span>
        {problemCount > 0 && (
          <span className="ml-auto rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">
            {problemCount} проблем
          </span>
        )}
      </button>
      {expanded && (
        <div className="grid gap-px border-t border-white/5 bg-white/5 px-px pb-px sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <TableRow key={r.name} row={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function TableRow({ row }: { row: TableResult }) {
  const color = (() => {
    switch (row.status) {
      case 'ok':
        return 'bg-slate-950'
      case 'empty':
        return 'bg-slate-950'
      case 'missing':
        return 'bg-amber-500/[0.06]'
      case 'error':
        return 'bg-rose-500/[0.08]'
      default:
        return 'bg-slate-950'
    }
  })()

  const dot = (() => {
    switch (row.status) {
      case 'ok':
        return 'bg-emerald-400'
      case 'empty':
        return 'bg-slate-600'
      case 'missing':
        return 'bg-amber-400'
      case 'error':
        return 'bg-rose-400'
      default:
        return 'bg-slate-700 animate-pulse'
    }
  })()

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs ${color}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="font-mono text-slate-200 truncate flex-1">{row.name}</span>
      {row.error ? (
        <span
          title={row.error}
          className={`text-[10px] truncate max-w-[140px] ${
            row.status === 'missing' ? 'text-amber-300' : 'text-rose-300'
          }`}
        >
          {row.status === 'missing' ? 'нет' : row.error}
        </span>
      ) : (
        <span className="text-slate-400 tabular-nums">{fmtCount(row.count)}</span>
      )}
    </div>
  )
}

function StorageCard({
  buckets,
  error,
}: {
  buckets: BucketInfo[] | null
  error: string | null
}) {
  return (
    <Card className="border-white/5 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
        <HardDrive className="h-4 w-4 text-orange-400" />
        Storage {buckets && <span className="text-slate-500">• {buckets.length}</span>}
      </div>
      {error ? (
        <div className="text-xs text-rose-300">{error}</div>
      ) : !buckets ? (
        <div className="text-xs text-slate-500">…</div>
      ) : buckets.length === 0 ? (
        <div className="text-xs text-slate-500">Нет бакетов</div>
      ) : (
        <div className="space-y-1 text-xs">
          {buckets.map((b) => (
            <div
              key={b.name}
              className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5"
            >
              <span className="font-mono text-slate-200 flex-1 truncate">{b.name}</span>
              <span
                className={`text-[10px] ${
                  b.public ? 'text-emerald-300' : 'text-slate-500'
                }`}
              >
                {b.public ? 'public' : 'private'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function EnvCard() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  return (
    <Card className="border-white/5 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
        <Key className="h-4 w-4 text-amber-400" />
        Env (client-side)
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
          <span className="font-mono text-slate-400 flex-1">NEXT_PUBLIC_SUPABASE_URL</span>
          <span className={url ? 'text-emerald-400' : 'text-rose-400'}>
            {url ? '✓' : '✗'}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
          <span className="font-mono text-slate-400 flex-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>
          <span className={key ? 'text-emerald-400' : 'text-rose-400'}>
            {key ? '✓' : '✗'}
          </span>
        </div>
      </div>
    </Card>
  )
}
