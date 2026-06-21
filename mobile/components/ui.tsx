import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { T, R, S, shadow } from '@/lib/theme'

/** Появление: плавный fade + лёгкий подъём при монтировании (премиум-ощущение). */
export function FadeIn({ children, delay = 0, y = 10, style }: { children: ReactNode; delay?: number; y?: number; style?: StyleProp<ViewStyle> }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [a, delay])
  return (
    <Animated.View style={[{ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [y, 0] }) }] }, style]}>
      {children}
    </Animated.View>
  )
}

/** Мягкое «свечение» — стопка полупрозрачных кругов (эмуляция blur без зависимостей). */
export function Glow({ color, size = 240, style }: { color: string; size?: number; style?: ViewStyle }) {
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color, opacity: 0.16 }} />
      <View style={{ position: 'absolute', left: size * 0.16, top: size * 0.16, width: size * 0.68, height: size * 0.68, borderRadius: size, backgroundColor: color, opacity: 0.2 }} />
      <View style={{ position: 'absolute', left: size * 0.32, top: size * 0.32, width: size * 0.36, height: size * 0.36, borderRadius: size, backgroundColor: color, opacity: 0.28 }} />
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <FadeIn style={[{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.xl, padding: S.lg }, shadow.card, style]}>
      {/* верхний блик для объёма */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 16, right: 16, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
      {children}
    </FadeIn>
  )
}

/** Карточка-герой с цветным свечением за контентом + мягкий пульс свечения. */
export function GlowHero({ children, glow = T.green, style }: { children: ReactNode; glow?: string; style?: ViewStyle }) {
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] })
  return (
    <FadeIn style={[{ borderRadius: R.xl, overflow: 'hidden', borderWidth: 1, borderColor: '#20262e', backgroundColor: '#0c0f13' }, shadow.glow(glow), style]}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: -130, right: -90, opacity: 0.9, transform: [{ scale }] }}>
        <Glow color={glow} size={280} />
      </Animated.View>
      <Glow color={T.cyan} size={170} style={{ bottom: -80, left: -50 }} />
      {/* верхний блик */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 64, backgroundColor: 'rgba(255,255,255,0.035)' }} />
      <View style={{ padding: S.xl }}>{children}</View>
    </FadeIn>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: S.md, marginTop: S.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 3, height: 15, borderRadius: 2, backgroundColor: T.green }} />
        <Text style={{ color: T.text, fontSize: 17, fontWeight: '800', letterSpacing: 0.2 }}>{children}</Text>
      </View>
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

/** Сегмент-переключатель со скользящим индикатором (анимация). */
export function Segmented<T_ extends string>({ value, options, onChange }: { value: T_; options: { key: T_; label: string }[]; onChange: (k: T_) => void }) {
  const idx = Math.max(0, options.findIndex((o) => o.key === value))
  const [w, setW] = useState(0)
  const x = useRef(new Animated.Value(idx)).current
  useEffect(() => {
    Animated.spring(x, { toValue: idx, useNativeDriver: true, friction: 10, tension: 90 }).start()
  }, [idx, x])
  const segW = w > 0 ? (w - 8) / options.length : 0
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: R.md, padding: 4, position: 'relative' }}>
      {w > 0 && options.length > 1 ? (
        <Animated.View
          style={{
            position: 'absolute', top: 4, bottom: 4, left: 4, width: segW, borderRadius: R.sm, backgroundColor: T.green,
            transform: [{ translateX: x.interpolate({ inputRange: options.map((_, i) => i), outputRange: options.map((_, i) => i * segW) }) }],
          }}
        />
      ) : null}
      {options.map((o) => {
        const active = o.key === value
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={{ flex: 1, paddingVertical: 9, borderRadius: R.sm, alignItems: 'center' }}>
            <Text style={{ color: active ? '#04130d' : T.textMut, fontWeight: '800', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Плейсхолдер загрузки с лёгким мерцанием. */
export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: ViewStyle }) {
  const a = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 0.9, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.4, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [a])
  return <Animated.View style={[{ height: h, width: w as any, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)', opacity: a }, style]} />
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

/** Прогресс-бар-строка с анимированным заполнением. */
export function BarRow({ label, value, max, color = T.green, valueLabel }: { label: string; value: number; max: number; color?: string; valueLabel: string }) {
  const pct = Math.max(3, Math.min(100, (value / Math.max(1, max)) * 100))
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(a, { toValue: pct, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
  }, [a, pct])
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: T.text, fontSize: 13.5 }} numberOfLines={1}>{label}</Text>
        <Text style={{ color, fontSize: 13.5, fontWeight: '800' }}>{valueLabel}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: R.pill, overflow: 'hidden' }}>
        <Animated.View style={{ width: a.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), height: 8, borderRadius: R.pill, backgroundColor: color }} />
      </View>
    </View>
  )
}

/** Нажимаемая обёртка с лёгким scale/opacity при нажатии (микро-интеракция). */
export function Tappable({ children, onPress, style }: { children: ReactNode; onPress: () => void; style?: ViewStyle }) {
  const s = useRef(new Animated.Value(1)).current
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.spring(s, { toValue: 0.97, useNativeDriver: true, friction: 8 }).start()}
      onPressOut={() => Animated.spring(s, { toValue: 1, useNativeDriver: true, friction: 8 }).start()}
    >
      <Animated.View style={[{ transform: [{ scale: s }] }, style]}>{children}</Animated.View>
    </Pressable>
  )
}
