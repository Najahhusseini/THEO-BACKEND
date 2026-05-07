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
  staffId: string
  tenantId: string
  email: string
  role: string
  isSuperAdmin: boolean          // ✅ NEW
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function generateRefreshToken(payload: Omit<TokenPayload, 'role'>): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN })
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload
  } catch {
    return null
  }
}

export function verifyRefreshToken(token: string): Omit<TokenPayload, 'role'> | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as Omit<TokenPayload, 'role'>
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
  const result = await db.select().from(staff).where(and(eq(staff.tenantId, tenantId), eq(staff.email, email))).limit(1)
  return result[0]
}

export async function findTenantBySubdomain(subdomain: string) {
  const result = await db.select().from(tenants).where(eq(tenants.subdomain, subdomain)).limit(1)
  return result[0]
}