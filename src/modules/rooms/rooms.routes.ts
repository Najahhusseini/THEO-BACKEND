import { Hono } from 'hono'
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

export default rooms