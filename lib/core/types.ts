/**
 * Shared domain types used across multiple pages and API routes.
 * Import from here instead of redefining locally.
 */

/** Business unit (arena, ramen, extra) */
export type Company = {
  id: string
  name: string
  code: string | null
}

/** Session role info returned from /api/auth/session-role */
export type SessionRoleInfo = {
  isSuperAdmin?: boolean
  staffRole?: 'manager' | 'marketer' | 'owner' | 'other'
}

/** Staff role union — matches DB enum */
export type StaffRole = 'manager' | 'marketer' | 'owner' | 'other'

/** Base operator entity. Extended fields are optional because
 *  different queries select different columns. */
export type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
  full_name?: string | null
  telegram_chat_id?: string | null
  role?: string | null
  created_at?: string
  operator_profiles?: Array<{ full_name?: string | null }> | null
}

/** Common date-range preset used in filter UIs */
export type DateRangePreset = 'today' | 'week' | 'month' | 'all'

/** Task status values — must match DB enum */
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'

/** Task priority values — must match DB enum */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'

/** Task operator response values */
export type TaskResponse = 'accept' | 'need_info' | 'blocked' | 'already_done' | 'complete'
