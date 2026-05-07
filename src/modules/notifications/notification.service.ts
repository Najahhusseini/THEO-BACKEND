import { db } from '../../db'
import { sql } from 'drizzle-orm'
import webpush from 'web-push'

// Configure web-push with VAPID keys
export function initWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  
  if (publicKey && privateKey) {
    const cleanPublicKey = publicKey.replace(/=+$/, '')
    webpush.setVapidDetails(
      'mailto:notifications@theo-mini.com',
      cleanPublicKey,
      privateKey
    )
    console.log('WebPush initialized successfully')
  } else {
    console.warn('VAPID keys not set - push notifications disabled')
  }
}

// Save subscription for a staff member
export async function saveSubscription(
  staffId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
  const existing = await db.execute(sql`
    SELECT id FROM notification_subscriptions 
    WHERE staff_id = ${staffId} AND endpoint = ${subscription.endpoint}
  `)
  
  if (existing.rows.length > 0) {
    await db.execute(sql`
      UPDATE notification_subscriptions 
      SET p256dh = ${subscription.keys.p256dh}, 
          auth = ${subscription.keys.auth},
          updated_at = NOW()
      WHERE staff_id = ${staffId} AND endpoint = ${subscription.endpoint}
    `)
  } else {
    await db.execute(sql`
      INSERT INTO notification_subscriptions (staff_id, endpoint, p256dh, auth)
      VALUES (${staffId}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
    `)
  }
  
  return { success: true }
}

// Get all subscriptions for a tenant's staff
export async function getSubscriptionsForTenant(tenantId: string) {
  const result = await db.execute(sql`
    SELECT ns.* 
    FROM notification_subscriptions ns
    JOIN staff s ON ns.staff_id = s.id
    WHERE s.tenant_id = ${tenantId}
  `)
  return result.rows
}

// Send push notification to all staff in a tenant
export async function sendNotificationToTenant(
  tenantId: string,
  title: string,
  body: string,
  icon?: string,
  url?: string
) {
  initWebPush()
  
  const subscriptions = await getSubscriptionsForTenant(tenantId)
  
  const results = {
    sent: 0,
    failed: 0,
    errors: [] as string[],
  }
  
  for (const sub of subscriptions) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    }
    
    const payload = JSON.stringify({
      title,
      body,
      icon: icon || '/theo-icon.png',
      data: {
        url: url || '/dashboard?tab=schedule',
      },
    })
    
    try {
      await webpush.sendNotification(pushSubscription, payload)
      results.sent++
    } catch (error: any) {
      results.failed++
      results.errors.push(error.message)
      if (error.statusCode === 410 || error.statusCode === 404) {
        await db.execute(sql`
          DELETE FROM notification_subscriptions WHERE endpoint = ${sub.endpoint}
        `)
      }
    }
  }
  
  console.log(`Push notifications sent: ${results.sent} succeeded, ${results.failed} failed`)
  return results
}

// ============ IN‑APP NOTIFICATIONS (database) ============

// Send notification to a specific staff member
export async function sendNotificationToStaff(
  staffId: string,
  title: string,
  message: string,
  type: string = 'info',
  data?: any
) {
  const result = await db.execute(sql`
    INSERT INTO notifications (staff_id, title, message, type, data)
    VALUES (${staffId}, ${title}, ${message}, ${type}, ${data ? JSON.stringify(data) : null})
    RETURNING id
  `)
  return result.rows[0]
}

// Send notification to all staff of a specific role
export async function sendNotificationToRole(
  tenantId: string,
  role: string,
  title: string,
  message: string,
  type: string = 'info',
  data?: any
) {
  const staffList = await db.execute(sql`
    SELECT id FROM staff
    WHERE tenant_id = ${tenantId}
      AND role = ${role}
      AND active = true
  `)
  
  let count = 0
  for (const staff of staffList.rows) {
    await db.execute(sql`
      INSERT INTO notifications (staff_id, title, message, type, data)
      VALUES (${staff.id}, ${title}, ${message}, ${type}, ${JSON.stringify(data || {})})
    `)
    count++
  }
  
  return { sent: count }
}

