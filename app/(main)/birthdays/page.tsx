'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CalendarRange, CakeSlice, Gift, Loader2, Sparkles, Users2 } from 'lucide-react'

import { Card } from '@/components/ui/card'

type BirthdayItem = {
  id: string
  name: string
  short_name: string | null
  position: string | null
  photo_url: string | null
  birth_date: string
  company_name: string | null
  company_code: string | null
  assignment_count: number
  month: number
  day: number
  age: number | null
  nextBirthday: string
  daysUntil: number
}

type BirthdayResponse = {
  ok: boolean
  data?: {
    items: BirthdayItem[]
    stats: {
      total: number
      today: number
      week: number
      month: number
      withoutBirthDate: number
    }
  }
  error?: string
}

function formatBirthdayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
}

function formatUpcomingLabel(daysUntil: number) {
  if (daysUntil === 0) return 'Сегодня'
  if (daysUntil === 1) return 'Завтра'
  if (daysUntil < 5) return `Через ${daysUntil} дня`
  return `Через ${daysUntil} дней`
}

function getUpcomingTone(daysUntil: number) {
  if (daysUntil === 0) return 'border-amber-400/30 bg-amber-500/10 text-amber-200'
  if (daysUntil <= 7) return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
  return 'border-white/10 bg-white/[0.04] text-slate-200'
}

function getZodiacSign(value: string) {
  const date = new Date(`${value}T12:00:00`)
  const month = date.getMonth() + 1
  const day = date.getDate()

  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return { name: 'Овен', emoji: '♈', joke: 'Если сегодня спорить с ним, лучше спорить осторожно.' }
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return { name: 'Телец', emoji: '♉', joke: 'Праздник любит красиво, вкусно и без суеты.' }
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return { name: 'Близнецы', emoji: '♊', joke: 'Скорее всего уже рассказал всем, когда у него день рождения.' }
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return { name: 'Рак', emoji: '♋', joke: 'Поздравление лучше тёплое, а не формальное.' }
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return { name: 'Лев', emoji: '♌', joke: 'Можно поздравлять ярко, он это точно оценит.' }
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return { name: 'Дева', emoji: '♍', joke: 'С высокой вероятностью заметит, если забыть про торт.' }
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return { name: 'Весы', emoji: '♎', joke: 'Главное, чтобы подарок был со вкусом и без хаоса.' }
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return { name: 'Скорпион', emoji: '♏', joke: 'Лучше поздравить вовремя. Очень вовремя.' }
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return { name: 'Стрелец', emoji: '♐', joke: 'Есть шанс, что праздник быстро превратится в приключение.' }
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return { name: 'Козерог', emoji: '♑', joke: 'Даже день рождения может отметить по плану.' }
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return { name: 'Водолей', emoji: '♒', joke: 'Может внезапно придумать свой формат поздравления.' }
  return { name: 'Рыбы', emoji: '♓', joke: 'Поздравление лучше с душой, иначе магия не засчитается.' }
}

