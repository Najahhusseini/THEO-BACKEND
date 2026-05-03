import { Hono } from 'hono'
import { 
  getShiftTypes, 
  getStaffForTenant, 
  getWeeklySchedule, 
  saveScheduleShifts,
  publishSchedule,
  getStaffSchedule,
  getExpectedArrivals
} from './schedule.service'
import { sendNotificationToTenant } from '../notifications/notification.service'

const schedule = new Hono()

// Get shift types
schedule.get('/shift-types', async (c) => {
  const types = await getShiftTypes()
  return c.json(types)
})

// Get staff for tenant
schedule.get('/staff', async (c) => {
  const user = c.get('user')
  const staff = await getStaffForTenant(user.tenantId)
  return c.json(staff)
})

// Get weekly schedule
schedule.get('/weekly/:weekStart', async (c) => {
  const user = c.get('user')
  const { weekStart } = c.req.param()
  const department = c.req.query('department') || 'all'
  const data = await getWeeklySchedule(user.tenantId, weekStart, department)
  return c.json(data)
})

// Get expected arrivals for the week
schedule.get('/arrivals/:weekStart', async (c) => {
  const user = c.get('user')
  const { weekStart } = c.req.param()
  const arrivals = await getExpectedArrivals(user.tenantId, weekStart)
  return c.json(arrivals)
})

// Save schedule shifts
schedule.post('/save', async (c) => {
  const user = c.get('user')
  const { scheduleId, shifts } = await c.req.json()
  const result = await saveScheduleShifts(scheduleId, shifts)
  return c.json(result)
})

// Publish schedule
schedule.post('/publish/:scheduleId', async (c) => {
  const user = c.get('user')
  const { scheduleId } = c.req.param()
  const result = await publishSchedule(scheduleId)
  
  // Send notifications to all staff
  if (result) {
    const weekStart = result.week_start_date
    const weekEnd = result.week_end_date
    const formattedStart = new Date(weekStart).toLocaleDateString()
    const formattedEnd = new Date(weekEnd).toLocaleDateString()
    
    // Send notification asynchronously (don't wait for it to complete)
    sendNotificationToTenant(
      user.tenantId,
      '📅 New Schedule Published',
      `The schedule for ${formattedStart} - ${formattedEnd} has been published. Check your shifts!`,
      '/schedule-icon.png',
      '/dashboard?tab=schedule'
    ).catch(err => console.error('Failed to send notifications:', err))
  }
  
  return c.json(result)
})
// Get my schedule (for staff)
schedule.get('/my-schedule', async (c) => {
  const user = c.get('user')
  const weekStart = c.req.query('weekStart')
  const scheduleData = await getStaffSchedule(user.staffId, weekStart)
  return c.json(scheduleData)
})

export default schedule