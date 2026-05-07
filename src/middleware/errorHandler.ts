import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

export async function errorHandler(c: Context, next: Next) {
  try {
    await next()
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] Unhandled error:`, err)

    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status)
    }

    if (err.code && err.detail) {
      return c.json({ error: 'Database error', detail: err.detail }, 500)
    }

    return c.json({ error: 'Internal server error' }, 500)
  }
}