export type PointRuleOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'is_true'
  | 'is_false'

export type PointRuleCondition = {
  field: string
  operator: PointRuleOperator
  value?: unknown
}

export type PointRuleActionType =
  | 'add_bonus'
  | 'add_fine'
  | 'set_min_net'
  | 'cap_net'
  | 'tag'

export type PointRuleAction = {
  type: PointRuleActionType
  amount?: number
  value?: string
}

export type PointRuleRow = {
  id: string
  company_id: string | null
  scope: string
  event: string
  name: string
  description: string | null
  priority: number
  is_active: boolean
  stop_processing: boolean
  conditions: PointRuleCondition[]
  actions: PointRuleAction[]
}

export type RuleEvaluationContext = Record<string, unknown>

export type RuleEffect = {
  type: PointRuleActionType
  amount?: number
  value?: string
  ruleId: string
  ruleName: string
}

export type RuleEvaluationResult = {
  matchedRules: Array<{ id: string; name: string }>
  effects: RuleEffect[]
}

function toComparable(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const num = Number(value)
    return Number.isFinite(num) && value.trim() !== '' ? num : value
  }
  return value
}

function getByPath(target: RuleEvaluationContext, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let cursor: unknown = target
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function conditionMatches(condition: PointRuleCondition, context: RuleEvaluationContext) {
  const actualRaw = getByPath(context, condition.field)
  const actual = toComparable(actualRaw)
  const expected = toComparable(condition.value)

  switch (condition.operator) {
    case 'eq':
      return actual === expected
    case 'ne':
      return actual !== expected
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case 'in': {
      if (!Array.isArray(condition.value)) return false
      return condition.value.some((item) => toComparable(item) === actual)
    }
    case 'not_in': {
      if (!Array.isArray(condition.value)) return true
      return !condition.value.some((item) => toComparable(item) === actual)
    }
    case 'is_true':
      return actual === true
    case 'is_false':
      return actual === false
    default:
      return false
  }
}

function normalizeAmount(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0
}

export function evaluatePointRules(params: {
  rules: PointRuleRow[]
  context: RuleEvaluationContext
}): RuleEvaluationResult {
  const sorted = [...params.rules].sort((a, b) => a.priority - b.priority)
  const matchedRules: Array<{ id: string; name: string }> = []
  const effects: RuleEffect[] = []

  for (const rule of sorted) {
    if (!rule.is_active) continue
    const conditions = Array.isArray(rule.conditions) ? rule.conditions : []
    const actions = Array.isArray(rule.actions) ? rule.actions : []
    const matched = conditions.every((condition) => conditionMatches(condition, params.context))
    if (!matched) continue

    matchedRules.push({ id: rule.id, name: rule.name })
    for (const action of actions) {
      effects.push({
        type: action.type,
        amount: normalizeAmount(action.amount),
        value: typeof action.value === 'string' ? action.value : undefined,
        ruleId: rule.id,
        ruleName: rule.name,
      })
    }
    if (rule.stop_processing) break
  }

  return { matchedRules, effects }
}
