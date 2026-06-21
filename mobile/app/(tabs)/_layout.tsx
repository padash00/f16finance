import { StyleSheet } from 'react-native'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'

import { T } from '@/lib/theme'
import { haptic } from '@/lib/haptics'

export default function TabsLayout() {
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.tap() }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: T.green,
        tabBarInactiveTintColor: T.textDim,
        tabBarBackground: () => (
          <LinearGradient colors={['rgba(10,13,16,0.94)', 'rgba(7,9,11,1)']} style={StyleSheet.absoluteFill} />
        ),
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopColor: T.borderSoft,
          borderTopWidth: 1,
          height: 86,
          paddingTop: 9,
          paddingBottom: 28,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Главная', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="finance" options={{ title: 'Финансы', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="team" options={{ title: 'Команда', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'people' : 'people-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="ai" options={{ title: 'AI', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'sparkles' : 'sparkles-outline'} size={23} color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: 'Ещё', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'grid' : 'grid-outline'} size={23} color={color} /> }} />
    </Tabs>
  )
}
