import 'server-only'

type AuditEntry = {
  actorUserId?: string | null
  entityType: string
  entityId: string
  action: string
  payload?: Record<string, unknown> | null
}

export async function writeAuditLog(client: any, entry: AuditEntry) {
  try {
    const { error } = await client.from('audit_log').insert([
      {
        actor_user_id: entry.actorUserId || null,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        action: entry.action,
        payload: entry.payload || null,
      },
    ])

    if (error) {
      console.warn('Audit log write skipped', error?.message || error)
    }
  } catch (error) {
    console.warn('Audit log write failed', error)
  }
}
