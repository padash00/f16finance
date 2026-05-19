'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  FileText,
  HardDrive,
  Key,
  Loader2,
  RefreshCw,
  Search,
  Server,
  XCircle,
  Zap,
} from 'lucide-react'

// ────────────────────────────────────────────────────────────────────────────
//  Полный реестр таблиц по доменам.
//  При добавлении новой миграции — добавить таблицу сюда.
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

const API_ENDPOINTS: Array<{ label: string; url: string; expect: number[] }> = [
  { label: 'Admin health', url: '/api/admin/health', expect: [200, 401] },
  { label: 'Point bootstrap', url: '/api/point/bootstrap', expect: [200, 401, 405] },
  { label: 'Point login', url: '/api/point/login', expect: [401, 405] },
  { label: 'Kiosk health', url: '/api/kiosk/health', expect: [200, 401, 404] },
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

type BucketInfo = {
  name: string
  public: boolean
  created_at: string | null
}

type EndpointResult = {
  label: string
  url: string
  status: 'pending' | 'ok' | 'unexpected' | 'error'
  code: number | null
  ms: number | null
  message?: string
}

type AuthInfo = {
  isAuthed: boolean
  email: string | null
  userId: string | null
  expiresAt: string | null
} | null

// ────────────────────────────────────────────────────────────────────────────
//  Утилиты
// ────────────────────────────────────────────────────────────────────────────

async function batchRun<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    const res = await Promise.all(chunk.map(fn))
    out.push(...res)
  }
  return out
}

