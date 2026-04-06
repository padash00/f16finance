/**
 * Shared domain types used across multiple pages and API routes.
 * Import from here instead of redefining locally.
 */
import type { SubscriptionFeature } from '@/lib/core/access'

/** Business unit (arena, ramen, extra) */
export type Company = {
  id: string
  name: string
  code: string | null
}

export type SessionOrganizationAccessRole =
  | 'super_admin'
  | 'owner'
  | 'manager'
  | 'marketer'
  | 'operator'
  | 'customer'
  | 'other'

/** Session role info returned from /api/auth/session-role */
export type SessionRoleInfo = {
  isSuperAdmin?: boolean
  isTenantContext?: boolean
  isPlatformContext?: boolean
  isCustomer?: boolean
  persona?: 'super_admin' | 'staff' | 'operator' | 'customer'
  linkedCustomerIds?: string[]
  staffRole?: 'manager' | 'marketer' | 'owner' | 'other'
  organizationHubRequired?: boolean
  organizationSelectionRequired?: boolean
  organizations?: Array<{
    id: string
    name: string
    slug: string
    status: string
    accessRole: SessionOrganizationAccessRole
    isDefault?: boolean
  }>
  activeOrganization?: {
    id: string
    name: string
    slug: string
    status: string
    accessRole: SessionOrganizationAccessRole
  } | null
  activeSubscription?: {
    id: string
    status: string
    billingPeriod: string
    startsAt: string | null
    endsAt: string | null
    plan: {
      id: string
      code: string
      name: string
      features: Partial<Record<SubscriptionFeature, boolean>>
      limits: Record<string, unknown>
    } | null
  } | null
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
