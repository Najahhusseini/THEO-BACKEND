import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

const superAdmin = new Hono()

// Middleware: only super-admins allowed
async function superAdminOnly(c: any, next: any) {
  const user = c.get('user')
  if (!user || !user.isSuperAdmin) {
    return c.json({ error: 'Forbidden – super admin only' }, 403)
  }
  await next()
}
superAdmin.use('*', superAdminOnly)

// GET /api/super-admin/hotels
superAdmin.get('/hotels', async (c) => {
  try {
    const result = await db.execute(sql`
      SELECT 
        t.id,
        t.name,
        t.subdomain,
        t.created_at,
        t.phone,
        t.address,
        t.amenities,
        t.email_inbox_config,
        (SELECT COUNT(*) FROM rooms r WHERE r.tenant_id = t.id) as room_count,
        (SELECT COUNT(*) FROM staff s WHERE s.tenant_id = t.id) as staff_count
      FROM tenants t
      ORDER BY t.created_at DESC
    `)
    return c.json(result.rows)
  } catch (err: any) {
    console.error('SuperAdmin hotels error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/super-admin/hotels/:hotelId
superAdmin.get('/hotels/:hotelId', async (c) => {
  const { hotelId } = c.req.param()
  try {
    const hotelResult = await db.execute(sql`
      SELECT id, name, subdomain, logo_url, phone, address, amenities, email_inbox_config, created_at
      FROM tenants WHERE id = ${hotelId}
    `)
    if (hotelResult.rows.length === 0) {
      return c.json({ error: 'Hotel not found' }, 404)
    }
    const hotel = hotelResult.rows[0]

    const roomsResult = await db.execute(sql`
      SELECT room_number, floor, room_type, status, out_of_order
      FROM rooms WHERE tenant_id = ${hotelId}
      ORDER BY floor, room_number
    `)
    const staffResult = await db.execute(sql`
      SELECT id, name, email, role, phone, active, is_super_admin
      FROM staff WHERE tenant_id = ${hotelId}
      ORDER BY role, name
    `)

    return c.json({
      ...hotel,
      rooms: roomsResult.rows,
      staff: staffResult.rows,
    })
  } catch (err: any) {
    console.error('Hotel detail error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/super-admin/register-hotel
superAdmin.post('/register-hotel', async (c) => {
  const body = await c.req.json()
  const {
    hotelName,
    subdomain,
    address,
    phone,
    logoUrl,
    emailInboxConfig,        // { email, protocol, server, port, username, password }
    amenities,               // string[] e.g. ["Pool","Spa"]
    staffAssignments,        // { name, email, role, password?, phone? }[]
    roomConfiguration,       // { roomType: string, floors: { floor: number, count: number }[] }[]
  } = body

  if (!hotelName || !subdomain) {
    return c.json({ error: 'Hotel name and subdomain are required' }, 400)
  }
  if (!staffAssignments || !Array.isArray(staffAssignments) || staffAssignments.length === 0) {
    return c.json({ error: 'At least one staff member must be assigned' }, 400)
  }
  if (!roomConfiguration || !Array.isArray(roomConfiguration) || roomConfiguration.length === 0) {
    return c.json({ error: 'Room configuration is required' }, 400)
  }

  const defaultPassword = 'changeme123'

  try {
    await db.transaction(async (tx) => {
      // 1. Create tenant
      const tenantResult = await tx.execute(sql`
        INSERT INTO tenants (id, name, subdomain, logo_url, address, phone, amenities, email_inbox_config, created_at, updated_at)
        VALUES (
          gen_random_uuid(),
          ${hotelName},
          ${subdomain},
          ${logoUrl || null},
          ${address ? JSON.stringify(address) : null}::jsonb,
          ${phone || null},
          ${amenities ? JSON.stringify(amenities) : null}::jsonb,
          ${emailInboxConfig ? JSON.stringify(emailInboxConfig) : null}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id
      `)
      const tenantId = tenantResult.rows[0].id

      // 2. Create rooms from room configuration
      if (roomConfiguration && roomConfiguration.length > 0) {
        for (const typeBlock of roomConfiguration) {
          const roomType = typeBlock.roomType || 'Standard'
          if (typeBlock.floors && Array.isArray(typeBlock.floors)) {
            for (const floorEntry of typeBlock.floors) {
              const floor = floorEntry.floor
              const count = floorEntry.count || 0
              // Generate room numbers: floor*100 + sequence starting at 1
              for (let i = 1; i <= count; i++) {
                const roomNumber = `${floor}${String(i).padStart(2, '0')}`
                await tx.execute(sql`
                  INSERT INTO rooms (id, tenant_id, room_number, floor, room_type, status, created_at, updated_at)
                  VALUES (gen_random_uuid(), ${tenantId}, ${roomNumber}, ${floor}, ${roomType}, 'dirty', NOW(), NOW())
                `)
              }
            }
          }
        }
      }

      // 3. Create staff
      for (const assignment of staffAssignments) {
        const { name, email, role, password, phone } = assignment
        if (!email || !role) continue
        const passwordToHash = password || defaultPassword
        const passwordHash = await bcrypt.hash(passwordToHash, 10)
        await tx.execute(sql`
          INSERT INTO staff (id, tenant_id, name, email, password_hash, role, phone, active, created_at, updated_at, is_super_admin)
          VALUES (gen_random_uuid(), ${tenantId}, ${name || email.split('@')[0]}, ${email}, ${passwordHash}, ${role}, ${phone || null}, true, NOW(), NOW(), false)
        `)
      }
    })

    return c.json({ success: true, message: `Hotel '${hotelName}' registered successfully` }, 201)
  } catch (err: any) {
    console.error('Hotel registration error:', err)
    return c.json({ error: err.message || 'Failed to register hotel' }, 500)
  }
})

export default superAdmin