import { Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { T } from '@/lib/theme'

export function NoAccess({ title }: { title?: string }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={['top']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
        <Ionicons name="lock-closed" size={40} color={T.textDim} />
        <Text style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>{title || 'Раздел недоступен'}</Text>
        <Text style={{ color: T.textMut, fontSize: 13, textAlign: 'center' }}>
          У вашей роли нет доступа к этому разделу. Доступ настраивает владелец в разделе «Права» на сайте.
        </Text>
      </View>
    </SafeAreaView>
  )
}
