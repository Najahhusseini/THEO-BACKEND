import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

const adminStaff = new Hono()

// Middleware: require admin/manager
adminStaff.use('*', async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})

// GET /api/admin-staff – list staff + max limit
adminStaff.get('/', async (c) => {
  const { tenantId } = c.get('user')

  try {
    const staffList = await db.execute(sql`
      SELECT id, name, email, role, phone, active
      FROM staff
      WHERE tenant_id = ${tenantId}
      ORDER BY role, name
    `)

    // Try to get max_staff, default to 20 if column doesn't exist
    let maxStaff = 20
    try {
      const tenant = await db.execute(sql`
        SELECT max_staff FROM tenants WHERE id = ${tenantId}
      `)
      maxStaff = tenant.rows[0]?.max_staff || 20
    } catch {
      // column might not exist yet
    }

    return c.json({ staff: staffList.rows, maxStaff, currentCount: staffList.rows.length })
  } catch (err: any) {
    console.error('Admin-staff GET error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/admin-staff – create staff (respects max limit)
adminStaff.post('/', async (c) => {
  const { tenantId } = c.get('user')
  const { name, email, password, role, phone } = await c.req.json()

  if (!name || !email || !password || !role) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  try {
    // Check limit (safe if column missing)
    let maxStaff = 20
    try {
      const limitRes = await db.execute(sql`
        SELECT max_staff FROM tenants WHERE id = ${tenantId}
      `)
      maxStaff = limitRes.rows[0]?.max_staff || 20
    } catch {}

    const countRes = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM staff WHERE tenant_id = ${tenantId}
    `)
    if (countRes.rows[0].count >= maxStaff) {
      return c.json({ error: `Staff limit reached (${maxStaff}). Please contact super‑admin.` }, 403)
    }

    // Check duplicate email
    const existing = await db.execute(sql`
      SELECT id FROM staff WHERE email = ${email} AND tenant_id = ${tenantId}
    `)
    if (existing.rows.length > 0) {
      return c.json({ error: 'Email already exists' }, 409)
    }

    const passwordHash = await bcrypt.hash(password, 10)
    await db.execute(sql`
      INSERT INTO staff (id, tenant_id, name, email, password_hash, role, phone, active, created_at, updated_at, is_super_admin)
      VALUES (gen_random_uuid(), ${tenantId}, ${name}, ${email}, ${passwordHash}, ${role}, ${phone || null}, true, NOW(), NOW(), false)
    `)

    return c.json({ success: true }, 201)
  } catch (err: any) {
    console.error('Admin-staff POST error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// PATCH /api/admin-staff/:staffId – update role, phone, active
adminStaff.patch('/:staffId', async (c) => {
  const { tenantId } = c.get('user')
  const { staffId } = c.req.param()
  const { role, active, phone } = await c.req.json()

  try {
    const staffMember = await db.execute(sql`
      SELECT id FROM staff WHERE id = ${staffId} AND tenant_id = ${tenantId}
    `)
    if (staffMember.rows.length === 0) {
      return c.json({ error: 'Staff not found' }, 404)
    }

    // Build SET clause explicitly (avoids sql.join issues)
    const setClauses: string[] = []

    if (role !== undefined) {
      setClauses.push(`role = '${role.replace(/'/g, "''")}'`)
    }
    if (active !== undefined) {
      setClauses.push(`active = ${active}`)
    }
    if (phone !== undefined) {
      setClauses.push(`phone = ${phone === null ? 'NULL' : `'${phone.replace(/'/g, "''")}'`}`)
    }

    if (setClauses.length > 0) {
      setClauses.push(`updated_at = NOW()`)
      const setClause = setClauses.join(', ')
      await db.execute(sql.raw(`
        UPDATE staff SET ${setClause} WHERE id = '${staffId}'
      `))
    }

    return c.json({ success: true })
  } catch (err: any) {
    console.error('Admin-staff PATCH error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/admin-staff/guests – guest list with folio IDs
adminStaff.get('/guests', async (c) => {
  const { tenantId } = c.get('user')

  try {
    const result = await db.execute(sql`
      SELECT 
        s.guest_name,
        s.reservation_id,
        s.status as stay_status,
        f.id as folio_id,
        s.room_number,
        s.arrival_date,
        s.departure_date
      FROM stays s
      LEFT JOIN folios f ON f.stay_id = s.id
      WHERE EXISTS (
        SELECT 1 FROM rooms r WHERE r.room_number = s.room_number AND r.tenant_id = ${tenantId}
      )
      ORDER BY s.arrival_date DESC
    `)
    return c.json(result.rows)
  } catch (err: any) {
    console.error('Admin-staff guests error:', err)
    return c.json({ error: err.message }, 500)
  }
})

export default adminStaff