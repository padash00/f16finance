import { type ReactNode } from 'react'
import { Text, View, type ViewStyle } from 'react-native'
import { T } from '@/lib/theme'

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 20, padding: 16 }, style]}>
      {children}
    </View>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, marginTop: 8 }}>
      <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>{children}</Text>
      {hint ? <Text style={{ color: T.textDim, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  )
}

export function Pill({ text, tone = 'mut' }: { text: string; tone?: 'good' | 'bad' | 'warn' | 'mut' }) {
  const map = {
    good: { bg: '#0b3b2e', fg: '#34d399' },
    bad: { bg: '#3b1212', fg: '#f87171' },
    warn: { bg: '#3a2e0b', fg: '#fbbf24' },
    mut: { bg: '#1f2329', fg: '#9ca3af' },
  }[tone]
  return (
    <View style={{ backgroundColor: map.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: map.fg, fontSize: 12, fontWeight: '800' }}>{text}</Text>
    </View>
  )
}

/** Мини-спарклайн из значений (бары). */
export function Sparkline({ values, peakColor = T.green }: { values: number[]; peakColor?: string }) {
  const max = Math.max(1, ...values)
  const peak = Math.max(...values)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 44 }}>
      {values.map((v, i) => {
        const h = Math.max(4, Math.round((v / max) * 44))
        return <View key={i} style={{ flex: 1, height: h, borderRadius: 4, backgroundColor: v === peak && v > 0 ? peakColor : '#2b3038' }} />
      })}
    </View>
  )
}
