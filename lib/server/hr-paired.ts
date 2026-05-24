// Поиск парной записи (operator↔staff) для каскадного увольнения.
//
// У одного человека может быть две независимые записи в системе:
//   - в таблице `staff` (для зарплат админ.сотрудников и иерархии)
//   - в таблице `operators` (для кассы, смен, /shifts)
// Связь между ними хранится в `operator_staff_links`. Если линка нет, пробуем
// сматчить по telegram_chat_id или нормализованному ФИО — это закрывает
// исторические случаи, когда линк не создавался.

import type { createAdminSupabaseClient } from './supabase'

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>

export type PairedRecord = {
  kind: 'staff' | 'operator'
  id: string
  name: string
  role?: string | null
  is_active: boolean
  via: 'link' | 'telegram' | 'name'
}

function normalizePersonName(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export async function findPairedRecord(
  supabase: AdminSupabase,
  params: { kind: 'staff' | 'operator'; id: string },
): Promise<PairedRecord | null> {
  const { kind, id } = params

  if (kind === 'staff') {
    // 1. Прямая связь через operator_staff_links
    const { data: links } = await supabase
      .from('operator_staff_links')
      .select('operator_id')
      .eq('staff_id', id)
      .limit(1)

    if (links && links.length > 0) {
      const operatorId = String((links[0] as any).operator_id)
      const { data: op } = await supabase
        .from('operators')
        .select('id, name, short_name, is_active, role')
        .eq('id', operatorId)
        .maybeSingle()
      if (op) {
        return {
          kind: 'operator',
          id: String((op as any).id),
          name: String((op as any).name || (op as any).short_name || 'оператор'),
          role: (op as any).role || null,
          is_active: (op as any).is_active !== false,
          via: 'link',
        }
      }
    }

    // 2. Матчинг по telegram_chat_id / ФИО
    const { data: staffRow } = await supabase
      .from('staff')
      .select('telegram_chat_id, full_name, short_name')
      .eq('id', id)
      .maybeSingle()

    if (!staffRow) return null
    const telegram = String((staffRow as any).telegram_chat_id || '').trim()
    const fullNameKey = normalizePersonName((staffRow as any).full_name)
    const shortNameKey = normalizePersonName((staffRow as any).short_name)

    if (telegram) {
      const { data: ops } = await supabase
        .from('operators')
        .select('id, name, short_name, is_active, role')
        .eq('telegram_chat_id', telegram)
        .limit(1)
      if (ops && ops.length > 0) {
        const op = ops[0] as any
        return {
          kind: 'operator',
          id: String(op.id),
          name: String(op.name || op.short_name || 'оператор'),
          role: op.role || null,
          is_active: op.is_active !== false,
          via: 'telegram',
        }
      }
    }

    if (fullNameKey || shortNameKey) {
      const { data: ops } = await supabase
        .from('operators')
        .select('id, name, short_name, is_active, role, operator_profiles(full_name)')

      for (const op of (ops as any[] | null) || []) {
        const opNameKey = normalizePersonName(op.name)
        const opShortKey = normalizePersonName(op.short_name)
        const profile = Array.isArray(op.operator_profiles) ? op.operator_profiles[0] : op.operator_profiles
        const opProfileKey = normalizePersonName(profile?.full_name)
        if (
          (fullNameKey && (fullNameKey === opNameKey || fullNameKey === opShortKey || fullNameKey === opProfileKey)) ||
          (shortNameKey && (shortNameKey === opNameKey || shortNameKey === opShortKey || shortNameKey === opProfileKey))
        ) {
          return {
            kind: 'operator',
            id: String(op.id),
            name: String(op.name || op.short_name || 'оператор'),
            role: op.role || null,
            is_active: op.is_active !== false,
            via: 'name',
          }
        }
      }
    }

    return null
  }

  // kind === 'operator'
  const { data: links } = await supabase
    .from('operator_staff_links')
    .select('staff_id')
    .eq('operator_id', id)
    .limit(1)

  if (links && links.length > 0) {
    const staffId = String((links[0] as any).staff_id)
    const { data: st } = await supabase
      .from('staff')
      .select('id, full_name, short_name, is_active, role')
      .eq('id', staffId)
      .maybeSingle()
    if (st) {
      return {
        kind: 'staff',
        id: String((st as any).id),
        name: String((st as any).full_name || (st as any).short_name || 'сотрудник'),
        role: (st as any).role || null,
        is_active: (st as any).is_active !== false,
        via: 'link',
      }
    }
  }

  const { data: opRow } = await supabase
    .from('operators')
    .select('telegram_chat_id, name, short_name, operator_profiles(full_name)')
    .eq('id', id)
    .maybeSingle()

  if (!opRow) return null
  const telegram = String((opRow as any).telegram_chat_id || '').trim()
  const profile = Array.isArray((opRow as any).operator_profiles)
    ? (opRow as any).operator_profiles[0]
    : (opRow as any).operator_profiles
  const profileFullKey = normalizePersonName(profile?.full_name)
  const opNameKey = normalizePersonName((opRow as any).name)
  const opShortKey = normalizePersonName((opRow as any).short_name)

  if (telegram) {
    const { data: stRows } = await supabase
      .from('staff')
      .select('id, full_name, short_name, is_active, role')
      .eq('telegram_chat_id', telegram)
      .limit(1)
    if (stRows && stRows.length > 0) {
      const st = stRows[0] as any
      return {
        kind: 'staff',
        id: String(st.id),
        name: String(st.full_name || st.short_name || 'сотрудник'),
        role: st.role || null,
        is_active: st.is_active !== false,
        via: 'telegram',
      }
    }
  }

  if (profileFullKey || opNameKey || opShortKey) {
    const { data: stRows } = await supabase
      .from('staff')
      .select('id, full_name, short_name, is_active, role')

    for (const st of (stRows as any[] | null) || []) {
      const stFullKey = normalizePersonName(st.full_name)
      const stShortKey = normalizePersonName(st.short_name)
      const matches =
        (profileFullKey && (profileFullKey === stFullKey || profileFullKey === stShortKey)) ||
        (opNameKey && (opNameKey === stFullKey || opNameKey === stShortKey)) ||
        (opShortKey && (opShortKey === stFullKey || opShortKey === stShortKey))
      if (matches) {
        return {
          kind: 'staff',
          id: String(st.id),
          name: String(st.full_name || st.short_name || 'сотрудник'),
          role: st.role || null,
          is_active: st.is_active !== false,
          via: 'name',
        }
      }
    }
  }

  return null
}
