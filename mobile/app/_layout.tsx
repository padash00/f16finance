import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { AuthProvider, useAuth } from '@/lib/auth'
import { authenticate, isBiometricAvailable, isBiometricEnabled } from '@/lib/biometric'

function BiometricLock({ onUnlock, onLogout }: { onUnlock: () => void; onLogout: () => void }) {
  const tryAuth = async () => { if (await authenticate()) onUnlock() }
  useEffect(() => { void tryAuth() }, [])
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#070809', padding: 28, gap: 18 }}>
      <View style={{ width: 88, height: 88, borderRadius: 26, backgroundColor: 'rgba(16,185,129,0.14)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.4)', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="lock-closed" size={40} color="#10b981" />
      </View>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>Orda заблокирован</Text>
      <Text style={{ color: '#9aa6b4', fontSize: 14, textAlign: 'center' }}>Подтвердите вход биометрией.</Text>
      <Pressable onPress={() => void tryAuth()} style={{ backgroundColor: '#10b981', borderRadius: 16, paddingVertical: 15, paddingHorizontal: 40, marginTop: 6 }}>
        <Text style={{ color: '#04130d', fontWeight: '900', fontSize: 16 }}>Разблокировать</Text>
      </Pressable>
      <Pressable onPress={onLogout} hitSlop={10}><Text style={{ color: '#fb7185', fontWeight: '700', fontSize: 14 }}>Выйти из аккаунта</Text></Pressable>
    </View>
  )
}

function AuthGate() {
  const { session, role, loading, signOut } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  const [locked, setLocked] = useState(false)
  const [bioChecked, setBioChecked] = useState(false)

  // Биометрический замок: при наличии сессии и включённой биометрии — требуем подтверждение.
  useEffect(() => {
    if (loading) return
    if (!session) { setLocked(false); setBioChecked(true); return }
    if (bioChecked) return
    void (async () => {
      if ((await isBiometricEnabled()) && (await isBiometricAvailable())) setLocked(true)
      setBioChecked(true)
    })()
  }, [session, loading, bioChecked])

  useEffect(() => {
    if (loading || locked) return
    const inLogin = segments[0] === 'login'
    const inOp = segments[0] === 'op'
    if (!session) {
      if (!inLogin) router.replace('/login')
    } else if (role?.isOperator) {
      if (!inOp) router.replace('/op')
    } else {
      if (inLogin || inOp) router.replace('/')
    }
  }, [session, role, loading, locked, segments])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#070809' }}>
        <ActivityIndicator color="#10b981" />
      </View>
    )
  }
  if (locked) return <BiometricLock onUnlock={() => setLocked(false)} onLogout={() => { setLocked(false); void signOut() }} />
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070809' } }} />
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AuthGate />
    </AuthProvider>
  )
}
