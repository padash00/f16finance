'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, Database, FileEdit, Loader2, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageSkeleton } from '@/components/skeleton'
import { useCapabilities } from '@/lib/client/use-capabilities'

type Company = { id: string; name: string; code: string | null; industry: string | null }
type IndustryOption = { code: string; label: string; description: string }

type TopicArticle = { id: string; title: string; is_published: boolean; source: string | null }
type Topic = {
  key: string
  label: string
  hint: string
  factSource?: string
  severity?: string
  articles: TopicArticle[]
  published: number
  drafts: number
  factsAvailable: boolean
}
type InterviewQuestion = { key: string; question: string; hint?: string; topics: string[] }

export default function KnowledgeSetupPage() {
  const { can } = useCapabilities()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [companies, setCompanies] = useState<Company[]>([])
  const [industries, setIndustries] = useState<IndustryOption[]>([])
  const [companyId, setCompanyId] = useState('')
  const [company, setCompany] = useState<Company | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [interview, setInterview] = useState<InterviewQuestion[]>([])
  const [factsSummary, setFactsSummary] = useState<{ catalog: number; salary_rules: boolean; checklists: boolean } | null>(null)

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [showInterview, setShowInterview] = useState(false)

  const load = useCallback(async (targetCompanyId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const query = targetCompanyId ? `?company_id=${targetCompanyId}` : ''
      const res = await fetch(`/api/admin/knowledge/industry${query}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)

      setCompanies(body.data?.companies || [])
      setIndustries(body.data?.industries || [])
      setCompany(body.data?.company || null)
      setTopics(body.data?.topics || [])
      setInterview(body.data?.interview || [])
      setFactsSummary(body.data?.factsSummary || null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (companyId) load(companyId)
  }, [companyId, load])

  async function post(action: string, payload: Record<string, unknown>, key: string) {
    setBusy(key)
    try {
      const res = await fetch('/api/admin/knowledge/industry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, company_id: companyId, ...payload }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      await load(companyId)
      return body.data
    } catch (e: any) {
      alert(`Ошибка: ${e?.message || 'не удалось'}`)
      return null
    } finally {
      setBusy(null)
    }
  }

  const coverage = useMemo(() => {
    const total = topics.length
    const covered = topics.filter((t) => t.published > 0).length
    return { total, covered, pct: total > 0 ? Math.round((covered / total) * 100) : 0 }
  }, [topics])

  const canSetIndustry = can('knowledge-setup.set_industry')
  const canGenerate = can('knowledge-setup.generate')

  if (loading && companies.length === 0) return <PageSkeleton />

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Настройка базы знаний"
        description="Ниша точки задаёт каркас тем. Черновики регламентов собираются из данных системы или из ваших ответов — публикуете вы"
        icon={<Sparkles className="h-5 w-5" />}
        accent="violet"
        backHref="/knowledge-admin"
        actions={
          <Button variant="outline" size="sm" onClick={() => load(companyId)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        }
      />

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] p-4 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {/* Выбор точки */}
      <Card className="p-4">
        <div className="mb-2 text-xs text-muted-foreground">Точка</div>
        <div className="flex flex-wrap gap-2">
          {companies.map((item) => (
            <button
              key={item.id}
              onClick={() => setCompanyId(item.id)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                companyId === item.id
                  ? 'border-violet-400/60 bg-violet-500/15 text-violet-800 dark:text-violet-200'
                  : 'border-border bg-slate-100 text-body hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10'
              }`}
            >
              {item.name}
              {item.industry ? (
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {industries.find((i) => i.code === item.industry)?.label || item.industry}
                </span>
              ) : (
                <span className="ml-1.5 text-[10px] text-amber-500">ниша не задана</span>
              )}
            </button>
          ))}
        </div>
      </Card>

      {!companyId ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Выберите точку. Ниша задаётся отдельно для каждой — у клуба, PS-зоны и магазина разные регламенты, и экзамен по ним тоже разный.
        </Card>
      ) : (
        <>
          {/* Ниша */}
          <Card className="space-y-3 p-5">
            <div className="text-sm font-semibold text-foreground">Ниша точки «{company?.name}»</div>
            <div className="grid gap-2 md:grid-cols-3">
              {industries.map((industry) => {
                const active = company?.industry === industry.code
                return (
                  <button
                    key={industry.code}
                    disabled={!canSetIndustry || busy !== null}
                    onClick={() => post('set_industry', { industry: industry.code }, 'industry')}
                    className={`rounded-xl border p-3 text-left transition disabled:opacity-60 ${
                      active
                        ? 'border-violet-400/60 bg-violet-500/10'
                        : 'border-border bg-surface-muted hover:bg-slate-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <div className="text-sm font-medium text-foreground">{industry.label}</div>
                    <div className="text-[11px] text-muted-foreground">{industry.description}</div>
                  </button>
                )
              })}
            </div>
            {!company?.industry && (
              <div className="text-xs text-amber-600 dark:text-amber-300">
                Пока ниша не выбрана, каркас показывает только общие темы, а сбор через ИИ недоступен.
              </div>
            )}
          </Card>

          {/* Два способа наполнения */}
          {company?.industry && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="space-y-3 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Database className="h-4 w-4 text-emerald-500" />
                  Собрать из данных системы
                </div>
                <p className="text-xs text-muted-foreground">
                  Берёт настоящие цифры: каталог с ценами, правила оплаты смены, чек-листы. Ничего вводить не нужно, и цены не выдуманы.
                </p>
                <div className="space-y-1 text-[11px] text-body">
                  <div>
                    Каталог: {factsSummary?.catalog ? `${factsSummary.catalog} позиций с ценой` : <span className="text-amber-500">пусто</span>}
                  </div>
                  <div>Правила зарплаты: {factsSummary?.salary_rules ? 'есть' : <span className="text-amber-500">нет</span>}</div>
                  <div>Чек-листы: {factsSummary?.checklists ? 'есть' : <span className="text-amber-500">нет</span>}</div>
                </div>
                <Button
                  disabled={!canGenerate || busy !== null}
                  onClick={async () => {
                    const data = await post('generate_facts', {}, 'facts')
                    if (data) alert(`Создано черновиков: ${data.created}\n\n${(data.titles || []).join('\n')}`)
                  }}
                >
                  {busy === 'facts' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  Собрать черновики
                </Button>
              </Card>

              <Card className="space-y-3 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <MessageSquareText className="h-4 w-4 text-sky-500" />
                  Интервью про точку
                </div>
                <p className="text-xs text-muted-foreground">
                  {interview.length} вопросов о том, чего нет в данных: как общаться, что делать в конфликте, кто за что отвечает.
                  Отвечайте своими словами — ИИ оформит в регламент.
                </p>
                <Button variant="outline" disabled={!canGenerate} onClick={() => setShowInterview((v) => !v)}>
                  <MessageSquareText className="h-4 w-4" />
                  {showInterview ? 'Свернуть' : 'Пройти интервью'}
                </Button>
              </Card>
            </div>
          )}

          {showInterview && company?.industry && (
            <Card className="space-y-4 p-5">
              <div className="text-sm font-semibold text-foreground">Интервью — отвечайте только на то, что знаете</div>
              {interview.map((question) => (
                <label key={question.key} className="grid gap-1">
                  <span className="text-xs font-medium text-body">{question.question}</span>
                  {question.hint && <span className="text-[11px] text-muted-foreground">{question.hint}</span>}
                  <textarea
                    rows={2}
                    value={answers[question.key] || ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [question.key]: e.target.value }))}
                    className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground dark:bg-slate-950/50"
                  />
                </label>
              ))}
              <div className="flex items-center gap-2">
                <Button
                  disabled={busy !== null}
                  onClick={async () => {
                    const data = await post('generate_interview', { answers }, 'interview')
                    if (data) {
                      alert(`Создано черновиков: ${data.created}\n\n${(data.titles || []).join('\n')}`)
                      setShowInterview(false)
                    }
                  }}
                >
                  {busy === 'interview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Составить регламенты
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Пустые вопросы пропускаются — темы по ним останутся незакрытыми
                </span>
              </div>
            </Card>
          )}

          {/* Каркас тем */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="text-sm font-semibold text-foreground">Каркас регламентов</div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  закрыто <b className="text-foreground">{coverage.covered}</b> из {coverage.total}
                </span>
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className={`h-full transition-all ${coverage.pct >= 80 ? 'bg-emerald-500' : coverage.pct >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${coverage.pct}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="divide-y divide-border">
              {topics.map((topic) => {
                const done = topic.published > 0
                return (
                  <div key={topic.key} className="flex items-start gap-3 px-4 py-3">
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{topic.label}</span>
                        {topic.severity === 'critical' && (
                          <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-600 dark:text-rose-300">
                            критично
                          </span>
                        )}
                        {topic.factSource && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] ${
                              topic.factsAvailable
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                                : 'bg-slate-500/10 text-muted-foreground'
                            }`}
                          >
                            {topic.factsAvailable ? 'есть данные в системе' : 'данных в системе нет'}
                          </span>
                        )}
                        {topic.drafts > 0 && (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
                            {topic.drafts} черновик(а) — проверьте и опубликуйте
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{topic.hint}</div>
                      {topic.articles.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {topic.articles.map((article) => (
                            <Link
                              key={article.id}
                              href="/knowledge-admin"
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition hover:bg-slate-100 dark:hover:bg-white/5 ${
                                article.is_published
                                  ? 'border-emerald-400/40 text-emerald-700 dark:text-emerald-300'
                                  : 'border-amber-400/40 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              <FileEdit className="h-3 w-3" />
                              {article.title}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          <div className="rounded-2xl border border-sky-400/30 bg-sky-500/[0.06] p-4 text-xs text-sky-800 dark:text-sky-200">
            Черновики не участвуют в экзамене — вопросы собираются только по опубликованным регламентам. Проверьте текст на
            странице <Link href="/knowledge-admin" className="underline">База знаний</Link> и опубликуйте: ИИ мог упустить деталь,
            а экзамен спросит ровно то, что там написано.
          </div>
        </>
      )}
    </div>
  )
}