function fmtCount(n: number | null) {
  if (n === null) return '—'
  return n.toLocaleString('ru-RU')
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
  const [endpoints, setEndpoints] = useState<EndpointResult[]>(
    API_ENDPOINTS.map((e) => ({
      label: e.label,
      url: e.url,
      status: 'pending' as const,
      code: null,
      ms: null,
    })),
  )
  const [auth, setAuth] = useState<AuthInfo>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [env, setEnv] = useState({
    url: '',
    urlExists: false,
    keyExists: false,
  })

  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'ok' | 'missing' | 'error' | 'empty'>('all')
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)

  const runAll = async () => {
    setLoading(true)
    const startedAt = Date.now()

    // env vars (на клиенте видны только NEXT_PUBLIC_*)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    setEnv({ url, urlExists: !!url, keyExists: !!key })

    // auth — параллельно с остальным
    const authPromise = supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          setAuthError(error.message)
          setAuth(null)
        } else if (data.session) {
          setAuth({
            isAuthed: true,
            email: data.session.user.email || null,
            userId: data.session.user.id,
            expiresAt: data.session.expires_at
              ? new Date(data.session.expires_at * 1000).toLocaleString('ru-RU')
              : null,
          })
        } else {
          setAuth({ isAuthed: false, email: null, userId: null, expiresAt: null })
        }
      })
      .catch((e) => setAuthError(e?.message || 'auth error'))

    // storage
    const storagePromise = supabase.storage
      .listBuckets()
      .then(({ data, error }) => {
        if (error) {
          setBucketsError(error.message)
          setBuckets([])
        } else {
          setBuckets(
            (data || []).map((b: any) => ({
              name: b.name,
              public: !!b.public,
              created_at: b.created_at || null,
            })),
          )
        }
      })
      .catch((e) => {
        setBucketsError(e?.message || 'storage error')
        setBuckets([])
      })

    // endpoints
    const endpointPromise = Promise.all(
      API_ENDPOINTS.map(async (e) => {
        const t0 = Date.now()
        try {
          const res = await fetch(e.url, { credentials: 'include' })
          const ms = Date.now() - t0
          const status: EndpointResult['status'] = e.expect.includes(res.status)
            ? 'ok'
            : 'unexpected'
          return { label: e.label, url: e.url, status, code: res.status, ms }
        } catch (err: any) {
          return {
            label: e.label,
            url: e.url,
            status: 'error' as const,
            code: null,
            ms: Date.now() - t0,
            message: err?.message || 'network error',
          }
        }
      }),
    ).then(setEndpoints)

    // tables — батчами по 8 параллельно, оценочный count
    setTableResults((prev) =>
      prev.map((r) => ({ ...r, status: 'pending', count: null, error: null, ms: null })),
    )
    const flatTables: Array<{ name: string; group: string }> = TABLE_GROUPS.flatMap((g) =>
      g.tables.map((t) => ({ name: t, group: g.title })),
    )
    const results = await batchRun(flatTables, 8, async (t) => {
      const t0 = Date.now()
      try {
        const { count, error } = await supabase
          .from(t.name)
          .select('*', { count: 'estimated', head: true })
        const ms = Date.now() - t0
        if (error) {
          const status = classifyTableError(error as any)
          return {
            name: t.name,
            group: t.group,
            status,
            count: null,
            error: error.message,
            ms,
          } as TableResult
        }
        const c = count ?? 0
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
          error: err?.message || 'unknown error',
          ms: Date.now() - t0,
        }
      }
    })
    setTableResults(results)

    await Promise.all([authPromise, storagePromise, endpointPromise])

    setTotalMs(Date.now() - startedAt)
    setLastRun(Date.now())
    setLoading(false)
  }

  useEffect(() => {
    runAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    return {
      total: tableResults.length,
      ok: tableResults.filter((r) => r.status === 'ok').length,
      empty: tableResults.filter((r) => r.status === 'empty').length,
      missing: tableResults.filter((r) => r.status === 'missing').length,
      error: tableResults.filter((r) => r.status === 'error').length,
      totalRows: tableResults.reduce((s, r) => s + (r.count || 0), 0),
    }
  }, [tableResults])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return TABLE_GROUPS.map((g) => {
      const rows = tableResults.filter((r) => {
        if (r.group !== g.title) return false
        if (filter !== 'all' && r.status !== filter) return false
        if (q && !r.name.toLowerCase().includes(q)) return false
        return true
      })
      return { ...g, rows }
    }).filter((g) => g.rows.length > 0)
  }, [tableResults, search, filter])

  return (
    <div className="app-page-wide space-y-6">
      <Header
        loading={loading}
        onRun={runAll}
        lastRun={lastRun}
        totalMs={totalMs}
      />

      <StatsRow stats={stats} />

      <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2 mr-auto">
            <Database className="w-5 h-5 text-blue-400" />
            Таблицы БД • {tableResults.length}
          </h2>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по таблице…"
              className="h-9 w-64 rounded-md border border-white/10 bg-white/[0.03] pl-7 pr-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500/40"
            />
          </div>
          <div className="flex gap-1 rounded-md bg-white/5 p-1 text-xs">
            {(
              [
                { key: 'all', label: 'Все' },
                { key: 'ok', label: `OK (${stats.ok})` },
                { key: 'empty', label: `Пусто (${stats.empty})` },
                { key: 'missing', label: `Нет (${stats.missing})` },
                { key: 'error', label: `Ошибки (${stats.error})` },
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

        {loading && tableResults.every((r) => r.status === 'pending') ? (
          <div className="py-12 text-center text-sm text-slate-400">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Проверяем {ALL_TABLES.length} таблиц…
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            Ничего не найдено по фильтру
          </div>
        ) : (
          <div className="space-y-5">
            {filteredGroups.map((g) => (
              <TableGroupSection key={g.title} title={g.title} rows={g.rows} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ApiEndpointsCard endpoints={endpoints} />
        <StorageCard buckets={buckets} error={bucketsError} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AuthCard auth={auth} error={authError} />
        <EnvCard env={env} />
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
}: {
  loading: boolean
  onRun: () => void
  lastRun: number | null
  totalMs: number | null
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border border-white/10 p-6 lg:p-8">
      <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-fuchsia-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl shadow-lg shadow-violet-500/25">
            <Database className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Диагностика системы
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              {lastRun
                ? `Последняя проверка: ${new Date(lastRun).toLocaleTimeString('ru-RU')}${
                    totalMs ? ` • ${totalMs} мс` : ''
                  }`
                : 'Проверка не запускалась'}
            </p>
          </div>
        </div>

        <Button
          onClick={onRun}
          disabled={loading}
          className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white border-0"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Перезапустить
        </Button>
      </div>
    </div>
  )
}

function StatsRow({
  stats,
}: {
  stats: {
    total: number
    ok: number
    empty: number
    missing: number
    error: number
    totalRows: number
  }
}) {
  const cells: Array<{ label: string; value: string; icon: any; color: string; bg: string }> = [
    {
      label: 'Таблиц',
      value: `${stats.ok + stats.empty} / ${stats.total}`,
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/20',
    },
    {
      label: 'Пустых',
      value: String(stats.empty),
      icon: AlertTriangle,
      color: 'text-slate-300',
      bg: 'bg-slate-500/20',
    },
    {
      label: 'Отсутствуют',
      value: String(stats.missing),
      icon: AlertTriangle,
      color: 'text-amber-400',
      bg: 'bg-amber-500/20',
    },
    {
      label: 'Ошибки',
      value: String(stats.error),
      icon: XCircle,
      color: 'text-rose-400',
      bg: 'bg-rose-500/20',
    },
    {
      label: 'Записей (≈)',
      value: stats.totalRows.toLocaleString('ru-RU'),
      icon: Database,
      color: 'text-blue-400',
      bg: 'bg-blue-500/20',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cells.map((c) => (
        <Card key={c.label} className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${c.bg}`}>
              <c.icon className={`w-4 h-4 ${c.color}`} />
            </div>
            <div>
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

function TableGroupSection({ title, rows }: { title: string; rows: TableResult[] }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">{title}</div>
      <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <TableRow key={r.name} row={r} />
        ))}
      </div>
    </div>
  )
}

function TableRow({ row }: { row: TableResult }) {
  const color = (() => {
    switch (row.status) {
      case 'ok':
        return 'border-emerald-500/20 bg-emerald-500/[0.04]'
      case 'empty':
        return 'border-white/5 bg-white/[0.02]'
      case 'missing':
        return 'border-amber-500/20 bg-amber-500/[0.06]'
      case 'error':
        return 'border-rose-500/30 bg-rose-500/[0.06]'
      default:
        return 'border-white/5 bg-white/[0.02]'
    }
  })()

  const icon = (() => {
    switch (row.status) {
      case 'ok':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      case 'empty':
        return <span className="h-3.5 w-3.5 rounded-full border border-slate-500/40 shrink-0" />
      case 'missing':
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      case 'error':
        return <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
      default:
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />
    }
  })()

  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${color}`}>
      {icon}
      <span className="font-mono text-slate-200 truncate flex-1">{row.name}</span>
      {row.error ? (
        <span
          title={row.error}
          className={`text-[10px] truncate max-w-[160px] ${
            row.status === 'missing' ? 'text-amber-300' : 'text-rose-300'
          }`}
        >
          {row.status === 'missing' ? 'нет таблицы' : row.error}
        </span>
      ) : (
        <span className="text-slate-400 tabular-nums">
          {fmtCount(row.count)}
        </span>
      )}
      {row.ms !== null && (
        <span className="text-[10px] text-slate-600 tabular-nums">{row.ms}ms</span>
      )}
    </div>
  )
}

function ApiEndpointsCard({ endpoints }: { endpoints: EndpointResult[] }) {
  return (
    <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Server className="w-5 h-5 text-cyan-400" />
        API endpoints
      </h2>
      <div className="space-y-1.5">
        {endpoints.map((e) => {
          const color =
            e.status === 'ok'
              ? 'text-emerald-300'
              : e.status === 'unexpected'
                ? 'text-amber-300'
                : e.status === 'error'
                  ? 'text-rose-300'
                  : 'text-slate-400'
          return (
            <div
              key={e.url}
              className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-xs"
            >
              <span className="font-medium text-slate-200 w-32 truncate">{e.label}</span>
              <span className="font-mono text-slate-500 truncate flex-1">{e.url}</span>
              <span className={`tabular-nums ${color}`}>
                {e.status === 'pending' ? '…' : e.code ?? 'fail'}
              </span>
              {e.ms !== null && (
                <span className="text-[10px] text-slate-600 tabular-nums">{e.ms}ms</span>
              )}
            </div>
          )
        })}
      </div>
    </Card>
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
    <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <HardDrive className="w-5 h-5 text-orange-400" />
        Storage buckets
        {buckets && (
          <span className="ml-auto text-xs font-normal text-slate-500">
            {buckets.length}
          </span>
        )}
      </h2>
      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : buckets === null ? (
        <div className="text-xs text-slate-500">
          <Loader2 className="inline mr-1 h-3 w-3 animate-spin" /> Загружаем…
        </div>
      ) : buckets.length === 0 ? (
        <div className="text-xs text-slate-500">Нет бакетов</div>
      ) : (
        <div className="space-y-1.5">
          {buckets.map((b) => (
            <div
              key={b.name}
              className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-xs"
            >
              <span className="font-mono text-slate-200 flex-1 truncate">{b.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  b.public
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-500/15 text-slate-400'
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

function AuthCard({ auth, error }: { auth: AuthInfo; error: string | null }) {
  return (
    <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Zap className="w-5 h-5 text-yellow-400" />
        Сессия
      </h2>
      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : auth === null ? (
        <div className="text-xs text-slate-500">
          <Loader2 className="inline mr-1 h-3 w-3 animate-spin" /> Проверяем…
        </div>
      ) : auth.isAuthed ? (
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-slate-200">{auth.email || 'без email'}</span>
          </div>
          <div className="font-mono text-[10px] text-slate-500 truncate">{auth.userId}</div>
          {auth.expiresAt && (
            <div className="text-slate-500">Истекает: {auth.expiresAt}</div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Не авторизован (гостевой режим)
        </div>
      )}
    </Card>
  )
}

function EnvCard({
  env,
}: {
  env: { url: string; urlExists: boolean; keyExists: boolean }
}) {
  return (
    <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Key className="w-5 h-5 text-amber-400" />
        Переменные окружения
      </h2>
      <div className="space-y-1.5">
        <EnvRow label="NEXT_PUBLIC_SUPABASE_URL" exists={env.urlExists} value={env.url} />
        <EnvRow
          label="NEXT_PUBLIC_SUPABASE_ANON_KEY"
          exists={env.keyExists}
          value={env.keyExists ? '••••••••' : ''}
        />
      </div>
      <p className="mt-3 text-[10px] text-slate-500 flex items-center gap-1">
        <FileText className="h-3 w-3" />
        Server-side переменные (SERVICE_ROLE, токены) не видны на клиенте — это нормально.
      </p>
    </Card>
  )
}

function EnvRow({
  label,
  exists,
  value,
}: {
  label: string
  exists: boolean
  value: string
}) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-slate-300 truncate">{label}</span>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full ${
            exists
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-rose-500/15 text-rose-300'
          }`}
        >
          {exists ? '✓ найден' : '✗ отсутствует'}
        </span>
      </div>
      {value && (
        <div className="mt-1 text-[10px] font-mono text-slate-500 truncate">{value}</div>
      )}
    </div>
  )
}
