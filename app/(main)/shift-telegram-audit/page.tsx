'use client'

import { ChangeEvent, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileUp, RefreshCw, Search, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Company = { id: string; name: string | null; code: string | null }
type Operator = { id: string; name: string | null; short_name: string | null; is_active?: boolean | null }
type Income = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
  created_at?: string | null
}
type AuditLog = {
  id: string
  entity_type: string
  entity_id: string
  action: string
  payload: any
  created_at: string
  actor_user_id: string | null
}
type ApiData = { incomes: Income[]; companies: Company[]; operators: Operator[]; auditLogs: AuditLog[] }
type TgReport = {
  id: string
  messageAt: string | null
  date: string
  shift: 'day' | 'night' | null
  companyText: string | null
  pointText: string | null
  operatorText: string | null
  cash: number
  kaspi: number
  online: number
  coins: number
  tech: number
  startCash: number
  systemDeduction: number
  result: number | null
  raw: string
}
type MatchRow = {
  report: TgReport
  income: Income | null
  score: number
  status: 'ok' | 'diff' | 'missing' | 'weak'
  cashDiff: number | null
  kaspiDiff: number | null
  changes: AuditLog[]
}

const money = (value: number | null | undefined) =>
  Math.round(Number(value || 0)).toLocaleString('ru-RU') + ' ₸'

const todayISO = () => {
  const d = new Date()
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

function normalizeText(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
}

function parseMoney(value: string | null | undefined) {
  const raw = String(value || '').replace(/\u00a0/g, ' ')
  const negative = /(^|\s)-/.test(raw) || raw.includes('−')
  const digits = raw.replace(/[^\d]/g, '')
  const amount = Number(digits || 0)
  return negative ? -amount : amount
}

function parseDateFromText(value: string) {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})/)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

function parseTelegramDateTitle(value: string | null | undefined) {
  const date = parseDateFromText(String(value || ''))
  return date
}

function getLineAmount(text: string, labels: string[]) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const normalized = normalizeText(line)
    if (!labels.some((label) => normalized.includes(normalizeText(label)))) continue
    return parseMoney(line)
  }
  return 0
}

function detectShift(text: string): 'day' | 'night' | null {
  const n = normalizeText(text)
  if (n.includes('ночь') || n.includes('night')) return 'night'
  if (n.includes('день') || n.includes('day')) return 'day'
  const hour = Number((text.match(/Отчет по смене \(\d{2}\.\d{2}\.\d{4} (\d{2}):\d{2}\)/)?.[1]) || NaN)
  if (Number.isFinite(hour)) return hour >= 12 && hour < 23 ? 'day' : 'night'
  return null
}

function parseTelegramHtml(html: string): TgReport[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const messages = Array.from(doc.querySelectorAll('.message.default'))
  const reports: TgReport[] = []

  for (const message of messages) {
    const textEl = message.querySelector('.text')
    if (!textEl) continue
    const text = (textEl as HTMLElement).innerText.replace(/\r/g, '').trim()
    if (!text.includes('Смена закрыта') && !text.includes('Отчет по смене')) continue
    if (!/(Kaspi|Kaspi POS|Наличные)/i.test(text)) continue

    const dateTitle = message.querySelector('.date')?.getAttribute('title') || null
    const messageAt = parseTelegramDateTitle(dateTitle)
    const reportDate = parseDateFromText(text) || messageAt
    if (!reportDate) continue

    const operator =
      text.match(/Оператор:\s*([^\n]+)/i)?.[1]?.trim() ||
      text.match(/👤\s*([^\n·]+)\s*·/)?.[1]?.trim() ||
      null
    const companyLine = text.split('\n').find((line) => line.includes('🏷')) || null
    const companyText = companyLine
      ? companyLine.replace('🏷', '').split('·')[0]?.trim() || null
      : null
    const pointText = companyLine?.split('·')[1]?.trim() || null

    reports.push({
      id: message.getAttribute('id') || `${reportDate}-${reports.length}`,
      messageAt,
      date: reportDate,
      shift: detectShift(text),
      companyText,
      pointText,
      operatorText: operator,
      cash: getLineAmount(text, ['Наличные']),
      kaspi: getLineAmount(text, ['Kaspi POS', 'Kaspi']),
      online: getLineAmount(text, ['Kaspi Online', 'Online']),
      coins: getLineAmount(text, ['Мелочь']),
      tech: getLineAmount(text, ['Тех / прочее', 'Долги']),
      startCash: getLineAmount(text, ['Старт кассы', 'Касса на начало']),
      systemDeduction: getLineAmount(text, ['Вычет', 'Senet']),
      result: getLineAmount(text, ['ИТОГ', 'Результат']),
      raw: text,
    })
  }

  return reports
}

