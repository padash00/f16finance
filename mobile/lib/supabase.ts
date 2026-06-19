import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Подсказка в Metro-логах, если .env не заполнен.
  console.warn('[orda-mobile] EXPO_PUBLIC_SUPABASE_URL / ANON_KEY не заданы — заполни .env')
}

// Supabase используется ТОЛЬКО для аутентификации (вход/refresh/выход).
// Все ДАННЫЕ идут через Next.js API (lib/api.ts) с Bearer-токеном этой сессии —
// архитектурное правило проекта: Supabase только через API.
// NB: токены хранятся в AsyncStorage. Для прод-хардена — мигрировать на
// expo-secure-store (chunked LargeSecureStore адаптер).
export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
