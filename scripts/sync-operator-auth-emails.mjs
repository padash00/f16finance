/**
 * Одноразовый скрипт: синхронизирует email в Supabase Auth
 * для всех операторов у которых username в operator_auth
 * не совпадает с email в auth.users.
 *
 * Запуск:
 *   node scripts/sync-operator-auth-emails.mjs
 *
 * Требует переменных окружения:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EMAIL_DOMAIN = 'operator.local'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Нужны переменные: NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: rows, error } = await supabase
  .from('operator_auth')
  .select('operator_id, user_id, username')
  .not('user_id', 'is', null)
  .not('username', 'is', null)

if (error) {
  console.error('Ошибка загрузки operator_auth:', error.message)
  process.exit(1)
}

console.log(`Найдено операторов с аккаунтом: ${rows.length}`)

let ok = 0
let fail = 0

for (const row of rows) {
  const expectedEmail = `${row.username.trim().toLowerCase()}@${EMAIL_DOMAIN}`

  const { error: updateError } = await supabase.auth.admin.updateUserById(row.user_id, {
    email: expectedEmail,
  })

  if (updateError) {
    console.error(`  ✗ ${row.username} (${row.user_id}): ${updateError.message}`)
    fail++
  } else {
    console.log(`  ✓ ${row.username} → ${expectedEmail}`)
    ok++
  }
}

console.log(`\nГотово: ${ok} успешно, ${fail} ошибок`)