function companyLabel(company?: Company) {
  return company?.name || company?.code || '—'
}

function operatorLabel(operator?: Operator) {
  return operator?.short_name || operator?.name || '—'
}

function incomeKaspi(income: Income) {
  return Number(income.kaspi_amount || 0)
}

function scoreIncome(report: TgReport, income: Income, companies: Company[], operators: Operator[]) {
  let score = 0
  if (income.date === report.date) score += 40
  if (report.shift && income.shift === report.shift) score += 15

  const company = companies.find((item) => item.id === income.company_id)
  const companyHaystack = normalizeText([company?.name, company?.code].filter(Boolean).join(' '))
  const companyNeedle = normalizeText([report.companyText, report.pointText].filter(Boolean).join(' '))
  if (companyNeedle && companyHaystack && (companyHaystack.includes(companyNeedle) || companyNeedle.includes(companyHaystack))) score += 20

  const operator = operators.find((item) => item.id === income.operator_id)
  const opHaystack = normalizeText([operator?.name, operator?.short_name].filter(Boolean).join(' '))
  const opNeedle = normalizeText(report.operatorText)
  if (opNeedle && opHaystack && (opHaystack.includes(opNeedle) || opNeedle.includes(opHaystack))) score += 15

  const cashDiff = Math.abs(Number(income.cash_amount || 0) - report.cash)
  const kaspiDiff = Math.abs(incomeKaspi(income) - report.kaspi)
  if (cashDiff === 0) score += 20
  else if (cashDiff <= 1000) score += 8
  if (kaspiDiff === 0) score += 20
  else if (kaspiDiff <= 1000) score += 8

  return score
}

function buildMatches(reports: TgReport[], data: ApiData | null): MatchRow[] {
  if (!data) return reports.map((report) => ({ report, income: null, score: 0, status: 'missing', cashDiff: null, kaspiDiff: null, changes: [] }))
  const usedIncomeIds = new Set<string>()
  return reports.map((report) => {
    const candidates = data.incomes
      .filter((income) => income.date === report.date && !usedIncomeIds.has(income.id))
      .map((income) => ({ income, score: scoreIncome(report, income, data.companies, data.operators) }))
      .sort((a, b) => b.score - a.score)

    const best = candidates[0]
    if (!best || best.score < 45) {
      return { report, income: null, score: best?.score || 0, status: 'missing', cashDiff: null, kaspiDiff: null, changes: [] }
    }

    usedIncomeIds.add(best.income.id)
    const cashDiff = Number(best.income.cash_amount || 0) - report.cash
    const kaspiDiff = incomeKaspi(best.income) - report.kaspi
    const changes = data.auditLogs.filter((log) => log.entity_type === 'income' && log.entity_id === best.income.id && log.action.startsWith('update'))
    const status = cashDiff === 0 && kaspiDiff === 0 ? 'ok' : best.score < 70 ? 'weak' : 'diff'
    return { report, income: best.income, score: best.score, status, cashDiff, kaspiDiff, changes }
  })
}

