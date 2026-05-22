import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { db } from '../../db'
import { staff, tenants } from '../../db/schema'
import { eq, and } from 'drizzle-orm'

const JWT_SECRET = process.env.JWT_SECRET!
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!
const JWT_EXPIRES_IN = '7d'
const REFRESH_EXPIRES_IN = '30d'

export interface TokenPayload {
  id: string                    // staff id (for middleware)
  staffId: string               // legacy support
  tenantId: string              // camelCase
  tenant_id: string             // snake_case for your auth middleware
  email: string
  role: string
  isSuperAdmin: boolean
}

export function generateAccessToken(payload: { staffId: string; tenantId: string; email: string; role: string; isSuperAdmin: boolean }): string {
  const tokenPayload: TokenPayload = {
    id: payload.staffId,
    staffId: payload.staffId,
    tenantId: payload.tenantId,
    tenant_id: payload.tenantId,
    email: payload.email,
    role: payload.role,
    isSuperAdmin: payload.isSuperAdmin,
  }
  return jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function generateRefreshToken(payload: { staffId: string; tenantId: string }): string {
  return jwt.sign(
    {
      id: payload.staffId,
      staffId: payload.staffId,
      tenantId: payload.tenantId,
      tenant_id: payload.tenantId,
    },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN }
  )
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload
  } catch {
    return null
  }
}

export function verifyRefreshToken(token: string): { staffId: string; tenantId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as any
    return {
      staffId: decoded.staffId || decoded.id,
      tenantId: decoded.tenantId || decoded.tenant_id,
    }
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function findStaffByEmail(tenantId: string, email: string) {
  const result = await db
    .select()
    .from(staff)
    .where(and(eq(staff.tenantId, tenantId), eq(staff.email, email)))
    .limit(1)
  return result[0]
}

export async function findTenantBySubdomain(subdomain: string) {
  const result = await db
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain))
    .limit(1)
  return result[0]
}