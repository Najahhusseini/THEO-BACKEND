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
      SELECT r.room_number, r.room_type, r.floor
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