export default function ShiftTelegramAuditPage() {
  const [from, setFrom] = useState('2025-11-01')
  const [to, setTo] = useState(todayISO())
  const [companyId, setCompanyId] = useState('all')
  const [data, setData] = useState<ApiData | null>(null)
  const [reports, setReports] = useState<TgReport[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to })
      if (companyId !== 'all') params.set('company_id', companyId)
      const response = await fetch(`/api/admin/shift-telegram-audit?${params.toString()}`, { cache: 'no-store' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось загрузить данные')
      setData(json)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const html = await file.text()
      const parsed = parseTelegramHtml(html).filter((report) => report.date >= from && report.date <= to)
      setReports(parsed)
    } catch (e: any) {
      setError(e?.message || 'Не удалось прочитать HTML export')
    }
  }

  const matches = useMemo(() => buildMatches(reports, data), [reports, data])
  const filteredMatches = useMemo(() => {
    const needle = normalizeText(query)
    if (!needle) return matches
    return matches.filter((row) => normalizeText([row.report.companyText, row.report.pointText, row.report.operatorText, row.report.date, row.status].join(' ')).includes(needle))
  }, [matches, query])
  const summary = useMemo(() => ({
    total: matches.length,
    ok: matches.filter((row) => row.status === 'ok').length,
    diff: matches.filter((row) => row.status === 'diff' || row.status === 'weak').length,
    missing: matches.filter((row) => row.status === 'missing').length,
    changed: matches.filter((row) => row.changes.length > 0).length,
  }), [matches])

  const companies = data?.companies || []
  const operators = data?.operators || []

  return (
    <div className="app-page space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">Сверка Telegram и доходов</h1>
        <p className="mt-1 text-sm text-slate-400">Файл Telegram читается только в браузере. В БД ничего не сохраняется.</p>
      </div>

      <Card className="space-y-4 border-white/10 bg-slate-950/80 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="space-y-1 text-xs text-slate-400">С
            <input className="h-10 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-slate-400">По
            <input className="h-10 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-slate-400">Точка
            <select className="h-10 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="all">Все точки</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{companyLabel(company)}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="button" className="w-full" onClick={loadData} disabled={loading}>
              {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              Загрузить сайт
            </Button>
          </div>
          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 self-end rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 text-sm text-cyan-100 hover:bg-cyan-500/20">
            <FileUp className="h-4 w-4" />
            Telegram HTML
            <input className="hidden" type="file" accept=".html,text/html" onChange={handleFile} />
          </label>
        </div>
        {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
      </Card>

      <div className="grid gap-3 md:grid-cols-5">
        <Metric title="Telegram отчётов" value={summary.total} />
        <Metric title="Совпало" value={summary.ok} tone="ok" />
        <Metric title="Расхождения" value={summary.diff} tone="warn" />
        <Metric title="Нет дохода" value={summary.missing} tone="bad" />
        <Metric title="Меняли на сайте" value={summary.changed} tone="warn" />
      </div>

      <Card className="border-white/10 bg-slate-950/80 p-4">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900 px-3 py-2">
          <Search className="h-4 w-4 text-slate-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по точке, оператору, дате, статусу" className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500" />
        </div>
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3">Статус</th>
                <th className="py-2 pr-3">Дата</th>
                <th className="py-2 pr-3">Точка / оператор</th>
                <th className="py-2 pr-3">Telegram нал</th>
                <th className="py-2 pr-3">Сайт нал</th>
                <th className="py-2 pr-3">Разница</th>
                <th className="py-2 pr-3">Telegram Kaspi</th>
                <th className="py-2 pr-3">Сайт Kaspi</th>
                <th className="py-2 pr-3">Разница</th>
                <th className="py-2 pr-3">Изменения</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.map((row) => {
                const company = companies.find((item) => item.id === row.income?.company_id)
                const operator = operators.find((item) => item.id === row.income?.operator_id)
                return (
                  <tr key={row.report.id} className="border-b border-white/5 align-top text-slate-200">
                    <td className="py-3 pr-3"><StatusBadge status={row.status} /></td>
                    <td className="py-3 pr-3">
                      <div className="font-medium">{row.report.date}</div>
                      <div className="text-xs text-slate-500">{row.report.shift === 'night' ? 'Ночь' : row.report.shift === 'day' ? 'День' : 'смена ?'}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <div>{row.report.companyText || row.report.pointText || companyLabel(company)}</div>
                      <div className="text-xs text-slate-500">{row.report.operatorText || operatorLabel(operator)}</div>
                      {row.score ? <div className="text-[11px] text-slate-600">match {row.score}</div> : null}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">{money(row.report.cash)}</td>
                    <td className="py-3 pr-3 tabular-nums">{row.income ? money(row.income.cash_amount) : '—'}</td>
                    <td className={`py-3 pr-3 tabular-nums ${row.cashDiff ? 'text-amber-300' : 'text-slate-500'}`}>{row.cashDiff == null ? '—' : money(row.cashDiff)}</td>
                    <td className="py-3 pr-3 tabular-nums">{money(row.report.kaspi)}</td>
                    <td className="py-3 pr-3 tabular-nums">{row.income ? money(incomeKaspi(row.income)) : '—'}</td>
                    <td className={`py-3 pr-3 tabular-nums ${row.kaspiDiff ? 'text-amber-300' : 'text-slate-500'}`}>{row.kaspiDiff == null ? '—' : money(row.kaspiDiff)}</td>
                    <td className="py-3 pr-3">
                      {row.changes.length ? (
                        <div className="space-y-1 text-xs text-amber-200">
                          {row.changes.slice(-3).map((change) => (
                            <div key={change.id}>{new Date(change.created_at).toLocaleString('ru-RU')} · {change.action}</div>
                          ))}
                        </div>
                      ) : <span className="text-xs text-slate-600">нет</span>}
                    </td>
                  </tr>
                )
              })}
              {filteredMatches.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">Загрузи данные сайта и HTML экспорт Telegram.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Metric({ title, value, tone }: { title: string; value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'ok' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-white'
  return (
    <Card className="border-white/10 bg-slate-950/80 p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
    </Card>
  )
}

function StatusBadge({ status }: { status: MatchRow['status'] }) {
  if (status === 'ok') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"><CheckCircle2 className="h-3 w-3" />ОК</span>
  }
  if (status === 'missing') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-xs text-red-300"><XCircle className="h-3 w-3" />нет дохода</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-300"><AlertTriangle className="h-3 w-3" />расхождение</span>
}
