// Дата в зоне Asia/Qyzylorda (UTC+5) как 'YYYY-MM-DD'. Продажи пишутся по локальному
// времени точки, поэтому "сегодня" нельзя брать из UTC toISOString().
export function localDayISO(now: Date = new Date(), timeZone = 'Asia/Qyzylorda'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}
