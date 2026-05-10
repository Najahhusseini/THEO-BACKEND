import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { getRoomsByTenant, updateRoomStatus } from './rooms.service'

const rooms = new Hono()

// Get all rooms for tenant
rooms.get('/', async (c) => {
  const user = c.get('user')
  console.log('Fetching rooms for tenant:', user.tenantId)
  const allRooms = await getRoomsByTenant(user.tenantId)
  return c.json(allRooms)
})

// Update room status
rooms.patch('/:roomId/status', async (c) => {
  const user = c.get('user')
  const { roomId } = c.req.param()
  const { status } = await c.req.json()

  if (!['dirty', 'cleaning', 'ready', 'inspected'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400)
  }

  const result = await updateRoomStatus(roomId, status, user.staffId)
  return c.json(result)
})

// Update room price (only when vacant and not expecting anyone today)
rooms.patch('/:roomId/price', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!['admin', 'manager', 'reservation_manager', 'frontdesk'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const { roomId } = c.req.param()
  const { price_per_night } = await c.req.json()
  if (price_per_night === undefined || price_per_night === null) {
    return c.json({ error: 'price_per_night required' }, 400)
  }

  try {
    const room = await db.execute(sql`
      SELECT room_number, out_of_order FROM rooms
      WHERE id = ${roomId} AND tenant_id = ${user.tenantId}
    `)
    if (room.rows.length === 0) return c.json({ error: 'Room not found' }, 404)
    if (room.rows[0].out_of_order) return c.json({ error: 'Room is out of order' }, 400)

    const roomNumber = room.rows[0].room_number
    const today = new Date().toISOString().split('T')[0]

    const activeStays = await db.execute(sql`
      SELECT id FROM stays
      WHERE room_number = ${roomNumber}
        AND status = 'checked_in'
      LIMIT 1
    `)
    const upcomingToday = await db.execute(sql`
      SELECT id FROM stays
      WHERE room_number = ${roomNumber}
        AND status = 'upcoming'
        AND arrival_date = ${today}
      LIMIT 1
    `)
    if (activeStays.rows.length > 0 || upcomingToday.rows.length > 0) {
      return c.json({ error: 'Price can only be changed when the room is vacant and not expecting a guest today.' }, 400)
    }

    await db.execute(sql`
      UPDATE rooms SET price_per_night = ${parseFloat(price_per_night)} WHERE id = ${roomId}
    `)

    return c.json({ success: true })
  } catch (err: any) {
    console.error('Price update error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// ✅ NEW: Update room notes
rooms.patch('/:roomId/notes', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!['admin', 'manager', 'frontdesk', 'reservation_manager', 'head_housekeeping'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const { roomId } = c.req.param()
  const { notes } = await c.req.json()   // expects an array of strings

  if (!Array.isArray(notes)) {
    return c.json({ error: 'notes must be an array' }, 400)
  }

  try {
    await db.execute(sql`
      UPDATE rooms SET notes = ${JSON.stringify(notes)}::jsonb WHERE id = ${roomId}
    `)
    return c.json({ success: true })
  } catch (err: any) {
    console.error('Notes update error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// Get rooms available for a specific date range
rooms.get('/available', async (c) => {
  const user = c.get('user')
  const arrival = c.req.query('arrival')
  const departure = c.req.query('departure')

  if (!arrival || !departure) {
    return c.json({ error: 'arrival and departure dates required' }, 400)
  }

  try {
    const result = await db.execute(sql`
      SELECT r.room_number, r.room_type, r.floor, r.price_per_night
      FROM rooms r
      WHERE r.tenant_id = ${user.tenantId}
        AND r.out_of_order = false
        AND NOT EXISTS (
          SELECT 1 FROM stays s
          WHERE s.room_number = r.room_number
            AND s.status != 'checked_out'
            AND (
              (s.arrival_date <= ${departure}::date AND s.departure_date >= ${arrival}::date)
            )
        )
      ORDER BY r.room_number
    `)
    return c.json(result.rows)
  } catch (err) {
    console.error(err)
    return c.json({ error: 'Failed to fetch available rooms' }, 500)
  }
})

export default rooms