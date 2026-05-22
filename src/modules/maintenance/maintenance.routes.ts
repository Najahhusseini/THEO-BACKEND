import { Hono } from 'hono'
import { getMaintenanceRooms, assignMaintenanceTask, updateMaintenanceTaskStatus, returnRoomToHousekeeping } from './maintenance.service'

const maintenance = new Hono()

// All routes require auth + maintenance role
maintenance.use('*', async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!['maintenance', 'head_maintenance', 'admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})

// Get all maintenance rooms
maintenance.get('/rooms', async (c) => {
  const { tenantId } = c.get('user')
  const rooms = await getMaintenanceRooms(tenantId)
  return c.json(rooms)
})

// Assign a task
maintenance.post('/tasks/:taskId/assign', async (c) => {
  const { tenantId } = c.get('user')
  const { taskId } = c.req.param()
  const { staffId } = await c.req.json()
  if (!staffId) return c.json({ error: 'staffId required' }, 400)

  await assignMaintenanceTask(taskId, staffId)
  return c.json({ success: true })
})

// Update task status (start / complete)
maintenance.patch('/tasks/:taskId/status', async (c) => {
  const { staffId } = c.get('user')
  const { taskId } = c.req.param()
  const { status } = await c.req.json()
  if (!['in_progress', 'completed'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400)
  }

  await updateMaintenanceTaskStatus(taskId, status, staffId)
  return c.json({ success: true })
})

// Return room to housekeeping
maintenance.post('/rooms/:roomId/return', async (c) => {
  const { staffId } = c.get('user')
  const { roomId } = c.req.param()

  const user = c.get('user')
  if (!['head_maintenance', 'admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await returnRoomToHousekeeping(roomId, staffId)
  return c.json({ success: true })
})

export default maintenance