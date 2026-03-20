type MaybeNestedProfile =
  | {
      full_name?: string | null
    }
  | Array<{
      full_name?: string | null
    }>
  | null
  | undefined

export type OperatorNameLike = {
  name?: string | null
  short_name?: string | null
  full_name?: string | null
  operator_profiles?: MaybeNestedProfile
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return null
}

function extractProfileFullName(profile: MaybeNestedProfile): string | null {
  if (!profile) return null
  if (Array.isArray(profile)) {
    return firstNonEmpty(profile[0]?.full_name)
  }
  return firstNonEmpty(profile.full_name)
}

export function getOperatorFullName(source: OperatorNameLike | null | undefined): string | null {
  if (!source) return null
  return firstNonEmpty(extractProfileFullName(source.operator_profiles), source.full_name)
}

export function getOperatorDisplayName(
  source: OperatorNameLike | null | undefined,
  fallback = 'Без имени',
): string {
  return firstNonEmpty(getOperatorFullName(source), source?.name, source?.short_name) || fallback
}

export function getOperatorShortLabel(
  source: OperatorNameLike | null | undefined,
  fallback = 'Без имени',
): string {
  return firstNonEmpty(source?.short_name, getOperatorFullName(source), source?.name) || fallback
}
