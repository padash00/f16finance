/**
 * Каталог достижений операторов.
 * Используется на странице /operator-achievements.
 *
 * Достижения вычисляются client-side из агрегированных данных продаж/смен.
 * Без отдельных таблиц в БД — это прозрачные правила на основе цифр.
 */

export type AchievementIcon = 'crown' | 'trophy' | 'medal' | 'sparkles' | 'award' | 'flame' | 'star'
export type AchievementColor = 'amber' | 'orange' | 'emerald' | 'sky' | 'fuchsia' | 'violet' | 'rose'

export type OperatorAchievementRow = {
  operatorId: string
  operatorName: string
  operatorShortName: string | null
  photo_url: string | null
  totalTurnover: number
  shifts: number
  avgPerShift: number
  share: number
}

export type AchievementContext = {
  rows: OperatorAchievementRow[]
  rank: number          // 1-based место по выручке
  avgTurnover: number   // средняя выручка по всем
  avgPerShift: number   // средний avg per shift по всем (для тех у кого shifts>0)
}

export type AchievementDef = {
  id: string
  title: string
  desc: string
  icon: AchievementIcon
  color: AchievementColor
  /** Получил ли оператор это достижение */
  check: (row: OperatorAchievementRow, ctx: AchievementContext) => boolean
  /**
   * Прогресс достижения в формате "X / Y".
   * Возвращает null если прогресс неприменим (например, ранговые достижения).
   */
  progress?: (row: OperatorAchievementRow, ctx: AchievementContext) => { current: number; target: number; unit: string } | null
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'champion',
    title: 'Чемпион',
    desc: '1-е место по выручке за период',
    icon: 'crown',
    color: 'amber',
    check: (_, ctx) => ctx.rank === 1,
  },
  {
    id: 'top3',
    title: 'Призёр',
    desc: 'Вошёл в топ-3 по выручке',
    icon: 'trophy',
    color: 'orange',
    check: (_, ctx) => ctx.rank > 1 && ctx.rank <= 3,
  },
  {
    id: 'millionaire',
    title: 'Миллионер',
    desc: 'Выручка превысила 1 000 000 ₸',
    icon: 'sparkles',
    color: 'emerald',
    check: (r) => r.totalTurnover >= 1_000_000,
    progress: (r) => ({ current: Math.min(r.totalTurnover, 1_000_000), target: 1_000_000, unit: '₸' }),
  },
  {
    id: 'mega',
    title: 'Мега-миллионер',
    desc: 'Выручка превысила 5 000 000 ₸',
    icon: 'star',
    color: 'rose',
    check: (r) => r.totalTurnover >= 5_000_000,
    progress: (r) => ({ current: Math.min(r.totalTurnover, 5_000_000), target: 5_000_000, unit: '₸' }),
  },
  {
    id: 'marathoner',
    title: 'Марафонец',
    desc: 'Отработал 20+ смен за период',
    icon: 'medal',
    color: 'sky',
    check: (r) => r.shifts >= 20,
    progress: (r) => ({ current: Math.min(r.shifts, 20), target: 20, unit: 'см' }),
  },
  {
    id: 'iron',
    title: 'Железный',
    desc: 'Отработал 50+ смен за период',
    icon: 'flame',
    color: 'rose',
    check: (r) => r.shifts >= 50,
    progress: (r) => ({ current: Math.min(r.shifts, 50), target: 50, unit: 'см' }),
  },
  {
    id: 'premium',
    title: 'Премиум-кассир',
    desc: 'Средний чек выше среднего на 30%+',
    icon: 'award',
    color: 'fuchsia',
    check: (r, ctx) => r.shifts >= 5 && ctx.avgPerShift > 0 && r.avgPerShift > ctx.avgPerShift * 1.3,
  },
  {
    id: 'major',
    title: 'Тяжеловес',
    desc: 'Доля выручки больше 20%',
    icon: 'trophy',
    color: 'violet',
    check: (r) => r.share >= 20,
    progress: (r) => ({ current: Math.min(r.share, 20), target: 20, unit: '%' }),
  },
]

export const COLOR_MAP: Record<AchievementColor, { bg: string; bgSoft: string; text: string; border: string }> = {
  amber: { bg: 'bg-amber-500/15', bgSoft: 'bg-amber-500/5', text: 'text-amber-300', border: 'border-amber-500/30' },
  orange: { bg: 'bg-orange-500/15', bgSoft: 'bg-orange-500/5', text: 'text-orange-300', border: 'border-orange-500/30' },
  emerald: { bg: 'bg-emerald-500/15', bgSoft: 'bg-emerald-500/5', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  sky: { bg: 'bg-sky-500/15', bgSoft: 'bg-sky-500/5', text: 'text-sky-300', border: 'border-sky-500/30' },
  fuchsia: { bg: 'bg-fuchsia-500/15', bgSoft: 'bg-fuchsia-500/5', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30' },
  violet: { bg: 'bg-violet-500/15', bgSoft: 'bg-violet-500/5', text: 'text-violet-300', border: 'border-violet-500/30' },
  rose: { bg: 'bg-rose-500/15', bgSoft: 'bg-rose-500/5', text: 'text-rose-300', border: 'border-rose-500/30' },
}

/**
 * Для каждого оператора посчитать какие достижения он получил.
 * Возвращает массив с rank и списком полученных + не полученных.
 */
export function computeAllAchievements(rows: OperatorAchievementRow[]) {
  const sortedByTurnover = [...rows].sort((a, b) => b.totalTurnover - a.totalTurnover)
  const avgTurnover = rows.length ? rows.reduce((s, r) => s + r.totalTurnover, 0) / rows.length : 0
  const filteredForAvg = rows.filter((r) => r.shifts > 0)
  const avgPerShift = filteredForAvg.length
    ? filteredForAvg.reduce((s, r) => s + r.avgPerShift, 0) / filteredForAvg.length
    : 0

  return sortedByTurnover.map((row, i) => {
    const ctx: AchievementContext = { rows, rank: i + 1, avgTurnover, avgPerShift }
    const earned: AchievementDef[] = []
    const locked: AchievementDef[] = []
    for (const ach of ACHIEVEMENTS) {
      if (ach.check(row, ctx)) earned.push(ach)
      else locked.push(ach)
    }
    return { row, rank: i + 1, ctx, earned, locked }
  })
}
