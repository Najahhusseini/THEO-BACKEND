import { Hono } from 'hono'
import { clockIn, clockOut, getCurrentStatus, getTodayAttendance, getWeeklyHours, getShiftHistory, requestTimeOff, getTimeOffRequests, updateTimeOffRequest } from './attendance.service'

const attendance = new Hono()

// Clock in
attendance.post('/clock-in', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await clockIn(user.staffId, body.location, body.deviceInfo)
    return c.json({ success: true, message: 'Clocked in successfully', data: result })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// Clock out
attendance.post('/clock-out', async (c) => {
  const user = c.get('user')
  try {
    const result = await clockOut(user.staffId)
    return c.json({ success: true, message: 'Clocked out successfully', data: result })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// Get current status (for current staff member)
attendance.get('/status', async (c) => {
  const user = c.get('user')
  const status = await getCurrentStatus(user.staffId)
  return c.json(status)
})

// Get today's attendance for the current staff member (not just managers)
attendance.get('/today', async (c) => {
  const user = c.get('user')
  // Get only the current staff member's attendance for today
  const attendanceData = await getTodayAttendance(user.staffId)
  return c.json(attendanceData)
})

// Get weekly hours for the current staff member
attendance.get('/weekly-hours', async (c) => {
  const user = c.get('user')
  const weeklyHours = await getWeeklyHours(user.staffId)
  return c.json(weeklyHours)
})

// Get shift history for the current staff member
attendance.get('/history', async (c) => {
  const user = c.get('user')
  const days = parseInt(c.req.query('days') || '30')
  const history = await getShiftHistory(user.staffId, days)
  return c.json(history)
})

// Request time off
attendance.post('/time-off', async (c) => {
  const user = c.get('user')
  const { startDate, endDate, reason } = await c.req.json()
  try {
    const result = await requestTimeOff(user.staffId, new Date(startDate), new Date(endDate), reason)
    return c.json({ success: true, message: 'Time off request submitted', data: result })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// Get time off requests (manager only - view all team requests)
attendance.get('/time-off-requests', async (c) => {
  const user = c.get('user')
  if (user.role !== 'admin' && user.role !== 'manager') {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const status = c.req.query('status')
  const requests = await getTimeOffRequests(user.tenantId, status)
  return c.json(requests)
})

// Update time off request (manager only)
attendance.patch('/time-off-requests/:id', async (c) => {
  const user = c.get('user')
  if (user.role !== 'admin' && user.role !== 'manager') {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const { id } = c.req.param()
  const { status } = await c.req.json()
  try {
    const result = await updateTimeOffRequest(id, status, user.staffId)
    return c.json({ success: true, message: `Request ${status}`, data: result })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

export default attendance