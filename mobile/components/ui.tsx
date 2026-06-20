import { type ReactNode } from 'react'
import { Pressable, Text, View, type ViewStyle } from 'react-native'
import { T, R, S, shadow } from '@/lib/theme'

/** Мягкое «свечение» — стопка полупрозрачных кругов (эмуляция blur без зависимостей). */
export function Glow({ color, size = 240, style }: { color: string; size?: number; style?: ViewStyle }) {
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color, opacity: 0.18 }} />
      <View style={{ position: 'absolute', left: size * 0.18, top: size * 0.18, width: size * 0.64, height: size * 0.64, borderRadius: size, backgroundColor: color, opacity: 0.22 }} />
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.xl, padding: S.lg }, shadow.card, style]}>
      {children}
    </View>
  )
}

/** Карточка-герой с цветным свечением за контентом (фирменный приём). */
export function GlowHero({ children, glow = T.green, style }: { children: ReactNode; glow?: string; style?: ViewStyle }) {
  return (
    <View style={[{ borderRadius: R.xl, overflow: 'hidden', borderWidth: 1, borderColor: '#20302b', backgroundColor: '#0c1411' }, shadow.glow(glow), style]}>
      <Glow color={glow} size={260} style={{ top: -120, right: -80 }} />
      <Glow color={T.cyan} size={180} style={{ bottom: -90, left: -50 }} />
      <View style={{ padding: S.xl }}>{children}</View>
    </View>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: S.md, marginTop: S.sm }}>
      <Text style={{ color: T.text, fontSize: 17, fontWeight: '800', letterSpacing: 0.2 }}>{children}</Text>
      {hint ? <Text style={{ color: T.textDim, fontSize: 12, fontWeight: '600' }}>{hint}</Text> : null}
    </View>
  )
}

export function Pill({ text, tone = 'mut' }: { text: string; tone?: 'good' | 'bad' | 'warn' | 'mut' | 'brand' }) {
  const map = {
    good: { bg: 'rgba(16,185,129,0.16)', fg: '#34f0b6', bd: 'rgba(16,185,129,0.32)' },
    bad: { bg: 'rgba(251,113,133,0.14)', fg: '#fb7185', bd: 'rgba(251,113,133,0.30)' },
    warn: { bg: 'rgba(251,191,36,0.14)', fg: '#fbbf24', bd: 'rgba(251,191,36,0.28)' },
    mut: { bg: 'rgba(255,255,255,0.05)', fg: T.textMut, bd: 'rgba(255,255,255,0.08)' },
    brand: { bg: 'rgba(34,211,238,0.14)', fg: '#22d3ee', bd: 'rgba(34,211,238,0.28)' },
  }[tone]
  return (
    <View style={{ backgroundColor: map.bg, borderColor: map.bd, borderWidth: 1, borderRadius: R.pill, paddingHorizontal: 11, paddingVertical: 4 }}>
      <Text style={{ color: map.fg, fontSize: 12, fontWeight: '800' }}>{text}</Text>
    </View>
  )
}

/** Сегмент-переключатель (период и т.п.). */
export function Segmented<T_ extends string>({ value, options, onChange }: { value: T_; options: { key: T_; label: string }[]; onChange: (k: T_) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.md, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const active = o.key === value
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={{ flex: 1, paddingVertical: 9, borderRadius: R.sm, alignItems: 'center', backgroundColor: active ? T.green : 'transparent' }}>
            <Text style={{ color: active ? '#04130d' : T.textMut, fontWeight: '800', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Плейсхолдер загрузки. */
export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: ViewStyle }) {
  return <View style={[{ height: h, width: w as any, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)' }, style]} />
}

/** Мини-спарклайн (бары) с подсветкой пика. */
export function Sparkline({ values, peakColor = T.green }: { values: number[]; peakColor?: string }) {
  const max = Math.max(1, ...values)
  const peak = Math.max(...values)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 46 }}>
      {values.map((v, i) => {
        const h = Math.max(4, Math.round((v / max) * 46))
        const isPeak = v === peak && v > 0
        return <View key={i} style={{ flex: 1, height: h, borderRadius: 5, backgroundColor: isPeak ? peakColor : 'rgba(255,255,255,0.08)' }} />
      })}
    </View>
  )
}

/** Прогресс-бар-строка (метрика + полоса). */
export function BarRow({ label, value, max, color = T.green, valueLabel }: { label: string; value: number; max: number; color?: string; valueLabel: string }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: T.text, fontSize: 13.5 }} numberOfLines={1}>{label}</Text>
        <Text style={{ color, fontSize: 13.5, fontWeight: '800' }}>{valueLabel}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: R.pill, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(3, Math.min(100, (value / Math.max(1, max)) * 100))}%`, height: 8, borderRadius: R.pill, backgroundColor: color }} />
      </View>
    </View>
  )
}
