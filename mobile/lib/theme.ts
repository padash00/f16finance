// Дизайн-токены приложения. Тёмная премиум-база + изумрудный бренд и aurora-акценты.
export const T = {
  // поверхности (от глубокой к светлой)
  bg: '#070809',
  bg2: '#0d1014',
  card: '#12161b',
  card2: '#181d23',
  cardGlass: 'rgba(24,29,35,0.72)',
  border: '#222831',
  borderSoft: '#191e25',

  // текст
  text: '#ffffff',
  textMut: '#9aa6b4',
  textDim: '#5c6675',

  // бренд / акценты (aurora)
  green: '#10b981',
  greenBright: '#3df0b6',
  greenSoft: '#0b3b2e',
  teal: '#14b8a6',
  cyan: '#22d3ee',
  violet: '#8b5cf6',
  red: '#fb7185',
  amber: '#fbbf24',
  blue: '#60a5fa',
}

// Шкала отступов (4-pt).
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 }
// Радиусы.
export const R = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 }

// Тень/«объём» карточки (iOS + Android).
export const shadow = {
  card: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  glow: (c: string) => ({ shadowColor: c, shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10 }),
} as const

export const money = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return Math.round(Number(v)).toLocaleString('ru-RU') + ' ₸'
}

// Зона — enum zone_type в БД, ровно 6 значений: pc, ps5, vr, ramen, cafe, other.
const ZONE_LABELS: Record<string, string> = {
  pc: 'ПК',
  ps5: 'PS5',
  vr: 'VR',
  ramen: 'Рамен',
  cafe: 'Кафе',
  other: 'Другое',
}
export const zoneLabel = (z?: string | null) => {
  const v = String(z ?? '').trim().toLowerCase()
  if (!v) return ''
  return ZONE_LABELS[v] ?? (v.length <= 3 ? v.toUpperCase() : v.charAt(0).toUpperCase() + v.slice(1))
}

export const moneyShort = (v: number | null | undefined) => {
  const n = Number(v || 0)
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + ' млн ₸'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + 'к ₸'
  return Math.round(n).toLocaleString('ru-RU') + ' ₸'
}
