"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { buildStyledSheet, createWorkbook, downloadWorkbook } from "@/lib/excel/styled-export"
import { FloatingAssistant } from "@/components/ai/floating-assistant"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  type AnalysisResult,
  type DataPoint,
  type RangePreset,
  type Granularity,
} from "@/lib/analysis/types"
import { FORECAST_DAYS, CONFIDENCE_FORMULA_RU, DATA_SOURCE_NOTE } from "@/lib/analysis/constants"
import {
  aggregateWeekly,
  buildAiCacheKey,
  clamp,
  dayNames,
  parseISODateSafe,
  safeMargin,
} from "@/lib/analysis/core-utils"
import { buildDataForAi } from "@/lib/analysis/ai-payload"
import { EMPTY_AI_RESPONSE } from "@/lib/ai-analysis"
import type { PageSnapshot } from "@/lib/ai/types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { useCapabilities } from "@/lib/client/use-capabilities"
import type { CompanyOption } from "@/lib/analysis/types"
import {
  BrainCircuit,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  Sparkles,
  Info,
  HelpCircle,
  Search,
  History,
  Loader2,
  RefreshCw,
  Download,
  SlidersHorizontal,
  PieChart,
  Target,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Zap,
  MinusIcon,
} from "lucide-react"
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartTooltip,
  ReferenceLine,
  ComposedChart,
  Line,
  Bar,
  BarChart,
  Area,
  PieChart as RePieChart,
  Pie,
  Cell,
} from "recharts"

const AI_STORAGE = "orda.ai-analysis.cache.v4"

const formatMoney = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₸"

const formatDateRu = (dateStr: string) =>
  parseISODateSafe(dateStr).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })

function AnomalyDot(props: any) {
  const { cx, cy, payload } = props
  if (!payload?._anomaly || payload.type !== "fact") return null
  const color =
    payload._anomaly === "income_high" ? "#22c55e" : payload._anomaly === "income_low" ? "#ef4444" : "#f59e0b"
  return <circle cx={cx} cy={cy} r={4.5} fill={color} stroke="#111" strokeWidth={2} />
}

type ServerBundle = {
  history: DataPoint[]
  expenseCategories: Record<string, number>
  plansWarning: string | null
  dataSourceNote: string
  analysis: {
    excludeZeroDays: AnalysisResult | null
    includeZeroDays: AnalysisResult | null
  } | null
  range: { from: string; to: string }
}

