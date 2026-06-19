import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/auth'

export default function LoginScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      await signIn(email, password)
      // редирект сделает AuthGate в _layout
    } catch (e: any) {
      setError(e?.message || 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B0C0A' }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>Orda</Text>
        <Text style={{ color: '#9ca3af', marginBottom: 8 }}>Кабинет владельца</Text>

        <TextInput
          placeholder="Email"
          placeholderTextColor="#6b7280"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          style={inputStyle}
        />
        <TextInput
          placeholder="Пароль"
          placeholderTextColor="#6b7280"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={inputStyle}
        />

        {error ? <Text style={{ color: '#f87171' }}>{error}</Text> : null}

        <Pressable
          onPress={onSubmit}
          disabled={busy || !email || !password}
          style={{
            backgroundColor: busy || !email || !password ? '#065f46' : '#10b981',
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          {busy ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: '700', fontSize: 16 }}>Войти</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const inputStyle = {
  backgroundColor: '#15171a',
  borderWidth: 1,
  borderColor: '#23262b',
  borderRadius: 14,
  paddingHorizontal: 16,
  paddingVertical: 14,
  color: '#fff',
  fontSize: 16,
} as const
