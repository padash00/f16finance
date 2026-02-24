import { createBrowserClient } from '@supabase/ssr'

// Используем createBrowserClient. 
// Он автоматически сохраняет сессию в Cookies, чтобы Middleware (Охранник) мог её увидеть.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)