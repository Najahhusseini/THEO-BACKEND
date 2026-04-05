import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import auth from './modules/auth/auth.routes'
import rooms from './modules/rooms/rooms.routes'
import attendance from './modules/attendance/attendance.routes'
import schedule from './modules/schedule/schedule.routes'
import { authMiddleware } from './middleware/auth'
import 'dotenv/config'

const app = new Hono()

// Global middleware
app.use('*', logger())
app.use('*', cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://192.168.8.206:3000', 'http://192.168.9.125:3000'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))
app.use('*', secureHeaders())

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

// API home
app.get('/api', (c) => c.json({ message: 'THEO Mini API v1' }))

const port = parseInt(process.env.PORT || '4000')

serve({
  fetch: app.fetch,
  port,
})

console.log(`🚀 THEO Mini backend running at http://localhost:${port}`)
console.log(`📡 Health check: http://localhost:${port}/health`)
console.log(`🔐 Auth endpoint: http://localhost:${port}/api/auth/login`)
console.log(`🏨 Rooms endpoint: http://localhost:${port}/api/rooms`)
console.log(`⏰ Attendance endpoint: http://localhost:${port}/api/attendance`)
console.log(`📅 Schedule endpoint: http://localhost:${port}/api/schedule`)