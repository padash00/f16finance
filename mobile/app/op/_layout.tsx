import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { T } from '@/lib/theme'
import { haptic } from '@/lib/haptics'

export default function OperatorLayout() {
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.tap() }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: T.green,
        tabBarInactiveTintColor: T.textDim,
        tabBarStyle: {
          backgroundColor: 'rgba(10,12,14,0.96)',
          borderTopColor: T.borderSoft,
          borderTopWidth: 1,
          height: 86,
          paddingTop: 9,
          paddingBottom: 28,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Главная', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="shifts" options={{ title: 'Смены', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="tasks" options={{ title: 'Задачи', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'checkbox' : 'checkbox-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="audit" options={{ title: 'Ревизия', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'clipboard' : 'clipboard-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="salary" options={{ title: 'Зарплата', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'person' : 'person-outline'} size={23} color={color} /> }} />
      {/* Скрытые из таб-бара — открываются с Главной */}
      <Tabs.Screen name="checklist" options={{ href: null }} />
      <Tabs.Screen name="incidents" options={{ href: null }} />
      <Tabs.Screen name="knowledge" options={{ href: null }} />
    </Tabs>
  )
}
