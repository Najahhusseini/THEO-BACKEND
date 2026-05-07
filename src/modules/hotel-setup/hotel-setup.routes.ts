import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

const hotelSetup = new Hono()

// POST /api/hotel-setup/register
hotelSetup.post('/register', async (c) => {
  // Only admin or manager can register hotels
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json()
  const {
    hotelName,
    subdomain,
    floors,
    roomsPerFloor,
    roomNumbers,           // optional: custom list of room numbers; if provided, overrides floors/roomsPerFloor
    staffAssignments,      // { role: string, email: string }[]
    amenities,             // array of strings (future use)
  } = body

  if (!hotelName || !subdomain) {
    return c.json({ error: 'Hotel name and subdomain are required' }, 400)
  }

  // Validate staff assignments
  if (!staffAssignments || !Array.isArray(staffAssignments) || staffAssignments.length === 0) {
    return c.json({ error: 'At least one staff member must be assigned' }, 400)
  }

  // Validate room list
  let finalRoomNumbers: string[] = []
  if (roomNumbers && Array.isArray(roomNumbers) && roomNumbers.length > 0) {
    finalRoomNumbers = roomNumbers
  } else if (floors && roomsPerFloor) {
    // Generate room numbers: floor + two-digit number, e.g. 101, 102, ...
    for (let floor = 1; floor <= floors; floor++) {
      for (let room = 1; room <= roomsPerFloor; room++) {
        const roomNumber = `${floor}${String(room).padStart(2, '0')}`
        finalRoomNumbers.push(roomNumber)
      }
    }
  } else {
    return c.json({ error: 'Either roomNumbers array or floors + roomsPerFloor is required' }, 400)
  }

  // Generate a password for each staff (they can change later)
  const defaultPassword = 'changeme123'  // you might want to generate a random one later

  try {
    // Use a database transaction to ensure atomicity
    await db.transaction(async (tx) => {
      // 1. Create the tenant
      const tenantResult = await tx.execute(sql`
        INSERT INTO tenants (id, name, subdomain, created_at, updated_at)
        VALUES (gen_random_uuid(), ${hotelName}, ${subdomain}, NOW(), NOW())
        RETURNING id
      `)
      const tenantId = tenantResult.rows[0].id

      // 2. Create rooms
      for (const roomNumber of finalRoomNumbers) {
        // Determine floor from room number? simplest: first digit(s) as floor
        const floor = parseInt(roomNumber.match(/^\d+/)?.[0] || '1')
        await tx.execute(sql`
          INSERT INTO rooms (id, tenant_id, room_number, floor, room_type, status, created_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantId}, ${roomNumber}, ${floor}, 'Standard', 'dirty', NOW(), NOW())
        `)
      }

      // 3. Create staff members
      for (const assignment of staffAssignments) {
        const { role, email } = assignment
        if (!role || !email) continue
        // Check if staff already exists globally (email unique?)
        // We'll allow same email across tenants? For now, assume unique per tenant.
        const passwordHash = await bcrypt.hash(defaultPassword, 10)
        await tx.execute(sql`
          INSERT INTO staff (id, tenant_id, name, email, password_hash, role, active, created_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantId}, ${email.split('@')[0]}, ${email}, ${passwordHash}, ${role}, true, NOW(), NOW())
        `)
      }
    })

    return c.json({ success: true, message: `Hotel '${hotelName}' registered successfully` }, 201)
  } catch (err: any) {
    console.error('Hotel registration error:', err)
    return c.json({ error: err.message || 'Failed to register hotel' }, 500)
  }
})

export default hotelSetup