export const T = {
  bg: '#0B0C0A',
  card: '#15171a',
  card2: '#1b1e22',
  border: '#23262b',
  text: '#ffffff',
  textMut: '#9ca3af',
  textDim: '#6b7280',
  green: '#10b981',
  greenSoft: '#064e3b',
  red: '#f87171',
  amber: '#fbbf24',
  blue: '#60a5fa',
}

export const money = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return Math.round(Number(v)).toLocaleString('ru-RU') + ' ₸'
}

export const moneyShort = (v: number | null | undefined) => {
  const n = Number(v || 0)
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + ' млн ₸'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + 'к ₸'
  return Math.round(n).toLocaleString('ru-RU') + ' ₸'
}
