/**
 * Единое фоновое оформление рабочих экранов кассы (эталон — экран «Смена»):
 * мягкий диагональный градиент + два ненавязчивых blur-акцента по углам.
 *
 * Использование:
 *   <div className={`relative flex h-screen flex-col overflow-hidden ${screenBgClass} ...`}>
 *     <ScreenBackdrop />
 *     ...контент (интерактивные блоки — с relative/z-10, как раньше)...
 *   </div>
 *
 * Акценты полупрозрачные (5–10%), поэтому безопасно рисуются поверх карточек —
 * тот же приём, что был на каждой странице по отдельности до унификации.
 */

const ACCENTS = {
  /** Смена, продажи, сканер, история, очередь — фирменный изумруд + синий */
  emerald: [
    'bg-emerald-500/5 dark:bg-emerald-500/10',
    'bg-blue-500/5 dark:bg-blue-500/10',
  ],
  /** Кабинет оператора — фиолетовый + изумруд (как было до унификации) */
  violet: [
    'bg-violet-500/5 dark:bg-violet-500/10',
    'bg-emerald-500/5 dark:bg-emerald-500/10',
  ],
  /** Возвраты — тёплый розовый + синий (как было до унификации) */
  rose: [
    'bg-rose-500/5 dark:bg-rose-500/10',
    'bg-blue-500/5 dark:bg-blue-500/10',
  ],
} as const

export type ScreenBackdropAccent = keyof typeof ACCENTS

/** Классы фона для корневого контейнера экрана (градиент как на «Смене»). */
export const screenBgClass =
  'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900'

export default function ScreenBackdrop({ accent = 'emerald' }: { accent?: ScreenBackdropAccent }) {
  const [top, bottom] = ACCENTS[accent]
  return (
    <>
      <div className={`pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full blur-3xl ${top}`} />
      <div className={`pointer-events-none absolute -bottom-40 -left-40 h-80 w-80 rounded-full blur-3xl ${bottom}`} />
    </>
  )
}
