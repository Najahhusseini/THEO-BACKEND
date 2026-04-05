import { Hono } from 'hono'
import { generateAccessToken, generateRefreshToken, comparePassword, findStaffByEmail, findTenantBySubdomain, verifyRefreshToken, verifyAccessToken } from './auth.service'
import { db } from '../../db'
import { staff } from '../../db/schema'
import { eq } from 'drizzle-orm'

const auth = new Hono()

// Login with email + password
auth.post('/login', async (c) => {
  try {
    const { email, password, subdomain } = await c.req.json()

    console.log('Login attempt:', { email, subdomain })

    // Find tenant by subdomain
    const tenant = await findTenantBySubdomain(subdomain)

    if (!tenant) {
      console.log('Tenant not found:', subdomain)
      return c.json({ error: 'Hotel not found' }, 404)
    }

    console.log('Tenant found:', tenant.id)

    // Find staff
    const staffMember = await findStaffByEmail(tenant.id, email)

    if (!staffMember) {
      console.log('Staff not found:', email)
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    console.log('Staff found:', staffMember.id)

    if (!staffMember.passwordHash) {
      console.log('No password hash for staff:', staffMember.id)
      return c.json({ error: 'No password set. Please contact admin.' }, 401)
    }

    const isValid = await comparePassword(password, staffMember.passwordHash)

    if (!isValid) {
      console.log('Invalid password for staff:', staffMember.id)
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    if (!staffMember.active) {
      console.log('Inactive staff:', staffMember.id)
      return c.json({ error: 'Account is deactivated' }, 401)
    }

    const payload = {
      staffId: staffMember.id,
      tenantId: staffMember.tenantId,
      email: staffMember.email,
      role: staffMember.role,
    }

    const accessToken = generateAccessToken(payload)
    const refreshToken = generateRefreshToken({
      staffId: staffMember.id,
      tenantId: staffMember.tenantId,
      email: staffMember.email,
    })

    console.log('Login successful for:', staffMember.email)

    return c.json({
      accessToken,
      refreshToken,
      staff: {
        id: staffMember.id,
        name: staffMember.name,
        email: staffMember.email,
        role: staffMember.role,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Refresh token endpoint
auth.post('/refresh', async (c) => {
  try {
    const { refreshToken } = await c.req.json()
    const payload = verifyRefreshToken(refreshToken)

    if (!payload) {
      return c.json({ error: 'Invalid refresh token' }, 401)
    }

    // Get fresh staff data
    const staffMember = await db.select().from(staff).where(eq(staff.id, payload.staffId)).limit(1)

    if (!staffMember[0] || !staffMember[0].active) {
      return c.json({ error: 'Staff not found or inactive' }, 401)
    }

    const newAccessToken = generateAccessToken({
      staffId: staffMember[0].id,
      tenantId: staffMember[0].tenantId,
      email: staffMember[0].email,
      role: staffMember[0].role,
    })

    return c.json({ accessToken: newAccessToken })
  } catch (error) {
    console.error('Refresh error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Get current user info
auth.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = verifyAccessToken(token)

    if (!payload) {
      return c.json({ error: 'Invalid token' }, 401)
    }

    const staffMember = await db.select().from(staff).where(eq(staff.id, payload.staffId)).limit(1)

    if (!staffMember[0]) {
      return c.json({ error: 'Staff not found' }, 404)
    }

    return c.json({
      id: staffMember[0].id,
      name: staffMember[0].name,
      email: staffMember[0].email,
      role: staffMember[0].role,
      tenantId: staffMember[0].tenantId,
    })
  } catch (error) {
    console.error('Me endpoint error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default auth