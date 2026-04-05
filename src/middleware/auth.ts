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

  await next()
}