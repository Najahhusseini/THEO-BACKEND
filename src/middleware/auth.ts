import { Context, Next } from 'hono'
import { verifyAccessToken } from '../modules/auth/auth.service'

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.substring(7)
  const payload = verifyAccessToken(token)

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  // Attach user info to context
  c.set('user', payload)

  // ✅ Attach tenantId from the payload (used for multi‑tenancy)
  if (payload.tenant_id) {
    c.set('tenantId', payload.tenant_id)
  } else {
    c.set('tenantId', null) // or undefined, depending on your logic
  }

  await next()
}

// Role-based authorization middleware
export const requireRole = (roles: string[]) => {
  return async (c: Context, next: Next) => {
    const user = c.get('user')
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Forbidden: insufficient permissions' }, 403)
    }
    await next()
  }
}