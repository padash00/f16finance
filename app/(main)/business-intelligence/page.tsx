'use client'

/**
 * /business-intelligence — «что требует внимания» простыми словами.
 *
 * Страница отвечает на пять вопросов владельца: что заказать, что лежит без
 * дела, где выручка странная, кто из клиентов уходит, где недостачи. Формулы
 * спрятаны под «Как считается». Каждый блок ведёт в раздел, где с этим работают.
 * Данные — lib/server/business-intelligence.ts.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  ClipboardList,
  Info,
  Loader2,
  PackageX,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  Users,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { NativeSelect } from '@/components/ui/native-select'
import { readApiCache, writeApiCache } from '@/lib/client/use-api-cache'
import type { BusinessIntelligenceResult, RfmCustomer } from '@/lib/server/business-intelligence'

type Company = { id: string; name: string }

const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU') + ' ₸'
const num = (n: number) => (Math.round((n || 0) * 10) / 10).toLocaleString('ru-RU')
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const dayLabel = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}.${m[2]}, ${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}`
}
const daysWord = (n: number) => {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return 'дней'
  if (b === 1) return 'день'
  if (b >= 2 && b <= 4) return 'дня'
  return 'дней'
}

// Сегменты клиентов простыми словами
const SEGMENT_LABELS: Record<string, string> = {
  Чемпионы: 'Лучшие',
  Лояльные: 'Постоянные',
  Новички: 'Новые',
  'В зоне риска': 'Уходят',
  Потеряны: 'Ушли',
  Обычные: 'Обычные',
}

const th = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'
const td = 'px-3 py-2 text-sm tabular-nums text-foreground'

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="min-w-full">
        <thead className="bg-surface-muted">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  )
}

function HowCalculated({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-4 text-sm">
      <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <Info className="h-3.5 w-3.5" /> Как считается
      </summary>
      <div className="mt-2 space-y-1.5 rounded-lg bg-surface-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </details>
  )
}

function Section({
  id,
  icon,
  title,
  subtitle,
  link,
  children,
}: {
  id: string
  icon: ReactNode
  title: string
  subtitle: string
  link?: { href: string; label: string }
  children: ReactNode
}) {
  return (
    <Card id={id} className="scroll-mt-24 gap-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            {icon}
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {link ? (
          <Button asChild variant="outline" size="sm">
            <Link href={link.href}>
              {link.label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-surface-muted px-3 py-3 text-sm text-muted-foreground">{children}</p>
}

function Tile({
  href,
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  href: string
  icon: ReactNode
  label: string
  value: string
  hint: string
  tone?: 'neutral' | 'warn' | 'bad' | 'good'
}) {
  const toneCls = {
    neutral: 'text-foreground',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-rose-600 dark:text-rose-400',
    good: 'text-emerald-600 dark:text-emerald-400',
  }[tone]
  return (
    <a href={href} className="block rounded-xl border border-border bg-card p-4 transition hover:bg-surface-muted">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={`mt-1.5 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </a>
  )
}

export default function BusinessIntelligencePage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [period, setPeriod] = useState<string>('90')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<BusinessIntelligenceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ai, setAi] = useState<string[] | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(false)

  const customActive = period === 'custom' && !!customFrom && !!customTo
  const waitingForDates = period === 'custom' && !customActive

  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setCompanies(Array.isArray(j?.data) ? j.data : []))
      .catch(() => setCompanies([]))
  }, [])

  const query = useCallback(() => {
    const p = new URLSearchParams()
    if (companyId) p.set('company_id', companyId)
    if (customActive) {
      p.set('from', customFrom)
      p.set('to', customTo)
    } else if (period !== 'custom') {
      p.set('days', period)
    }
    return p
  }, [companyId, customActive, customFrom, customTo, period])

  const load = useCallback(
    async (force = false) => {
      if (waitingForDates) return
      const url = `/api/admin/business-intelligence?${query()}`
      const cached = force ? null : readApiCache<BusinessIntelligenceResult>(url)
      if (cached) setData(cached)
      setLoading(!cached)
      setError(null)
      setAi(null)
      setAiError(false)
      try {
        const res = await fetch(url, { cache: 'no-store' })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.ok) throw new Error(body?.error || 'Не удалось загрузить')
        setData(body.data)
        writeApiCache(url, body.data)
      } catch (e: any) {
        setError(e?.message || 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    },
    [query, waitingForDates],
  )

  useEffect(() => {
    void load()
  }, [load])

  // ИИ — только по кнопке: каждый запуск стоит денег
  const askAi = async () => {
    setAiLoading(true)
    setAiError(false)
    try {
      const p = query()
      const res = await fetch('/api/ai/business-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: p.get('company_id'),
          days: p.get('days') ? Number(p.get('days')) : null,
          from: p.get('from'),
          to: p.get('to'),
        }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.ok && Array.isArray(body.actions) && body.actions.length) setAi(body.actions)
      else setAiError(true)
    } catch {
      setAiError(true)
    } finally {
      setAiLoading(false)
    }
  }

  const periodText = data?.anomalies.from ? `${dayLabel(data.anomalies.from)} — ${dayLabel(data.anomalies.to)}` : ''

  return (
    <div className="app-page-wide space-y-5 text-foreground">
      <AdminPageHeader
        title="Бизнес-аналитика"
        description="Что заказать, что лежит без дела, где выручка странная, кто уходит и где недостачи"
        icon={<Brain className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Период">
              <option value="30">Месяц</option>
              <option value="90">Квартал</option>
              <option value="180">Полгода</option>
              <option value="365">Год</option>
              <option value="custom">Свой период</option>
            </NativeSelect>
            {period === 'custom' ? (
              <>
                <DatePicker value={customFrom} max={customTo || undefined} onChange={setCustomFrom} />
                <span className="text-sm text-muted-foreground">—</span>
                <DatePicker value={customTo} min={customFrom || undefined} onChange={setCustomTo} />
              </>
            ) : null}
            <NativeSelect className="w-auto" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Точка">
              <option value="">Все точки</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading || waitingForDates}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
            </Button>
          </div>
        }
      />

      {waitingForDates ? <Empty>Выберите обе даты периода.</Empty> : null}

      {error ? (
        <Card className="flex-row items-center gap-2 border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </Card>
      ) : null}

      {loading && !data ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
          <p className="text-sm">Собираем продажи, остатки, ревизии и клиентов…</p>
        </div>
      ) : data ? (
        <div className={loading ? 'space-y-5 opacity-60 transition-opacity' : 'space-y-5'}>
          <Summary data={data} />

          <Card className="gap-0 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="h-4 w-4 text-violet-500" /> С чего начать
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">ИИ прочитает всё ниже и назовёт 3–5 дел по важности.</p>
              </div>
              <Button size="sm" onClick={askAi} disabled={aiLoading || loading}>
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {ai ? 'Спросить заново' : 'Спросить ИИ'}
              </Button>
            </div>
            {ai ? (
              <ol className="mt-4 space-y-2">
                {ai.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-semibold text-white">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{line}</span>
                  </li>
                ))}
              </ol>
            ) : aiError ? (
              <p className="mt-3 text-sm text-muted-foreground">ИИ сейчас недоступен — попробуйте позже.</p>
            ) : null}
          </Card>

          <RestockCard data={data} />
          <IdleCard data={data} />
          <RevenueCard data={data} periodText={periodText} />
          <CustomersCard data={data} />
          <ShortagesCard data={data} periodText={periodText} />

          <p className="pt-1 text-center text-xs text-muted-foreground">
            {periodText ? `Период: ${periodText} · ` : ''}обновлено {new Date(data.generatedAt).toLocaleString('ru-RU')}
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ── Сводка наверху: пять вопросов, каждый ведёт к своему блоку ──────────────

function Summary({ data }: { data: BusinessIntelligenceResult }) {
  const { restock, idleStock, anomalies, rfm, cashierRisk } = data
  const atRiskSpent = rfm.atRisk.reduce((s, c) => s + c.monetary, 0)
  const drops = anomalies.anomalies.filter((a) => a.direction === 'below').length
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile
        href="#restock"
        icon={<ShoppingCart className="h-3.5 w-3.5" />}
        label="Заказать"
        value={!data.hasStore ? '—' : restock.itemsCount ? `${restock.itemsCount} ${restock.itemsCount === 1 ? 'товар' : 'товаров'}` : 'ничего'}
        hint={!data.hasStore ? 'нет склада' : restock.itemsCount ? `${money(restock.totalAmount)}${restock.urgentCount ? ` · срочно ${restock.urgentCount}` : ''}` : 'хватает на 2 недели'}
        tone={restock.urgentCount ? 'bad' : restock.itemsCount ? 'warn' : 'good'}
      />
      <Tile
        href="#idle"
        icon={<PackageX className="h-3.5 w-3.5" />}
        label="Лежит без продаж"
        value={data.hasStore ? money(idleStock.noSalesValue) : '—'}
        hint={data.hasStore ? `${idleStock.noSalesCount} товаров за период` : 'нет склада'}
        tone={idleStock.noSalesValue > 0 ? 'warn' : 'neutral'}
      />
      <Tile
        href="#revenue"
        icon={<TrendingDown className="h-3.5 w-3.5" />}
        label="Странные дни"
        value={anomalies.available ? String(anomalies.anomalies.length) : '—'}
        hint={anomalies.available ? (drops ? `из них провалов: ${drops}` : 'провалов нет') : 'нет доходов'}
        tone={drops ? 'warn' : 'neutral'}
      />
      <Tile
        href="#customers"
        icon={<Users className="h-3.5 w-3.5" />}
        label="Уходят клиенты"
        value={rfm.available ? String(rfm.atRisk.length) : '—'}
        hint={rfm.available ? (rfm.atRisk.length ? `тратили ${money(atRiskSpent)}` : 'постоянные на месте') : 'нет клиентской базы'}
        tone={rfm.atRisk.length ? 'warn' : 'neutral'}
      />
      <Tile
        href="#shortages"
        icon={<ClipboardList className="h-3.5 w-3.5" />}
        label="Недостачи"
        value={cashierRisk.available ? money(cashierRisk.totalShortage) : '—'}
        hint={cashierRisk.available ? `по ${cashierRisk.actsAnalyzed} ревизиям` : 'ревизий не было'}
        tone={cashierRisk.totalShortage > 0 ? 'bad' : 'neutral'}
      />
    </div>
  )
}

// ── Что заказать ────────────────────────────────────────────────────────────

function RestockCard({ data }: { data: BusinessIntelligenceResult }) {
  const { restock } = data
  const multiCompany = new Set(restock.lines.map((l) => l.companyId)).size > 1
  return (
    <Section
      id="restock"
      icon={<ShoppingCart className="h-4 w-4 text-violet-500" />}
      title="Что заказать"
      subtitle="Товары, которых не хватит на ближайшие 2 недели. Сначала те, что кончатся раньше."
      link={data.hasStore ? { href: '/store/purchase-plan', label: 'План закупа' } : undefined}
    >
      {!data.hasStore ? (
        <Empty>У выбранной точки нет склада — товарный учёт не ведётся.</Empty>
      ) : restock.lines.length === 0 ? (
        <Empty>Заказывать ничего не нужно: всего хватает на 2 недели вперёд.</Empty>
      ) : (
        <Table
          head={
            <>
              <th className={th}>Товар</th>
              {multiCompany ? <th className={th}>Точка</th> : null}
              <th className={th}>Остаток</th>
              <th className={th}>Хватит на</th>
              <th className={th}>Взять</th>
              <th className={th}>Сумма</th>
            </>
          }
        >
          {restock.lines.map((l) => (
            <tr key={`${l.companyId}:${l.item_id}`}>
              <td className={`${td} font-medium`}>
                {l.name}
                <span className="block text-xs font-normal text-muted-foreground">{l.supplier !== '—' ? l.supplier : 'поставщик не указан'}</span>
              </td>
              {multiCompany ? <td className={td}>{l.company}</td> : null}
              <td className={td}>{num(l.stock)}</td>
              <td className={td}>
                {l.daysLeft === 0 ? (
                  <span className="font-medium text-rose-600 dark:text-rose-400">уже нет</span>
                ) : (
                  <span className={l.daysLeft <= 3 ? 'font-medium text-rose-600 dark:text-rose-400' : l.daysLeft <= 7 ? 'text-amber-600 dark:text-amber-400' : ''}>
                    {l.daysLeft} {daysWord(l.daysLeft)}
                  </span>
                )}
              </td>
              <td className={`${td} font-semibold`}>{num(l.order)} шт</td>
              <td className={td}>{money(l.amount)}</td>
            </tr>
          ))}
        </Table>
      )}
      {restock.itemsCount > restock.lines.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Показаны {restock.lines.length} из {restock.itemsCount}. Весь список с разбивкой по поставщикам — в плане закупа.
        </p>
      ) : null}
      <HowCalculated>
        <p>Тот же расчёт, что в «Плане закупа», поэтому цифры совпадают.</p>
        <p>Спрос в неделю — продажи за последние 4 недели, делённые на 4. Держим запас на 2 недели: взять = 2 недели спроса − остаток, с округлением до целых упаковок.</p>
        <p>«Хватит на» — остаток, делённый на дневной спрос. Сумма — по цене последней приёмки.</p>
      </HowCalculated>
    </Section>
  )
}

// ── Что лежит без дела + главные товары ─────────────────────────────────────

function IdleCard({ data }: { data: BusinessIntelligenceResult }) {
  const { idleStock, abc } = data
  const classA = abc.classes.find((c) => c.cls === 'A')
  return (
    <Section
      id="idle"
      icon={<PackageX className="h-4 w-4 text-amber-500" />}
      title="Что лежит без дела"
      subtitle="Деньги, замороженные в товаре: он не продаётся или его взяли слишком много."
      link={data.hasStore ? { href: '/store/abc', label: 'ABC-анализ' } : undefined}
    >
      {!data.hasStore ? (
        <Empty>У выбранной точки нет склада — товарный учёт не ведётся.</Empty>
      ) : (
        <div className="space-y-5">
          {abc.available && classA ? (
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm">
                <span className="font-semibold">{classA.itemCount} товаров</span> приносят{' '}
                <span className="font-semibold">{Math.round(classA.revenueSharePct)}% выручки</span> магазина из {abc.totalItems} продававшихся.
                Их нельзя допускать до нуля.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {abc.vital.slice(0, 12).map((v) => (
                  <span key={v.item_id} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs">
                    {v.name} · {money(v.revenue)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">
                Ни одной продажи за период <span className="text-muted-foreground">· {money(idleStock.noSalesValue)}</span>
              </p>
              {idleStock.noSales.length === 0 ? (
                <Empty>Всё, что лежит на остатке, продавалось.</Empty>
              ) : (
                <Table
                  head={
                    <>
                      <th className={th}>Товар</th>
                      <th className={th}>Остаток</th>
                      <th className={th}>Заморожено</th>
                    </>
                  }
                >
                  {idleStock.noSales.slice(0, 12).map((r) => (
                    <tr key={r.item_id}>
                      <td className={`${td} font-medium`}>{r.name}</td>
                      <td className={td}>{num(r.stock)}</td>
                      <td className={td}>{money(r.value)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">
                Взяли с запасом больше чем на месяц <span className="text-muted-foreground">· {money(idleStock.overstockValue)}</span>
              </p>
              {idleStock.overstock.length === 0 ? (
                <Empty>Перезатоваренных товаров нет.</Empty>
              ) : (
                <Table
                  head={
                    <>
                      <th className={th}>Товар</th>
                      <th className={th}>Хватит на</th>
                      <th className={th}>Стоит</th>
                    </>
                  }
                >
                  {idleStock.overstock.slice(0, 12).map((r) => (
                    <tr key={`${r.company}:${r.item_id}`}>
                      <td className={`${td} font-medium`}>{r.name}</td>
                      <td className={td}>{r.weeksLeft >= 99 ? 'не продаётся' : `${num(r.weeksLeft)} нед`}</td>
                      <td className={td}>{money(r.value)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          </div>
        </div>
      )}
      <HowCalculated>
        <p>«Ни одной продажи» — товар есть на остатке, но за выбранный период не продан ни разу. Заморожено = остаток × закупочная цена из карточки.</p>
        <p>«С запасом больше чем на месяц» — из плана закупа: остатка хватит больше чем на 4 недели при текущем спросе. Такое не докупать.</p>
        <p>Главные товары — отсортированы по выручке за период; сверху те, что вместе дают 80% выручки (класс A в ABC-анализе).</p>
      </HowCalculated>
    </Section>
  )
}

// ── Где выручка странная ────────────────────────────────────────────────────

function RevenueCard({ data, periodText }: { data: BusinessIntelligenceResult; periodText: string }) {
  const { anomalies } = data
  return (
    <Section
      id="revenue"
      icon={<TrendingDown className="h-4 w-4 text-sky-500" />}
      title="Где выручка странная"
      subtitle="Дни, когда точка заработала заметно больше или меньше, чем обычно в этот день недели."
      link={{ href: '/income', label: 'Доходы' }}
    >
      {!anomalies.available ? (
        <Empty>За период нет доходов в отчётах смен.</Empty>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {anomalies.points.map((p) => (
              <span key={p.companyId} className="rounded-lg border border-border px-2.5 py-1 text-xs">
                {p.company}: обычный день <span className="font-semibold tabular-nums">{money(p.typicalDay)}</span>
              </span>
            ))}
          </div>
          {anomalies.anomalies.length === 0 ? (
            <Empty>Странных дней нет — выручка шла в своём обычном ритме.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th className={th}>Точка</th>
                  <th className={th}>День</th>
                  <th className={th}>Выручка</th>
                  <th className={th}>Обычно</th>
                  <th className={th}>Разница</th>
                  <th className={th} />
                </>
              }
            >
              {anomalies.anomalies.map((a) => (
                <tr key={`${a.companyId}:${a.date}`}>
                  <td className={`${td} font-medium`}>{a.company}</td>
                  <td className={td}>{dayLabel(a.date)}</td>
                  <td className={td}>{money(a.revenue)}</td>
                  <td className={`${td} text-muted-foreground`}>{money(a.expected)}</td>
                  <td className={td}>
                    <span className={a.direction === 'above' ? 'text-emerald-600 dark:text-emerald-400' : 'font-medium text-rose-600 dark:text-rose-400'}>
                      {a.deviation > 0 ? '+' : ''}
                      {Math.round(a.deviation * 100)}%
                    </span>
                  </td>
                  <td className={td}>
                    <Link
                      href={`/income?from=${a.date}&to=${a.date}&company_id=${a.companyId}`}
                      className="text-xs text-violet-600 hover:underline dark:text-violet-400"
                    >
                      смены
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
      <HowCalculated>
        <p>Берём доходы из отчётов смен по каждой точке{periodText ? ` (${periodText})` : ''}. Безнал ночной смены после полуночи относим к следующему дню — как в отчётах.</p>
        <p>
          «Обычно» — средняя (медианная) выручка этой точки в тот же день недели за период (не меньше чем за 8 недель), не считая сам день. Поэтому
          загруженные выходные клуба не считаются странными.
        </p>
        <p>
          День попадает в список, если отличается от обычного минимум на 25% и это отклонение втрое больше привычных колебаний точки.
          Провал — повод проверить смену: сбой кассы, не пробили, не внесли безнал.
        </p>
        <p>Дни без отчёта не оцениваются — это недовнесённые данные, а не провал.</p>
      </HowCalculated>
    </Section>
  )
}

// ── Кто из клиентов уходит ──────────────────────────────────────────────────

function CustomersCard({ data }: { data: BusinessIntelligenceResult }) {
  const { rfm } = data
  const lastVisit = (c: RfmCustomer) => (c.recencyDays >= 9999 ? 'покупок нет' : `${c.recencyDays} ${daysWord(c.recencyDays)} назад`)
  return (
    <Section
      id="customers"
      icon={<Users className="h-4 w-4 text-emerald-500" />}
      title="Кто из клиентов уходит"
      subtitle="Постоянные клиенты, которые раньше приходили часто и тратили много, а сейчас давно не появлялись."
      link={{ href: '/customers', label: 'Клиенты' }}
    >
      {!rfm.available ? (
        <Empty>{rfm.note ? `${rfm.note[0].toUpperCase()}${rfm.note.slice(1)}.` : 'Нет данных о клиентах.'}</Empty>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {rfm.segments.map((s) => (
              <span
                key={s.segment}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  s.segment === 'В зоне риска' ? 'border-amber-500/40 bg-amber-500/10' : 'border-border'
                }`}
              >
                <span className="font-semibold">{SEGMENT_LABELS[s.segment] || s.segment}</span> · {s.count} · {money(s.monetary)}
              </span>
            ))}
          </div>
          {rfm.atRisk.length === 0 ? (
            <Empty>Уходящих постоянных клиентов нет.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th className={th}>Клиент</th>
                  <th className={th}>Потратил всего</th>
                  <th className={th}>Визитов</th>
                  <th className={th}>Последний раз</th>
                </>
              }
            >
              {rfm.atRisk.map((c) => (
                <tr key={c.customer_id}>
                  <td className={`${td} font-medium`}>{c.name}</td>
                  <td className={td}>{money(c.monetary)}</td>
                  <td className={td}>{c.frequency}</td>
                  <td className={`${td} text-amber-600 dark:text-amber-400`}>{lastVisit(c)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
      <HowCalculated>
        <p>Каждому клиенту — три оценки от 1 до 5 относительно остальных клиентов: как давно была последняя покупка, сколько визитов, сколько потратил.</p>
        <p>
          «Уходят» — давно не был (оценка 1–2), но по визитам и деньгам в верхней половине. «Ушли» — давно не был и тратил мало.
          «Лучшие» — недавно, часто и много. «Новые» — были недавно, но пока редко.
        </p>
        <p>Учитываются только клиенты, которых пробивают на кассе. Сообщение или бонус уходящему обычно дешевле, чем найти нового.</p>
      </HowCalculated>
    </Section>
  )
}

// ── Недостачи по ревизиям ───────────────────────────────────────────────────

function ShortagesCard({ data, periodText }: { data: BusinessIntelligenceResult; periodText: string }) {
  const { cashierRisk } = data
  const riskLabel = (pct: number, acts: number) => {
    if (acts < 3) return { text: 'мало ревизий', cls: 'text-muted-foreground' }
    if (pct >= 50) return { text: 'часто', cls: 'font-medium text-rose-600 dark:text-rose-400' }
    if (pct >= 30) return { text: 'иногда', cls: 'text-amber-600 dark:text-amber-400' }
    return { text: 'редко', cls: 'text-emerald-600 dark:text-emerald-400' }
  }
  return (
    <Section
      id="shortages"
      icon={<ClipboardList className="h-4 w-4 text-rose-500" />}
      title="Недостачи по ревизиям"
      subtitle="У кого при пересчёте товара не хватает — и насколько это систематично."
      link={{ href: '/store/revisions', label: 'Ревизии' }}
    >
      {!cashierRisk.available ? (
        <Empty>
          {cashierRisk.note ? `${cashierRisk.note[0].toUpperCase()}${cashierRisk.note.slice(1)}.` : 'Нет данных.'} Проведите ревизию с назначением
          сотрудников — тогда появится разбор.
        </Empty>
      ) : (
        <Table
          head={
            <>
              <th className={th}>Сотрудник</th>
              <th className={th}>Ревизий</th>
              <th className={th}>С недостачей</th>
              <th className={th}>Сумма недостач</th>
              <th className={th}>Как часто</th>
            </>
          }
        >
          {cashierRisk.rows.map((r) => {
            const risk = riskLabel(r.posteriorPct, r.totalEvents)
            return (
              <tr key={r.operatorId}>
                <td className={`${td} font-medium`}>{r.cashier}</td>
                <td className={td}>{r.totalEvents}</td>
                <td className={td}>
                  {r.shortfallEvents}
                  {r.shortagePositions ? <span className="text-xs text-muted-foreground"> · {r.shortagePositions} поз.</span> : null}
                </td>
                <td className={`${td} ${r.shortageAmount > 0 ? 'font-semibold' : 'text-muted-foreground'}`}>{money(r.shortageAmount)}</td>
                <td className={td}>
                  <span className={risk.cls}>{risk.text}</span>
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      <HowCalculated>
        <p>Берём закрытые ревизии{periodText ? ` за период ${periodText}` : ''}. Недостача позиции — сколько не хватило к моменту подсчёта: ожидалось на открытии плюс движения до подсчёта, минус посчитано. Продажи во время ревизии недостачей не считаются — так же, как при закрытии акта.</p>
        <p>Недостача относится к сотруднику, который считал позицию. Сумма — по закупочной цене из карточки товара.</p>
        <p>
          «Как часто» — доля ревизий с недостачей, сглаженная на малом числе ревизий: одна неудачная ревизия из одной не делает человека
          «вором». Меньше 3 ревизий — судить рано.
        </p>
      </HowCalculated>
    </Section>
  )
}
