// lib/kpiTeams.ts

export type TeamCode = 'wk' | 'we'

export const TEAM_LABEL: Record<TeamCode, string> = {
  wk: 'Команда A (Пн–Чт)',
  we: 'Команда B (Пт–Вс)',
}

/**
 * dateStr ожидаем в формате "YYYY-MM-DD"
 * Важно: добавляем "T00:00:00", чтобы не было UTC-сдвигов
 */
export function teamFromDate(dateStr: string): TeamCode {
  const s = String(dateStr || '').slice(0, 10)
  const d = new Date(`${s}T00:00:00`)
  const dow = d.getDay() // 0=Вс, 1=Пн ... 6=Сб
  return dow >= 1 && dow <= 4 ? 'wk' : 'we'
}

export function monthKeyFromDateStr(dateStr: string) {
  return String(dateStr || '').slice(0, 7) // "YYYY-MM"
}
