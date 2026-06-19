import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { AuthProvider, useAuth } from '@/lib/auth'

function AuthGate() {
  const { session, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const onLogin = segments[0] === 'login'
    if (!session && !onLogin) router.replace('/login')
    else if (session && onLogin) router.replace('/')
  }, [session, loading, segments])

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
