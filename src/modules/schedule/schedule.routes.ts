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
  const data = await getWeeklySchedule(user.tenantId, weekStart)
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
  const { scheduleId } = c.req.param()
  const result = await publishSchedule(scheduleId)
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