export default function BirthdaysPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<BirthdayItem[]>([])
  const [stats, setStats] = useState({
    total: 0,
    today: 0,
    week: 0,
    month: 0,
    withoutBirthDate: 0,
  })

  useEffect(() => {
    let ignore = false

    const loadBirthdays = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch('/api/admin/birthdays', { cache: 'no-store' }).catch(() => null)
        const json = (await response?.json().catch(() => null)) as BirthdayResponse | null

        if (ignore) return

        if (!response?.ok || !json?.ok || !json.data) {
          setError(json?.error || 'Не удалось загрузить дни рождения')
          return
        }

        setItems(json.data.items || [])
        setStats(json.data.stats)
      } catch (loadError: any) {
        if (!ignore) setError(loadError?.message || 'Не удалось загрузить дни рождения')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadBirthdays()
    return () => {
      ignore = true
    }
  }, [])

  const todayItems = useMemo(() => items.filter((item) => item.daysUntil === 0), [items])
  const weekItems = useMemo(() => items.filter((item) => item.daysUntil >= 0 && item.daysUntil <= 7), [items])
  const monthItems = useMemo(() => items.filter((item) => item.daysUntil >= 0 && item.daysUntil <= 30), [items])

  return (
    <>
        <div className="app-page space-y-6">
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_34%),linear-gradient(135deg,rgba(20,12,28,0.98),rgba(7,12,24,0.96))] p-6 text-white sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex rounded-2xl bg-amber-400/10 p-4">
                  <CakeSlice className="h-7 w-7 text-amber-300" />
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">Дни рождения команды</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  Ближайшие дни рождения операторов по точкам. Здесь сразу видно, у кого праздник сегодня, на этой неделе и в ближайший месяц.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/20 px-5 py-4 text-sm text-slate-300">
                Сейчас учитываются даты рождения только операторов. Для staff можно расширить экран после добавления поля в их профиль.
              </div>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Сегодня', value: stats.today, icon: Gift },
              { label: 'На 7 дней', value: stats.week, icon: CalendarDays },
              { label: 'На 30 дней', value: stats.month, icon: CalendarRange },
              { label: 'Без даты рождения', value: stats.withoutBirthDate, icon: Users2 },
            ].map((stat) => {
              const Icon = stat.icon
              return (
                <Card key={stat.label} className="border-white/10 bg-slate-950/65 p-5 text-white">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-slate-400">{stat.label}</p>
                      <p className="mt-2 text-3xl font-semibold">{stat.value}</p>
                    </div>
                    <div className="rounded-2xl bg-white/6 p-3">
                      <Icon className="h-5 w-5 text-amber-300" />
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>

          {loading ? (
            <Card className="border-white/10 bg-slate-950/65 p-8 text-white">
              <div className="flex items-center gap-3 text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin text-amber-300" />
                Загружаем ближайшие дни рождения...
              </div>
            </Card>
          ) : error ? (
            <Card className="border-rose-500/20 bg-rose-500/10 p-6 text-rose-100">{error}</Card>
          ) : (
            <>
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-white">
                  <Gift className="h-5 w-5 text-amber-300" />
                  <h2 className="text-xl font-semibold">Сегодня и на этой неделе</h2>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="border-white/10 bg-slate-950/60 p-5 text-white">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-amber-300" />
                      <h3 className="text-lg font-semibold">Сегодня</h3>
                    </div>
                    <div className="mt-4 space-y-3">
                      {todayItems.length > 0 ? todayItems.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                          {(() => {
                            const zodiac = getZodiacSign(item.birth_date)
                            return (
                              <>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-base font-semibold text-white">{item.name}</div>
                              <div className="mt-1 text-sm text-amber-100/80">
                                {item.company_name || 'Точка не назначена'}{item.position ? ` • ${item.position}` : ''}
                              </div>
                              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-black/20 px-2.5 py-1 text-xs text-amber-100">
                                <span>{zodiac.emoji}</span>
                                <span>{zodiac.name}</span>
                              </div>
                            </div>
                            <span className="rounded-full border border-amber-400/30 bg-amber-400/15 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
                              сегодня
                            </span>
                          </div>
                          <div className="mt-3 text-sm text-slate-200">
                            {formatBirthdayDate(item.birth_date)}{item.age ? ` • ${item.age} лет` : ''}
                          </div>
                          <div className="mt-2 text-xs text-amber-100/75">{zodiac.joke}</div>
                              </>
                            )
                          })()}
                        </div>
                      )) : (
                        <div className="text-sm text-slate-500">Сегодня дней рождения нет.</div>
                      )}
                    </div>
                  </Card>

                  <Card className="border-white/10 bg-slate-950/60 p-5 text-white">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-5 w-5 text-emerald-300" />
                      <h3 className="text-lg font-semibold">Ближайшие 7 дней</h3>
                    </div>
                    <div className="mt-4 space-y-3">
                      {weekItems.length > 0 ? weekItems.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                          {(() => {
                            const zodiac = getZodiacSign(item.birth_date)
                            return (
                              <>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-base font-semibold text-white">{item.name}</div>
                              <div className="mt-1 text-sm text-slate-400">
                                {item.company_name || 'Точка не назначена'}{item.position ? ` • ${item.position}` : ''}
                              </div>
                              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-200">
                                <span>{zodiac.emoji}</span>
                                <span>{zodiac.name}</span>
                              </div>
                            </div>
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-200">
                              {formatUpcomingLabel(item.daysUntil)}
                            </span>
                          </div>
                          <div className="mt-3 text-sm text-slate-200">
                            {formatBirthdayDate(item.birth_date)}{item.age ? ` • исполнится ${item.age}` : ''}
                          </div>
                          <div className="mt-2 text-xs text-slate-400">{zodiac.joke}</div>
                              </>
                            )
                          })()}
                        </div>
                      )) : (
                        <div className="text-sm text-slate-500">На ближайшую неделю дней рождения нет.</div>
                      )}
                    </div>
                  </Card>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2 text-white">
                  <CalendarRange className="h-5 w-5 text-cyan-300" />
                  <h2 className="text-xl font-semibold">Ближайшие 30 дней</h2>
                </div>

                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                  {monthItems.length > 0 ? monthItems.map((item) => (
                    <Card key={`month-${item.id}`} className="border-white/10 bg-slate-950/60 p-4 text-white">
                      {(() => {
                        const zodiac = getZodiacSign(item.birth_date)
                        return (
                          <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-white">{item.name}</div>
                          <div className="mt-1 text-sm text-slate-400">
                            {item.company_name || 'Точка не назначена'}{item.assignment_count > 1 ? ` • ${item.assignment_count} точки` : ''}
                          </div>
                          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-200">
                            <span>{zodiac.emoji}</span>
                            <span>{zodiac.name}</span>
                          </div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${getUpcomingTone(item.daysUntil)}`}>
                          {formatUpcomingLabel(item.daysUntil)}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Дата</div>
                          <div className="mt-1 text-sm text-slate-200">{formatBirthdayDate(item.birth_date)}</div>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Возраст</div>
                          <div className="mt-1 text-sm text-slate-200">{item.age ? `${item.age} лет` : 'Не указан'}</div>
                        </div>
                      </div>
                      <div className="mt-3 text-xs text-slate-400">{zodiac.joke}</div>
                          </>
                        )
                      })()}
                    </Card>
                  )) : (
                    <Card className="border-white/10 bg-slate-950/60 p-5 text-sm text-slate-500">
                      В ближайшие 30 дней дней рождения не найдено.
                    </Card>
                  )}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2 text-white">
                  <CalendarDays className="h-5 w-5 text-amber-300" />
                  <h2 className="text-xl font-semibold">Все ближайшие дни рождения по порядку</h2>
                </div>

                <Card className="border-white/10 bg-slate-950/60 p-0 text-white overflow-hidden">
                  {items.length > 0 ? (
                    <div className="divide-y divide-white/6">
                      {items.map((item, index) => (
                        <div
                          key={`sorted-${item.id}`}
                          className="flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03] lg:flex-row lg:items-center lg:justify-between"
                        >
                          {(() => {
                            const zodiac = getZodiacSign(item.birth_date)
                            return (
                              <>
                          <div className="flex items-start gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-semibold text-slate-200">
                              {index + 1}
                            </div>

                            <div>
                              <div className="text-base font-semibold text-white">{item.name}</div>
                              <div className="mt-1 text-sm text-slate-400">
                                {item.company_name || 'Точка не назначена'}
                                {item.position ? ` • ${item.position}` : ''}
                                {item.assignment_count > 1 ? ` • ${item.assignment_count} точки` : ''}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-200">
                                  <span>{zodiac.emoji}</span>
                                  <span>{zodiac.name}</span>
                                </span>
                                <span className="text-xs text-slate-500">{zodiac.joke}</span>
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[520px]">
                            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Когда</div>
                              <div className="mt-1 text-sm text-slate-200">{formatBirthdayDate(item.birth_date)}</div>
                            </div>
                            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Скоро</div>
                              <div className="mt-1 text-sm text-slate-200">{formatUpcomingLabel(item.daysUntil)}</div>
                            </div>
                            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Возраст</div>
                              <div className="mt-1 text-sm text-slate-200">{item.age ? `${item.age} лет` : 'Не указан'}</div>
                            </div>
                          </div>
                              </>
                            )
                          })()}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-5 text-sm text-slate-500">Дни рождения пока не найдены.</div>
                  )}
                </Card>
              </section>
            </>
          )}
        </div>
    </>
  )
}