export default function AIAnalysisPage() {
  const [bundle, setBundle] = useState<ServerBundle | null>(null)
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyId, setCompanyId] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)

  const [plansEnabled, setPlansEnabled] = useState(true)
  const [includeZeroDays, setIncludeZeroDays] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [rangePreset, setRangePreset] = useState<RangePreset>("365")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")
  const [granularity, setGranularity] = useState<Granularity>("daily")

  const [aiAdvice, setAiAdvice] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiUpdatedAt, setAiUpdatedAt] = useState<string | null>(null)

  const aliveRef = useRef(true)
  const lastAiCacheKeyRef = useRef<string | null>(null)
  const aiRequestKeyRef = useRef<string | null>(null)
  const { can } = useCapabilities()

  const loadCompanies = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/companies", { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (response.ok && Array.isArray(body?.data)) {
        setCompanies(body.data as CompanyOption[])
      }
    } catch {
      setCompanies([])
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setErrorText(null)
    const params = new URLSearchParams()
    params.set("range", rangePreset)
    if (customStart) params.set("from", customStart)
    if (customEnd) params.set("to", customEnd)
    if (companyId !== "all") params.set("company_id", companyId)
    if (!plansEnabled) params.set("plans", "0")
    try {
      const res = await fetch(`/api/admin/analysis?${params}`, { cache: "no-store" })
      const body = (await res.json().catch(() => null)) as ServerBundle & { error?: string }
      if (!aliveRef.current) return
      if (!res.ok) throw new Error(body?.error || "Ошибка загрузки аналитики")
      setBundle(body)
    } catch (e: any) {
      if (!aliveRef.current) return
      setBundle(null)
      setErrorText(e?.message || "Ошибка загрузки")
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [rangePreset, customStart, customEnd, companyId, plansEnabled])

  useEffect(() => {
    loadCompanies()
  }, [loadCompanies])

  useEffect(() => {
    aliveRef.current = true
    loadData()
    return () => {
      aliveRef.current = false
    }
  }, [loadData])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => loadData(), 60_000)
    return () => clearInterval(id)
  }, [autoRefresh, loadData])

  const analysis = useMemo(() => {
    if (!bundle?.analysis) return null
    return includeZeroDays ? bundle.analysis.includeZeroDays : bundle.analysis.excludeZeroDays
  }, [bundle, includeZeroDays])

  const history = useMemo(() => bundle?.history ?? [], [bundle])

  const topExpenseCats = useMemo(() => {
    if (!bundle) return []
    const entries = Object.entries(bundle.expenseCategories)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v > 0)
    const top = entries.slice(0, 7)
    const rest = entries.slice(7).reduce((s, [, v]) => s + v, 0)
    if (rest > 0) top.push(["Другое", rest])
    return top.map(([name, value]) => ({ name, value }))
  }, [bundle])

  const dataForAi = useMemo(() => {
    if (!analysis || !bundle) return null
    return buildDataForAi(analysis, history, bundle.expenseCategories)
  }, [analysis, history, bundle])

  const fetchAiAdvice = useCallback(
    async (allowSession: boolean) => {
      if (!dataForAi || !analysis || !bundle) {
        setAiAdvice(null)
        setAiError(null)
        setAiUpdatedAt(null)
        lastAiCacheKeyRef.current = null
        aiRequestKeyRef.current = null
        return
      }

      const k = buildAiCacheKey({
        from: bundle.range.from,
        to: bundle.range.to,
        companyId,
        includeZero: includeZeroDays,
        dataForAi: {
          dataRangeStart: dataForAi.dataRangeStart,
          dataRangeEnd: dataForAi.dataRangeEnd,
          totalIncome: dataForAi.totalIncome,
          totalExpense: dataForAi.totalExpense,
          confidenceScore: dataForAi.confidenceScore,
          riskLevel: dataForAi.riskLevel,
          planIncomeAchievementPct: dataForAi.planIncomeAchievementPct,
        },
      })

      if (k === lastAiCacheKeyRef.current) return
      if (aiRequestKeyRef.current === k) return

      if (allowSession) {
        try {
          const raw = window.sessionStorage.getItem(AI_STORAGE)
          if (raw) {
            const parsed = JSON.parse(raw) as { key: string; text: string; timestamp: string } | null
            if (parsed?.key === k) {
              const age = Date.now() - new Date(parsed.timestamp).getTime()
              if (age < 3 * 60 * 60 * 1000 && parsed.text && parsed.text !== EMPTY_AI_RESPONSE) {
                lastAiCacheKeyRef.current = k
                setAiAdvice(parsed.text)
                setAiError(null)
                setAiUpdatedAt(parsed.timestamp)
                return
              }
            }
          }
        } catch {
          /* */
        }
      }

      let cancelled = false
      aiRequestKeyRef.current = k
      setAiLoading(true)
      setAiError(null)
      try {
        const response = await fetch("/api/analysis/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(dataForAi),
        })
        const result = (await response.json().catch(() => null)) as { text?: string; error?: string } | null
        const text =
          typeof result?.text === "string" ? result.text : result?.error || "Не удалось получить AI-разбор."
        if (!response.ok) throw new Error(text)
        if (cancelled) return
        const now = new Date().toISOString()
        setAiAdvice(text)
        setAiUpdatedAt(now)
        const isFailed = text.toLowerCase().startsWith("ошибка") || text === EMPTY_AI_RESPONSE
        if (isFailed) {
          lastAiCacheKeyRef.current = null
          setAiError(text)
        } else {
          lastAiCacheKeyRef.current = k
          try {
            window.sessionStorage.setItem(
              AI_STORAGE,
              JSON.stringify({ key: k, text, timestamp: now }),
            )
          } catch {
            /* */
          }
        }
      } catch (e) {
        if (!cancelled) {
          lastAiCacheKeyRef.current = null
          setAiAdvice(null)
          setAiError(e instanceof Error ? e.message : "AI недоступен")
        }
      } finally {
        if (aiRequestKeyRef.current === k) aiRequestKeyRef.current = null
        if (!cancelled) setAiLoading(false)
      }
    },
    [dataForAi, analysis, bundle, companyId, includeZeroDays],
  )

  useEffect(() => {
    if (!dataForAi) {
      setAiAdvice(null)
      setAiError(null)
      setAiUpdatedAt(null)
      lastAiCacheKeyRef.current = null
      aiRequestKeyRef.current = null
      return
    }
    fetchAiAdvice(true)
  }, [dataForAi, fetchAiAdvice])

  const handleManualRefreshAi = () => {
    try {
      window.sessionStorage.removeItem(AI_STORAGE)
    } catch {
      /* */
    }
    lastAiCacheKeyRef.current = null
    aiRequestKeyRef.current = null
    fetchAiAdvice(false)
  }

  const smartInsights = useMemo(() => {
    if (!analysis) return null
    const warnings: string[] = []
    if (analysis.avgMargin < 18) warnings.push("Маржа низкая — проверьте расходы и ценообразование")
    if (analysis.profitVolatility > analysis.avgIncome * 0.6)
      warnings.push("Высокая волатильность прибыли — диверсифицируйте источники дохода")
    if (analysis.confidenceScore < 45) warnings.push("Недостаточно данных для точного прогноза")
    if (analysis.onlineShare < 10) warnings.push("Низкая доля онлайн-оплат — потенциал роста")
    if (analysis.riskLevel === "high") warnings.push("Высокий финансовый риск — срочно оптимизируйте расходы")
    return { warnings, tips: analysis.recommendedActions }
  }, [analysis])

  const chartViewData = useMemo(() => {
    if (!analysis) return []
    const base = analysis.chartData.map((d) => ({
      ...d,
      profit: d.profit ?? d.income - d.expense,
      margin: d.margin ?? safeMargin(d.profit ?? d.income - d.expense, d.income),
      planned_income: d.planned_income || 0,
      planned_expense: d.planned_expense || 0,
    }))
    return granularity === "weekly" ? aggregateWeekly(base) : base
  }, [analysis, granularity])

  const assistantSnapshot = useMemo<PageSnapshot | null>(() => {
    if (!analysis || !dataForAi) return null
    return {
      page: "analysis",
      title: "Срез данных для AI-разбора",
      generatedAt: new Date().toISOString(),
      route: "/analysis",
      period: {
        from: dataForAi.dataRangeStart,
        to: dataForAi.dataRangeEnd,
        label: `${dataForAi.dataRangeStart} -> ${dataForAi.dataRangeEnd}`,
      },
      summary: [
        `Доход ${formatMoney(dataForAi.totalIncome)}`,
        `Расход ${formatMoney(dataForAi.totalExpense)}`,
        `Прибыль ${formatMoney(dataForAi.totalIncome - dataForAi.totalExpense)}`,
        `Риск ${dataForAi.riskLevel}`,
      ],
      sections: [
        {
          title: "Ключевые метрики",
          metrics: [
            { label: "Общий доход", value: formatMoney(dataForAi.totalIncome) },
            { label: "Общий расход", value: formatMoney(dataForAi.totalExpense) },
            { label: "Средняя маржа", value: `${dataForAi.avgMargin}%` },
            { label: "Риск", value: dataForAi.riskLevel },
            { label: "Выполнение плана", value: `${dataForAi.planIncomeAchievementPct}%` },
          ],
        },
        {
          title: "Месяцы и прогноз",
          metrics: [
            { label: "Текущий месяц доход", value: formatMoney(dataForAi.currentMonth.income) },
            { label: "Текущий месяц прибыль", value: formatMoney(dataForAi.currentMonth.profit) },
            { label: "Прогноз дохода", value: formatMoney(dataForAi.predictedIncome) },
            { label: "Прогноз прибыли", value: formatMoney(dataForAi.predictedProfit) },
            { label: "Следующий месяц доход", value: formatMoney(dataForAi.nextMonthForecast.income) },
          ],
        },
        {
          title: "Структура денег и рисков",
          metrics: [
            { label: "Наличные", value: formatMoney(dataForAi.totalCash) },
            { label: "Kaspi", value: formatMoney(dataForAi.totalKaspi) },
            { label: "Card", value: formatMoney(dataForAi.totalCard) },
            { label: "Online", value: formatMoney(dataForAi.totalOnline) },
            {
              label: "Топ-расходы",
              value: topExpenseCats
                .slice(0, 3)
                .map((item) => `${item.name} ${formatMoney(item.value)}`)
                .join(" | ") || "Нет данных",
            },
            {
              label: "Сигналы",
              value:
                smartInsights?.warnings.slice(0, 2).join(" | ") ||
                analysis.anomalies.slice(0, 2).map((a) => `${a.date}: ${a.type}`).join(" | ") ||
                "Сигналы в норме",
            },
          ],
        },
      ],
    }
  }, [analysis, dataForAi, smartInsights, topExpenseCats])

  const longPeriodHint = (analysis?.totalDataPoints ?? 0) > 220

  const handleExport = async () => {
    if (!analysis) return
    const wb = createWorkbook()
    const period = `${analysis.dataRangeStart} — ${analysis.dataRangeEnd}`
    const dataRows = analysis.chartData.map((d) => ({
      date: d.date,
      type: d.type ?? "fact",
      income: Math.round(d.income),
      expense: Math.round(d.expense),
      profit: Math.round(d.profit ?? d.income - d.expense),
      income_cash: Math.round(d.incomeCash),
      income_kaspi: Math.round(d.incomeKaspi),
      income_card: Math.round(d.incomeCard),
      income_online: Math.round(d.incomeOnline),
      planned_income: Math.round(d.planned_income || 0),
      planned_expense: Math.round(d.planned_expense || 0),
      margin_pct: Number((d.margin ?? safeMargin(d.profit ?? d.income - d.expense, d.income)).toFixed(2)),
    }))
    buildStyledSheet(
      wb,
      "Аналитика",
      "AI-разбор",
      `Период: ${period} | Строк: ${dataRows.length}`,
      [
        { header: "Дата", key: "date", width: 12, type: "text" },
        { header: "Тип", key: "type", width: 10, type: "text" },
        { header: "Доход", key: "income", width: 16, type: "money" },
        { header: "Расход", key: "expense", width: 16, type: "money" },
        { header: "Прибыль", key: "profit", width: 16, type: "money" },
        { header: "Нал", key: "income_cash", width: 14, type: "money" },
        { header: "Kaspi", key: "income_kaspi", width: 14, type: "money" },
        { header: "Card", key: "income_card", width: 14, type: "money" },
        { header: "Online", key: "income_online", width: 14, type: "money" },
        { header: "План доход", key: "planned_income", width: 16, type: "money" },
        { header: "План расход", key: "planned_expense", width: 16, type: "money" },
        { header: "Маржа %", key: "margin_pct", width: 12, type: "percent" },
      ],
      dataRows,
    )
    await downloadWorkbook(wb, `ai-analysis-${analysis.dataRangeStart}_to_${analysis.dataRangeEnd}.xlsx`)
  }

  const dataSource = bundle?.dataSourceNote || DATA_SOURCE_NOTE
  const plansWarning = bundle?.plansWarning

  return (
    <>
      <div className="app-page-wide space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900/80 via-gray-900 to-indigo-950/40 p-6 border border-indigo-500/15">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full blur-3xl opacity-10 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-slate-600 rounded-full blur-3xl opacity-10 pointer-events-none" />

          <div className="relative z-10 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-500/20 rounded-xl">
                <BrainCircuit className="w-8 h-8 text-indigo-300" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">AI Разбор</h1>
                <p className="text-gray-400 text-sm mt-1">
                  Финансы точки: факт, план, прогноз и аномалии (данные с сервера)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {can('analysis.refresh') && (
                <Button
                  onClick={() => loadData()}
                  disabled={loading}
                  variant="outline"
                  className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                  Обновить данные
                </Button>
              )}

              {can('analysis.export') && (
                <Button
                  onClick={handleExport}
                  disabled={!analysis}
                  variant="outline"
                  className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Excel
                </Button>
              )}

              <div className="flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-200/90">
                {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI-разбор
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-indigo-200 hover:text-white"
                  onClick={handleManualRefreshAi}
                  disabled={!dataForAi || aiLoading}
                >
                  Обновить
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
          <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">{dataSource}</p>
          <div className="flex flex-col lg:flex-row gap-4 lg:items-end lg:justify-between">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <SlidersHorizontal className="w-4 h-4" />
                Период
              </div>

              <Select value={rangePreset} onValueChange={(v) => setRangePreset(v as RangePreset)}>
                <SelectTrigger className="w-[160px] bg-gray-900 border-gray-700 text-gray-300">
                  <SelectValue placeholder="Период" />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  <SelectItem value="30">30 дней</SelectItem>
                  <SelectItem value="90">90 дней</SelectItem>
                  <SelectItem value="180">180 дней</SelectItem>
                  <SelectItem value="365">365 дней</SelectItem>
                  <SelectItem value="all">С начала (2+ года)</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">С</div>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-[160px] bg-gray-900 border-gray-700 text-gray-300"
                />
                <div className="text-xs text-gray-500">по</div>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-[160px] bg-gray-900 border-gray-700 text-gray-300"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">Компания</div>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="w-[220px] bg-gray-900 border-gray-700 text-gray-300">
                    <SelectValue placeholder="Компания" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="all">Все</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">Ось графика</div>
                <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
                  <SelectTrigger className="w-[140px] bg-gray-900 border-gray-700 text-gray-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="daily">По дням</SelectItem>
                    <SelectItem value="weekly">По неделям</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-6 items-center">
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">В статистике «нули»</div>
                <Switch checked={includeZeroDays} onCheckedChange={setIncludeZeroDays} />
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">Автообновление 1м</div>
                <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">План</div>
                <Switch checked={plansEnabled} onCheckedChange={setPlansEnabled} />
              </div>
            </div>
          </div>

          {longPeriodHint && (
            <div className="mt-3 p-2 rounded-lg border border-indigo-500/15 bg-indigo-500/5 text-indigo-100/90 text-xs flex flex-wrap items-center gap-2">
              <span>Долгий ряд: удобнее смотреть ось графика «по неделям».</span>
              {granularity === "daily" && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  onClick={() => setGranularity("weekly")}
                >
                  Показать по неделям
                </Button>
              )}
            </div>
          )}

          {plansWarning && (
            <div className="mt-3 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 text-yellow-200 text-xs">
              <AlertTriangle className="w-4 h-4 inline mr-2" />
              {plansWarning}
            </div>
          )}

          {analysis && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <div className="px-2 py-1 rounded-lg border border-gray-700 bg-gray-900/50 text-gray-400">
                <History className="w-3 h-3 inline mr-1" />
                {formatDateRu(analysis.dataRangeStart)} — {formatDateRu(analysis.dataRangeEnd)}
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="px-2 py-1 rounded-lg border border-gray-700 bg-gray-900/50 text-gray-400 cursor-help inline-flex items-center gap-1">
                      Достоверность:{" "}
                      <span className="text-indigo-300 font-bold">{analysis.confidenceScore}%</span>
                      <Info className="w-3 h-3 text-gray-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs bg-gray-900 border border-gray-700 p-2">
                    {CONFIDENCE_FORMULA_RU}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div
                className={`px-2 py-1 rounded-lg border w-fit ${
                  analysis.trendIncome > 0
                    ? "text-green-400 bg-green-500/10 border-green-500/20"
                    : "text-red-400 bg-red-500/10 border-red-500/20"
                }`}
              >
                {analysis.trendIncome >= 0 ? (
                  <TrendingUp className="w-3 h-3 inline mr-1" />
                ) : (
                  <TrendingDown className="w-3 h-3 inline mr-1" />
                )}
                Тренд: {analysis.trendIncome >= 0 ? "+" : ""}
                {analysis.trendIncome.toFixed(0)} ₸/день
              </div>
              <div
                className={`px-2 py-1 rounded-lg border w-fit ${
                  analysis.riskLevel === "low"
                    ? "text-green-400 bg-green-500/10 border-green-500/20"
                    : analysis.riskLevel === "medium"
                      ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
                      : "text-red-400 bg-red-500/10 border-red-500/20"
                }`}
              >
                Риск: {analysis.riskLevel === "low" ? "Низкий" : analysis.riskLevel === "medium" ? "Средний" : "Высокий"}
              </div>
              {analysis.totalPlanIncome > 0 && (
                <div className="px-2 py-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
                  <Target className="w-3 h-3 inline mr-1" />
                  План: {analysis.planIncomeAchievementPct.toFixed(0)}%
                </div>
              )}
            </div>
          )}
        </Card>

        {analysis && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Доход (период)", v: formatMoney(analysis.totalIncome) },
              { label: "Расход (период)", v: formatMoney(analysis.totalExpense) },
              { label: "Прибыль (период)", v: formatMoney(analysis.totalIncome - analysis.totalExpense) },
              { label: `Прогноз прибыль (${FORECAST_DAYS}д)`, v: formatMoney(analysis.totalForecastProfit) },
            ].map((row) => (
              <Card
                key={row.label}
                className="p-4 border border-gray-800 bg-gray-900/40"
              >
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{row.label}</div>
                <div className="text-lg font-semibold text-white tabular-nums">{row.v}</div>
              </Card>
            ))}
          </div>
        )}

        {(aiLoading || aiAdvice || aiError) && (
          <Card className="p-6 border-0 bg-gradient-to-br from-indigo-900/20 via-gray-900 to-slate-900/40 backdrop-blur-sm border border-indigo-500/10">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-indigo-500/20 rounded-xl shrink-0">
                <Sparkles className="w-6 h-6 text-indigo-300" />
              </div>
              <div className="space-y-2 w-full">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <h3 className="font-bold text-white text-lg">AI-разбор (управленческий текст)</h3>
                  {aiUpdatedAt ? (
                    <div className="text-xs text-gray-500">
                      {new Date(aiUpdatedAt).toLocaleString("ru-RU")}
                    </div>
                  ) : null}
                </div>
                {aiLoading ? (
                  <div className="flex items-center gap-3 text-sm text-gray-300">
                    <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
                    Сбор текста…
                  </div>
                ) : aiError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {aiError}
                  </div>
                ) : (
                  <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{aiAdvice}</div>
                )}
              </div>
            </div>
          </Card>
        )}

        <FloatingAssistant
          page="analysis"
          title="AI Разбор"
          snapshot={assistantSnapshot}
          suggestedPrompts={[
            "Где главная зона риска?",
            "3 управленческих действия",
            "Что похоже на системную проблему?",
          ]}
        />

        {/* Скелетон только при первой загрузке. Refetch — silent, старая аналитика остаётся. */}
        {loading && !analysis && (
          <div className="space-y-6">
            <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="mt-2 h-4 w-72" />
              <Skeleton className="mt-6 h-80 w-full" />
            </Card>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm lg:col-span-2">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="mt-4 h-64 w-full" />
              </Card>
              <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                <Skeleton className="h-5 w-40" />
                <div className="mt-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-10 w-full" />
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}

        {errorText && !loading && (
          <Card className="p-4 border-0 bg-red-500/10 text-red-300 text-sm">
            <AlertTriangle className="w-5 h-5 inline mr-2" />
            {errorText}
          </Card>
        )}

        {analysis && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-gray-300">Основной график</h2>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm h-full">
                    <div className="mb-6 flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div>
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                          <CalendarDays className="w-5 h-5 text-indigo-300" />
                          Факт + прогноз {FORECAST_DAYS} дн.
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">
                          Прогн. прибыль:{" "}
                          <span className="text-green-400 font-bold">{formatMoney(analysis.totalForecastProfit)}</span>{" "}
                          · Прогн. доход:{" "}
                          <span className="text-indigo-300 font-bold">
                            {formatMoney(analysis.totalForecastIncome)}
                          </span>
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                          Аномалии: зел. выше нормы · крас. ниже · оранж. расход
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase text-gray-500 tracking-wider">достоверность</span>
                        <div className="flex items-center gap-2 justify-end">
                          <div className="h-2 w-24 bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-indigo-500 to-slate-400"
                              style={{ width: `${analysis.confidenceScore}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold text-indigo-200">{analysis.confidenceScore}%</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 max-w-[200px] ml-auto opacity-80">
                          Оценка полноты ряда, не гарантия
                        </p>
                      </div>
                    </div>
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={chartViewData}
                          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                          <XAxis
                            dataKey="date"
                            stroke="#6b7280"
                            fontSize={10}
                            tickFormatter={(val) => {
                              const d = parseISODateSafe(val as string)
                              return `${dayNames[d.getDay()]} ${d.getDate()}`
                            }}
                            interval="preserveStartEnd"
                            minTickGap={22}
                          />
                          <YAxis
                            stroke="#6b7280"
                            fontSize={10}
                            tickFormatter={(v) => `${Math.round((v as number) / 1000)}k`}
                          />
                          <RechartTooltip
                            contentStyle={{
                              backgroundColor: "#1f2937",
                              border: "1px solid #374151",
                              borderRadius: "8px",
                              color: "#fff",
                            }}
                            formatter={(val: any, name: any, props: any) => {
                              const label =
                                name === "income"
                                  ? "Доход"
                                  : name === "planned_income"
                                    ? "План дохода"
                                    : name === "expense"
                                      ? "Расход"
                                      : name === "profit"
                                        ? "Прибыль"
                                        : name
                              return [
                                formatMoney(val as number),
                                `${label} (${props?.payload?.type === "forecast" ? "прогноз" : "факт"})`,
                              ]
                            }}
                            labelFormatter={(label: any) => {
                              const d = parseISODateSafe(label)
                              return formatDateRu(label) + ` (${dayNames[d.getDay()]})`
                            }}
                          />
                          <ReferenceLine
                            x={analysis.lastFactDate}
                            stroke="#6b7280"
                            strokeDasharray="3 3"
                          />
                          <Area
                            type="monotone"
                            dataKey="income"
                            name="income"
                            stroke="#818cf8"
                            strokeWidth={3}
                            fill="url(#incomeGradient)"
                            dot={<AnomalyDot />}
                          />
                          <Line
                            type="monotone"
                            dataKey="planned_income"
                            name="planned_income"
                            stroke="#38bdf8"
                            strokeWidth={2}
                            strokeDasharray="6 6"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="expense"
                            name="expense"
                            stroke="#ef4444"
                            strokeWidth={2}
                            dot={false}
                            strokeOpacity={0.6}
                          />
                          <Line
                            type="monotone"
                            dataKey="profit"
                            name="profit"
                            stroke="#22c55e"
                            strokeWidth={2}
                            dot={false}
                            strokeOpacity={0.6}
                          />
                          {granularity === "daily" && (
                            <>
                              <Line
                                type="monotone"
                                dataKey="income_p10"
                                name="income_p10"
                                stroke="#6366f1"
                                strokeOpacity={0.15}
                                dot={false}
                                strokeDasharray="4 6"
                              />
                              <Line
                                type="monotone"
                                dataKey="income_p90"
                                name="income_p90"
                                stroke="#6366f1"
                                strokeOpacity={0.15}
                                dot={false}
                                strokeDasharray="4 6"
                              />
                            </>
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </div>
                <div className="space-y-6">
                  <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                    <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-indigo-300" />
                      Оплаты
                    </h3>
                    <div className="h-48 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <RePieChart>
                          <Pie
                            data={analysis.paymentTrends}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="total"
                          >
                            {analysis.paymentTrends.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartTooltip
                            formatter={(val: number, _n: string, props: any) => [
                              formatMoney(val),
                              props.payload.method === "cash"
                                ? "Нал"
                                : props.payload.method === "kaspi"
                                  ? "Kaspi"
                                  : props.payload.method === "card"
                                    ? "Карта"
                                    : "Онлайн",
                            ]}
                            contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                          />
                        </RePieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {analysis.paymentTrends.map((trend) => (
                        <div
                          key={trend.method}
                          className="flex items-center justify-between p-2 rounded-lg bg-gray-900/50"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: trend.color }} />
                            <span className="text-xs text-gray-400">
                              {trend.method === "cash"
                                ? "Нал"
                                : trend.method === "kaspi"
                                  ? "Kaspi"
                                  : trend.method === "card"
                                    ? "Карта"
                                    : "Онлайн"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-white font-medium">{trend.percentage.toFixed(1)}%</span>
                            {trend.trend === "up" ? (
                              <TrendingUp className="w-3 h-3 text-green-400" />
                            ) : trend.trend === "down" ? (
                              <TrendingDown className="w-3 h-3 text-red-400" />
                            ) : (
                              <MinusIcon className="w-3 h-3 text-gray-500" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-700">
                      <div className="flex justify-between text-xs mb-2">
                        <span className="text-gray-500">Онлайн</span>
                        <span className={analysis.onlineShare < 15 ? "text-yellow-400" : "text-green-400"}>
                          {analysis.onlineShare.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Безнал</span>
                        <span className="text-indigo-200">{analysis.cashlessShare.toFixed(1)}%</span>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-6 border-0 bg-gradient-to-br from-slate-900/40 to-indigo-900/20 backdrop-blur-sm border border-indigo-500/10">
                    <h3 className="text-sm font-bold text-white mb-1">Сезонность / рост</h3>
                    <p className="text-[10px] text-gray-500 mb-3">по дням недели и краям ряда</p>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-400">Сезонность</span>
                          <span className="text-indigo-200">{analysis.seasonalityStrength.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500"
                            style={{ width: `${analysis.seasonalityStrength}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-400">Рост (груб.)</span>
                          <span className={analysis.growthRate >= 0 ? "text-green-400" : "text-red-400"}>
                            {analysis.growthRate >= 0 ? "+" : ""}
                            {analysis.growthRate.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${analysis.growthRate >= 0 ? "bg-green-500" : "bg-red-500"}`}
                            style={{ width: `${clamp(Math.abs(analysis.growthRate), 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </div>

            <h2 className="text-sm font-medium text-gray-300 pt-2">Недельный и расходы</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-indigo-300" />
                    Типичная неделя
                  </h3>
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analysis.dayAverages.map((d) => ({
                        name: dayNames[d.dow],
                        income: d.income,
                        expense: d.expense,
                        profit: d.income - d.expense,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                      <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
                      <RechartTooltip
                        contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                        formatter={(val: any, name: any) => [
                          formatMoney(val as number),
                          name === "income" ? "Доход" : name === "expense" ? "Расход" : "Прибыль",
                        ]}
                      />
                      <Bar dataKey="income" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="profit" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-indigo-300" />
                  Категории расходов
                </h3>
                {topExpenseCats.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Info className="w-12 h-12 mx-auto mb-2 opacity-20" />
                    Нет расходов
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {topExpenseCats.map((c, idx) => (
                      <div
                        key={c.name}
                        className="flex items-center justify-between p-3 rounded-xl bg-gray-900/50 border border-gray-800"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-lg bg-gray-800 flex items-center justify-center text-xs text-gray-500">
                            {idx + 1}
                          </div>
                          <span className="text-sm text-gray-300">{c.name}</span>
                        </div>
                        <div className="text-sm text-red-400 font-semibold">{formatMoney(c.value)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <h2 className="text-sm font-medium text-gray-300 pt-2">Выводы</h2>
            <p className="text-[11px] text-gray-500 -mt-2">
              Краткие эвристики; AI-блок — отдельный сгенерированный текст, не налоговая консультация.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="p-6 border-0 bg-slate-900/30 border border-slate-700/40">
                <h3 className="text-sm font-bold text-indigo-200 mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Сигналы
                </h3>
                {smartInsights && (
                  <div className="space-y-3 text-xs">
                    {smartInsights.warnings.length > 0 && (
                      <div className="p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 text-yellow-200">
                        <div className="font-semibold mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Внимание
                        </div>
                        <ul className="space-y-1">
                          {smartInsights.warnings.map((w, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-yellow-500">•</span>
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="p-3 rounded-xl border border-gray-700 bg-gray-900/50">
                      <div className="font-semibold text-white mb-2 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                        Эвристики
                      </div>
                      <ul className="space-y-2">
                        {smartInsights.tips.map((t, i) => (
                          <li key={i} className="flex items-start gap-2 text-gray-400">
                            <span className="text-indigo-300 mt-0.5">·</span>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </Card>
              <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                  <Search className="w-4 h-4 text-amber-300" />
                  Аномалии
                </h3>
                <p className="text-[10px] text-gray-500 mb-3">топ сигналов за последние 90 дней</p>
                {analysis.anomalies.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="w-12 h-12 text-green-500/50 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Нет выбранных всплесков</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {analysis.anomalies.map((a, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-gray-900/50 border border-gray-800">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-gray-300">{formatDateRu(a.date)}</span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              a.type === "income_low"
                                ? "bg-red-500/20 text-red-400"
                                : a.type === "expense_high"
                                  ? "bg-orange-500/20 text-orange-400"
                                  : "bg-green-500/20 text-green-400"
                            }`}
                          >
                            {a.type === "income_low" ? "↓ Доход" : a.type === "expense_high" ? "↑ Расход" : "↑ Доход"}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {formatMoney(a.amount)} (норма: {formatMoney(a.avgForDay)})
                        </p>
                        {a.paymentMethod && (
                          <p className="text-xs text-gray-600 mt-1">
                            Канал:{" "}
                            {a.paymentMethod === "cash"
                              ? "нал"
                              : a.paymentMethod === "kaspi"
                                ? "Kaspi"
                                : a.paymentMethod === "card"
                                  ? "карта"
                                  : "онлайн"}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Как считаем
                </h3>
                <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
                  <div className="p-3 rounded-lg bg-gray-900/50 border-l-2 border-indigo-500">
                    <span className="text-indigo-300 font-semibold">1. Статистика</span>
                    <p className="mt-1">Медиана и MAD, робаст к выбросам</p>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-900/50 border-l-2 border-slate-500">
                    <span className="text-slate-300 font-semibold">2. Тренд</span>
                    <p className="mt-1">Winsorize + наклон по дням</p>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-900/50 border-l-2 border-emerald-600/80">
                    <span className="text-emerald-300 font-semibold">3. AI</span>
                    <p className="mt-1">По сжатому срезу в OpenAI</p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {!loading && !analysis && (
          <div className="text-center py-20">
            <Info className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <p className="text-gray-400">Нет данных</p>
            <p className="text-sm text-gray-600 mt-2">Проверьте период и наличие операций</p>
          </div>
        )}
      </div>
    </>
  )
}
