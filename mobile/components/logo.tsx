import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

/** Лого Orda: эмблема (изумрудный скруглённый квадрат с биржевым маркером) + вордмарк. */
export function Logo({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const big = size === 'lg'
  const box = big ? 64 : 40
  return (
    <View style={{ alignItems: 'center', gap: big ? 16 : 8 }}>
      <View
        style={{
          width: box, height: box, borderRadius: box * 0.3,
          backgroundColor: '#10b981',
          alignItems: 'center', justifyContent: 'center',
          // мягкое свечение/объём
          shadowColor: '#10b981', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
          borderWidth: 1, borderColor: '#34d399',
        }}
      >
        {/* верхний блик */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: box * 0.45, borderTopLeftRadius: box * 0.3, borderTopRightRadius: box * 0.3, backgroundColor: 'rgba(255,255,255,0.16)' }} />
        <Ionicons name="trending-up" size={box * 0.5} color="#04130d" />
      </View>
      {big ? (
        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={{ color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: 1 }}>Orda</Text>
            <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: '#10b981', marginLeft: 3, marginBottom: 7 }} />
          </View>
          <Text style={{ color: '#6b7280', fontSize: 12, letterSpacing: 4, marginTop: 4, textTransform: 'uppercase' }}>Control</Text>
        </View>
      ) : (
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900' }}>Orda</Text>
      )}
    </View>
  )
}
