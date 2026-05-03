import { Hono } from 'hono'
import { 
    saveSubscription, 
    sendNotificationToTenant, 
    initWebPush,
    getNotificationsForStaff,
    getUnreadCountForStaff,
    markAsRead,
    markAllAsRead
} from './notification.service'

const notifications = new Hono()

// Initialize web-push on module load
initWebPush()

// Save push subscription
notifications.post('/subscribe', async (c) => {
  const user = c.get('user')
  const subscription = await c.req.json()
  
  try {
    await saveSubscription(user.staffId, subscription)
    return c.json({ success: true, message: 'Subscribed to notifications' })
  } catch (error) {
    console.error('Subscribe error:', error)
    return c.json({ success: false, error: 'Failed to subscribe' }, 500)
  }
})

// Get notifications for current user (role-based filtering)
notifications.get('/', async (c) => {
  const user = c.get('user')
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = parseInt(c.req.query('offset') || '0')
  
  try {
    const notifications = await getNotificationsForStaff(user.staffId, user.role, limit, offset)
    const unreadCount = await getUnreadCountForStaff(user.staffId, user.role)
    return c.json({ notifications, unreadCount })
  } catch (error) {
    console.error('Error fetching notifications:', error)
    return c.json({ error: 'Failed to fetch notifications' }, 500)
  }
})

// Get unread count
notifications.get('/unread-count', async (c) => {
  const user = c.get('user')
  
  try {
    const count = await getUnreadCountForStaff(user.staffId, user.role)
    return c.json({ unreadCount: count })
  } catch (error) {
    console.error('Error fetching unread count:', error)
    return c.json({ error: 'Failed to fetch unread count' }, 500)
  }
})

// Mark a notification as read
notifications.patch('/:id/read', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  
  try {
    await markAsRead(id, user.staffId)
    return c.json({ success: true })
  } catch (error) {
    console.error('Error marking notification as read:', error)
    return c.json({ error: 'Failed to mark as read' }, 500)
  }
})

// Mark all notifications as read
notifications.post('/mark-all-read', async (c) => {
  const user = c.get('user')
  
  try {
    await markAllAsRead(user.staffId)
    return c.json({ success: true })
  } catch (error) {
    console.error('Error marking all as read:', error)
    return c.json({ error: 'Failed to mark all as read' }, 500)
  }
})

// Test send notification (for debugging)
notifications.post('/test', async (c) => {
  const user = c.get('user')
  const { title, body } = await c.req.json()
  
  const result = await sendNotificationToTenant(
    user.tenantId,
    title || 'Test Notification',
    body || 'This is a test notification from THEO Mini'
  )
  
  return c.json(result)
})

export default notifications