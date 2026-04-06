import 'server-only'

import type { LinkedCustomerRow } from '@/lib/server/linked-customers'

/** Primary app persona for routing and session; see docs/roles.md. */
export type RequestAuthPersonaKind = 'super_admin' | 'staff' | 'operator' | 'customer'

export function resolveRequestAuthPersona(params: {
  isSuperAdmin: boolean
  staffMember: unknown | null
  operatorAuth: unknown | null
  linkedCustomers: LinkedCustomerRow[]
}): RequestAuthPersonaKind | null {
  const { isSuperAdmin, staffMember, operatorAuth, linkedCustomers } = params

  if (isSuperAdmin) return 'super_admin'
  if (staffMember) return 'staff'
  if (operatorAuth) return 'operator'
  if (linkedCustomers.length > 0) return 'customer'
  return null
}
