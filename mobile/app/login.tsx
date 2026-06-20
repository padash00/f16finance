import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured, supabaseHost } from '@/lib/supabase'
import { Logo } from '@/components/logo'

export default function LoginScreen() {
  const { signIn } = useAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [focus, setFocus] = useState<'login' | 'pass' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [busy, setBusy] = useState(false)

  const isEmail = login.includes('@')
  const canSubmit = !!login && !!password && !busy && isSupabaseConfigured

  const onSubmit = async () => {
    setError(null); setShowDetails(false)
    if (!isSupabaseConfigured) {
      setError('Приложение не настроено: не заданы EXPO_PUBLIC_SUPABASE_URL / ANON_KEY в .env. После правки .env перезапусти: expo start -c.')
      return
    }
    setBusy(true)
    try {
      await signIn(login, password)
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg === 'Invalid login credentials') {
        setError('Неверный логин или пароль. Если на сайте этот вход работает — мобилка скорее всего смотрит в другой Supabase-проект (проверь .env).')
        setShowDetails(true)
      } else if (/network|fetch|timeout|Failed to fetch/i.test(msg)) {
        setError('Нет связи с сервером авторизации. Проверь интернет и адрес Supabase.')
        setShowDetails(true)
      } else if (/email|confirm/i.test(msg)) {
        setError(`Аккаунт не подтверждён или email не найден: ${msg}`)
        setShowDetails(true)
      } else {
        setError(msg || 'Не удалось войти')
        setShowDetails(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const inputBorder = (f: 'login' | 'pass') => (focus === f ? '#10b981' : '#23262b')

  return (
    <View style={{ flex: 1, backgroundColor: '#08100d' }}>
      {/* мягкое свечение */}
      <View style={{ position: 'absolute', top: -120, left: -80, width: 320, height: 320, borderRadius: 999, backgroundColor: 'rgba(16,185,129,0.16)' }} />
      <View style={{ position: 'absolute', bottom: -140, right: -100, width: 340, height: 340, borderRadius: 999, backgroundColor: 'rgba(20,184,166,0.10)' }} />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 26 }} keyboardShouldPersistTaps="handled">
            <View style={{ alignItems: 'center', marginBottom: 30 }}>
              <Logo size="lg" />
              <Text style={{ color: '#94a3b8', fontSize: 14, marginTop: 18 }}>Управление бизнесом в кармане</Text>
            </View>

            {/* glassy card */}
            <View style={{ backgroundColor: 'rgba(21,23,26,0.92)', borderWidth: 1, borderColor: '#1f242a', borderRadius: 24, padding: 22, gap: 14 }}>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>Вход</Text>

              <View>
                <TextInput
                  placeholder="Email или логин"
                  placeholderTextColor="#5b6470"
                  autoCapitalize="none" autoCorrect={false}
                  keyboardType={isEmail ? 'email-address' : 'default'}
                  value={login} onChangeText={setLogin}
                  onFocus={() => setFocus('login')} onBlur={() => setFocus(null)}
                  style={[inputStyle, { borderColor: inputBorder('login') }]}
                />
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  <View style={{ backgroundColor: login.length === 0 ? '#1b1f24' : isEmail ? '#0b3b2e' : '#1e2a3a', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: login.length === 0 ? '#6b7280' : isEmail ? '#34d399' : '#60a5fa', fontSize: 11, fontWeight: '700' }}>
                      {login.length === 0 ? 'владелец / админ — email · оператор — логин' : isEmail ? 'Владелец / Администратор' : 'Оператор'}
                    </Text>
                  </View>
                </View>
              </View>

              <TextInput
                placeholder="Пароль"
                placeholderTextColor="#5b6470"
                secureTextEntry
                value={password} onChangeText={setPassword}
                onFocus={() => setFocus('pass')} onBlur={() => setFocus(null)}
                style={[inputStyle, { borderColor: inputBorder('pass') }]}
              />

              {error ? (
                <View style={{ backgroundColor: '#1d0f0f', borderColor: '#3b1212', borderWidth: 1, borderRadius: 12, padding: 10 }}>
                  <Text style={{ color: '#f87171', fontSize: 13 }}>{error}</Text>
                  {showDetails ? (
                    <Text style={{ color: '#9ca3af', fontSize: 11, marginTop: 6 }}>
                      Supabase: {supabaseHost}{'\n'}Вход: {isEmail ? login.trim().toLowerCase() : 'оператор'}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                onPress={onSubmit} disabled={!canSubmit}
                style={{ backgroundColor: canSubmit ? '#10b981' : '#0c3a2c', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 4, overflow: 'hidden' }}
              >
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 18, backgroundColor: 'rgba(255,255,255,0.14)' }} />
                {busy ? <ActivityIndicator color="#04130d" /> : <Text style={{ color: '#04130d', fontWeight: '900', fontSize: 16 }}>Войти</Text>}
              </Pressable>
            </View>

            <Text style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', marginTop: 22 }}>Orda Control · ordaops.kz</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}

const inputStyle = {
  backgroundColor: '#0f1316',
  borderWidth: 1.5,
  borderRadius: 14,
  paddingHorizontal: 16,
  paddingVertical: 15,
  color: '#fff',
  fontSize: 16,
} as const
