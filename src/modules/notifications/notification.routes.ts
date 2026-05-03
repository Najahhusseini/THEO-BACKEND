import { Hono } from 'hono'
import { saveSubscription, sendNotificationToTenant, initWebPush } from './notification.service'

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