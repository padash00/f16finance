type DbErrorLike = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  inventory_suppliers_name_uidx: 'Поставщик с таким названием уже существует.',
  inventory_suppliers_org_bin_iin_uidx: 'Поставщик с таким БИН/ИИН уже существует в этой организации.',
}

export function humanizeDbError(error: unknown, fallback: string): string {
  const err = (error || {}) as DbErrorLike
  const code = String(err.code || '')
  const message = String(err.message || '')
  const details = String(err.details || '')
  const raw = `${message} ${details}`.toLowerCase()

  const constraintMatch = `${message} ${details}`.match(/constraint\s+"([^"]+)"/i)
  const constraint = constraintMatch?.[1] || ''
  if (constraint && CONSTRAINT_MESSAGES[constraint]) {
    return CONSTRAINT_MESSAGES[constraint]
  }

  if (code === '23505' || raw.includes('duplicate key value') || raw.includes('unique constraint')) {
    return 'Такая запись уже существует. Проверьте дубликаты и попробуйте снова.'
  }

  if (code === '23503' || raw.includes('foreign key constraint')) {
    return 'Нельзя выполнить действие: есть связанные записи в системе.'
  }

  if (code === '23514' || raw.includes('check constraint')) {
    return 'Данные не прошли проверку формата. Проверьте поля и повторите.'
  }

  if (code === '22P02' || raw.includes('invalid input syntax')) {
    return 'Неверный формат данных в одном из полей.'
  }

  if (code === '42501' || raw.includes('permission denied') || raw.includes('row-level security')) {
    return 'Недостаточно прав для выполнения этого действия.'
  }

  return fallback
}