// ✅ FINAL FIXED: Send notification to ALL staff of MULTIPLE roles
export async function sendNotificationToRoles(
  tenantId: string,
  roles: string[],
  title: string,
  message: string,
  type: string = 'info',
  data?: any
) {
  // Build a literal PostgreSQL array: ARRAY['role1','role2']
  const escapedRoles = roles.map(r => `'${r.replace(/'/g, "''")}'`).join(', ')
  const roleArray = sql.raw(`ARRAY[${escapedRoles}]::text[]`)

  const staffList = await db.execute(sql`
    SELECT id FROM staff
    WHERE tenant_id = ${tenantId}
      AND role = ANY(${roleArray})
      AND active = true
  `)

  let count = 0
  for (const staff of staffList.rows) {
    await db.execute(sql`
      INSERT INTO notifications (staff_id, title, message, type, data)
      VALUES (${staff.id}, ${title}, ${message}, ${type}, ${JSON.stringify(data || {})})
    `)
    count++
  }

  return { sent: count }
}

// Get notifications for a staff member with role-based filtering
export async function getNotificationsForStaff(
  staffId: string,
  role: string,
  limit: number = 20,
  offset: number = 0
) {
  let roleFilter = ''
  
  switch(role) {
    case 'head_housekeeping':
      roleFilter = `AND type IN ('cleaning', 'inspection', 'supply', 'alert', 'task', 'room_assigned', 'room_completed', 'guest_moved', 'room_out_of_order')`
      break
    case 'housekeeping':
      roleFilter = `AND type IN ('cleaning', 'task', 'room_assigned', 'guest_moved', 'inspection')`
      break
    case 'admin':
    case 'manager':
      roleFilter = ``
      break
    case 'frontdesk':
      roleFilter = `AND type IN ('room_assigned', 'guest_checked_in', 'guest_moved', 'room_ready', 'room_out_of_order', 'alert', 'info')`
      break
    case 'reservation_manager':
      roleFilter = `AND type IN ('reservation_confirmed', 'reservation_cancelled', 'reservation_created', 'room_assigned', 'guest_checked_in', 'info', 'alert')`
      break
    case 'maintenance':
      roleFilter = `AND type IN ('maintenance', 'alert', 'task')`
      break
    default:
      roleFilter = `AND type IN ('info', 'alert')`
  }
  
  const result = await db.execute(sql`
    SELECT id, title, message, type, is_read, created_at, data
    FROM notifications
    WHERE staff_id = ${staffId} ${sql.raw(roleFilter)}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)
  return result.rows
}

// Get unread count for a staff member with role-based filtering
export async function getUnreadCountForStaff(staffId: string, role: string): Promise<number> {
  let roleFilter = ''
  
  switch(role) {
    case 'head_housekeeping':
      roleFilter = `AND type IN ('cleaning', 'inspection', 'supply', 'alert', 'task', 'room_assigned', 'room_completed', 'guest_moved', 'room_out_of_order')`
      break
    case 'housekeeping':
      roleFilter = `AND type IN ('cleaning', 'task', 'room_assigned', 'guest_moved', 'inspection')`
      break
    case 'admin':
    case 'manager':
      roleFilter = ``
      break
    case 'frontdesk':
      roleFilter = `AND type IN ('room_assigned', 'guest_checked_in', 'guest_moved', 'room_ready', 'room_out_of_order', 'alert', 'info')`
      break
    case 'reservation_manager':
      roleFilter = `AND type IN ('reservation_confirmed', 'reservation_cancelled', 'reservation_created', 'room_assigned', 'guest_checked_in', 'info', 'alert')`
      break
    case 'maintenance':
      roleFilter = `AND type IN ('maintenance', 'alert', 'task')`
      break
    default:
      roleFilter = `AND type IN ('info', 'alert')`
  }
  
  const result = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM notifications
    WHERE staff_id = ${staffId} AND is_read = false ${sql.raw(roleFilter)}
  `)
  return parseInt(result.rows[0]?.count || '0')
}

// Legacy function - keep for backward compatibility
export async function createNotification(
  staffId: string,
  title: string,
  message: string,
  type: string = 'info',
  data?: any
) {
  return sendNotificationToStaff(staffId, title, message, type, data)
}

export async function getNotifications(
  staffId: string,
  limit: number = 20,
  offset: number = 0
) {
  const result = await db.execute(sql`
    SELECT id, title, message, type, is_read, created_at, data
    FROM notifications
    WHERE staff_id = ${staffId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)
  return result.rows
}

export async function getUnreadCount(staffId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM notifications
    WHERE staff_id = ${staffId} AND is_read = false
  `)
  return parseInt(result.rows[0]?.count || '0')
}

export async function markAsRead(notificationId: string, staffId: string) {
  await db.execute(sql`
    UPDATE notifications
    SET is_read = true
    WHERE id = ${notificationId} AND staff_id = ${staffId}
  `)
}

export async function markAllAsRead(staffId: string) {
  await db.execute(sql`
    UPDATE notifications
    SET is_read = true
    WHERE staff_id = ${staffId} AND is_read = false
  `)
}