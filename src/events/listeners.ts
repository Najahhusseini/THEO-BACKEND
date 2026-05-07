import { eventBus } from './eventBus'
import { sendNotificationToRoles } from '../modules/notifications/notification.service'
import { logAudit } from '../audit/audit.service'

/**
 * Register all cross-module event listeners.
 * Called once at startup.
 */
export function registerListeners() {

  // ==================== RESERVATION EVENTS ====================

  eventBus.on('*', 'reservation.confirmed', (payload: any) => {
    const { tenantId, reservation, staffId } = payload
    sendNotificationToRoles(tenantId, ['admin', 'manager', 'frontdesk', 'reservation_manager'], 
      '📋 Reservation Confirmed',
      `Reservation for ${reservation.guest_name} confirmed.`,
      'reservation_confirmed'  // type used in role filter
    ).catch(console.error)
    logAudit({
      tenantId, staffId,
      action: 'reservation.confirmed',
      entity: 'reservation', entityId: reservation.id,
      details: { guest: reservation.guest_name }
    }).catch(console.error)
  })

  eventBus.on('*', 'reservation.cancelled', (payload: any) => {
    const { tenantId, reservation, staffId } = payload
    sendNotificationToRoles(tenantId, ['admin', 'manager', 'frontdesk', 'reservation_manager'],
      '❌ Reservation Cancelled',
      `Reservation for ${reservation.guest_name} cancelled.`,
      'reservation_cancelled'
    ).catch(console.error)
    logAudit({
      tenantId, staffId,
      action: 'reservation.cancelled',
      entity: 'reservation', entityId: reservation.id,
    }).catch(console.error)
  })

  eventBus.on('*', 'room.assigned', (payload: any) => {
    const { tenantId, reservationId, roomNumber, guestName, staffId } = payload

    // Housekeeping (they need to know about the room)
    sendNotificationToRoles(tenantId, ['housekeeping', 'head_housekeeping'],
      '🛏️ Room Assigned',
      `Room ${roomNumber} assigned to ${guestName}.`,
      'room_assigned'
    ).catch(console.error)

    // Front desk & admin
    sendNotificationToRoles(tenantId, ['admin', 'manager', 'frontdesk'],
      '🛏️ Room Assigned',
      `Room ${roomNumber} assigned to ${guestName}.`,
      'room_assigned'
    ).catch(console.error)

    logAudit({
      tenantId, staffId,
      action: 'room.assigned',
      entity: 'reservation', entityId: reservationId,
      details: { roomNumber, guestName }
    }).catch(console.error)
  })

  eventBus.on('*', 'guest.checked_in', (payload: any) => {
    const { tenantId, stayId, reservationId, guestName, roomNumber, staffId } = payload
    sendNotificationToRoles(tenantId, ['admin', 'manager', 'frontdesk', 'reservation_manager'],
      '✅ Guest Checked In',
      `${guestName} checked into Room ${roomNumber}.`,
      'guest_checked_in'
    ).catch(console.error)
    logAudit({
      tenantId, staffId,
      action: 'guest.checked_in',
      entity: 'stay', entityId: stayId,
      details: { guestName, roomNumber }
    }).catch(console.error)
  })

  // ==================== CLEANING EVENTS ====================

  eventBus.on('*', 'cleaning.requested', (payload: any) => {
    const { tenantId, roomId, roomNumber, requestType, staffId } = payload
    sendNotificationToRoles(tenantId, ['housekeeping', 'head_housekeeping'],
      '🧹 New Cleaning Request',
      `Room ${roomNumber} needs cleaning (${requestType}).`,
      'cleaning'   // using 'cleaning' to match filter
    ).catch(console.error)
    logAudit({
      tenantId, staffId,
      action: 'cleaning.requested',
      entity: 'room', entityId: roomId,
      details: { roomNumber, requestType }
    }).catch(console.error)
  })

  eventBus.on('*', 'cleaning.completed', (payload: any) => {
    const { tenantId, roomId, roomNumber, staffId } = payload
    sendNotificationToRoles(tenantId, ['head_housekeeping', 'admin', 'manager', 'frontdesk'],
      '✅ Room Ready for Inspection',
      `Room ${roomNumber} cleaning completed. Ready for inspection.`,
      'inspection'
    ).catch(console.error)
    logAudit({
      tenantId, staffId,
      action: 'cleaning.completed',
      entity: 'room', entityId: roomId,
      details: { roomNumber }
    }).catch(console.error)
  })

  eventBus.on('*', 'room.status_changed', (payload: any) => {
    const { tenantId, roomId, roomNumber, oldStatus, newStatus, staffId } = payload
    logAudit({
      tenantId, staffId,
      action: 'room.status_changed',
      entity: 'room', entityId: roomId,
      details: { roomNumber, oldStatus, newStatus }
    }).catch(console.error)
  })

  eventBus.on('*', 'room.out_of_order', (payload: any) => {
    const { tenantId, roomId, roomNumber, reason, staffId } = payload
    sendNotificationToRoles(tenantId, ['admin', 'manager', 'frontdesk', 'head_housekeeping'],
      '🚫 Room Out of Order',
      `Room ${roomNumber} marked out of order: ${reason}`,
      'room_out_of_order'
    ).catch(console.error)
    logAudit({
      tenantId, staffId,
      action: 'room.out_of_order',
      entity: 'room', entityId: roomId,
      details: { roomNumber, reason }
    }).catch(console.error)
  })

  eventBus.on('*', 'room.back_in_service', (payload: any) => {
    const { tenantId, roomId, roomNumber, staffId } = payload
    sendNotificationToRoles(tenantId, ['admin', 'manager', 'frontdesk', 'head_housekeeping'],
      '✅ Room Back in Service',
      `Room ${roomNumber} is now back in service.`,
      'info'
    ).catch(console.error)
    logAudit({
      tenantId, staffId,
      action: 'room.back_in_service',
      entity: 'room', entityId: roomId,
      details: { roomNumber }
    }).catch(console.error)
  })
}