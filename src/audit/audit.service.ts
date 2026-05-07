import { db } from '../db'
import { sql } from 'drizzle-orm'

export interface AuditEntry {
  tenantId: string
  staffId: string
  action: string
  entity: string
  entityId: string
  details?: any
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  await db.execute(sql`
    INSERT INTO audit_logs (tenant_id, staff_id, action, entity, entity_id, details, created_at)
    VALUES (${entry.tenantId}, ${entry.staffId}, ${entry.action}, ${entry.entity}, ${entry.entityId}, ${JSON.stringify(entry.details || {})}, NOW())
  `)
}