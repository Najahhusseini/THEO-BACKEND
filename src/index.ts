import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import auth from './modules/auth/auth.routes'
import rooms from './modules/rooms/rooms.routes'
import attendance from './modules/attendance/attendance.routes'
import cleaning from './modules/cleaning/cleaning.routes'
import schedule from './modules/schedule/schedule.routes'
import tasks from './modules/tasks/tasks.routes'
import supplies from './modules/supplies/supplies.routes'
import notifications from './modules/notifications/notifications.routes'
import reservations from './modules/reservations/reservation.routes'
import emailRouter from './modules/email/email.routes'
import superAdmin from './modules/super-admin/super-admin.routes'
import adminStaff from './modules/admin-staff/admin-staff.routes'
import guestsRoutes from './modules/guests/guests.routes'
import { authMiddleware } from './middleware/auth'
import { errorHandler } from './middleware/errorHandler'
import { registerListeners } from './events/listeners'   // ✅ NEW
import 'dotenv/config'

const app = new Hono()

// Global middleware
app.use('*', logger())
app.use('*', cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://192.168.1.112:3000', 'http://192.168.1.109:3000'], 
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}))
app.use('*', secureHeaders())
app.use('*', errorHandler)

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// Auth routes (no auth needed)
app.route('/api/auth', auth)

// Protected routes (auth required)
app.use('/api/rooms/*', authMiddleware)
app.route('/api/rooms', rooms)

app.use('/api/attendance/*', authMiddleware)
app.route('/api/attendance', attendance)

app.use('/api/schedule/*', authMiddleware)
app.route('/api/schedule', schedule)

app.use('/api/notifications/*', authMiddleware)
app.route('/api/notifications', notifications)

app.use('/api/cleaning/*', authMiddleware)
app.route('/api/cleaning', cleaning)

app.use('/api/tasks/*', authMiddleware)
app.route('/api/tasks', tasks)

app.use('/api/supplies/*', authMiddleware)
app.route('/api/supplies', supplies)

app.use('/api/super-admin/*', authMiddleware)
app.route('/api/super-admin', superAdmin)

app.use('/api/admin-staff/*', authMiddleware)
app.route('/api/admin-staff', adminStaff)

app.use('/api/guests/*', authMiddleware)
app.route('/api/guests', guestsRoutes)

// Reservations: protect all except public-test
app.use('/api/reservations/*', async (c, next) => {
    if (c.req.path === '/public-test') return next()
    return authMiddleware(c, next)
})
app.route('/api/reservations', reservations)

// Email ingestion routes
app.use('/api/emails/*', authMiddleware)
app.route('/api/emails', emailRouter)

// ✅ Register cross-module event listeners
registerListeners()

// API home
app.get('/api', (c) => c.json({ message: 'THEO Mini API v1' }))

const port = parseInt(process.env.PORT || '4000')

serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0',
})

console.log(`🚀 THEO Mini backend running at http://localhost:${port}`)
console.log(`📡 Health check: http://localhost:${port}/health`)
console.log(`🔐 Auth endpoint: http://localhost:${port}/api/auth/login`)
console.log(`🏨 Rooms endpoint: http://localhost:${port}/api/rooms`)
console.log(`⏰ Attendance endpoint: http://localhost:${port}/api/attendance`)
console.log(`📅 Schedule endpoint: http://localhost:${port}/api/schedule`)
console.log(`📢 Notifications endpoint: http://localhost:${port}/api/notifications`)
console.log(`🧹 Cleaning endpoint: http://localhost:${port}/api/cleaning`)
console.log(`📦 Supplies endpoint: http://localhost:${port}/api/supplies`)