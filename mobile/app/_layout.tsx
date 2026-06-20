import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { AuthProvider, useAuth } from '@/lib/auth'

function AuthGate() {
  const { session, role, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const inLogin = segments[0] === 'login'
    const inOp = segments[0] === 'op'

    if (!session) {
      if (!inLogin) router.replace('/login')
    } else if (role?.isOperator) {
      // Оператор → личный кабинет (отдельная навигация)
      if (!inOp) router.replace('/op')
    } else {
      // Владелец / менеджер / суперадмин → кабинет владельца (табы)
      if (inLogin || inOp) router.replace('/')
    }
  }, [session, role, loading, segments])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0C0A' }}>
        <ActivityIndicator color="#10b981" />
      </View>
    )
  }
  return <Slot />
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AuthGate />
    </AuthProvider>
  )
}
