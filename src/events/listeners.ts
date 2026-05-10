import { eventBus } from './eventBus'
import { sendNotificationToRoles } from '../modules/notifications/notification.service'
import { logAudit } from '../audit/audit.service'
import { db } from '../db'
import { sql } from 'drizzle-orm'
import { createFolio, closeFolio, createFinancialEvent } from '../modules/folio/folio.service'

export function registerListeners() {

  // ==================== RESERVATION EVENTS ====================

  eventBus.on('*', 'reservation.confirmed', async (payload: any) => {
    const { tenantId, reservation, staffId } = payload

    sendNotificationToRoles(tenantId, ['admin', 'manager', 'frontdesk', 'reservation_manager'], 
      '📋 Reservation Confirmed',
      `Reservation for ${reservation.guest_name} confirmed.`,
      'reservation_confirmed'
    ).catch(console.error)

    logAudit({
      tenantId, staffId,
      action: 'reservation.confirmed',
      entity: 'reservation', entityId: reservation.id,
      details: { guest: reservation.guest_name }
    }).catch(console.error)

    try {
      const stayResult = await db.execute(sql`
        SELECT id, guest_name FROM stays WHERE reservation_id = ${reservation.id} ORDER BY created_at DESC LIMIT 1
      `)
      if (stayResult.rows.length > 0) {
        const stay = stayResult.rows[0]
        await createFolio(stay.id, reservation.id, stay.guest_name)
        console.log(`Folio created for stay ${stay.id}`)
      }
    } catch (err) {
      console.error('Failed to create folio on reservation.confirmed:', err)
    }
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

    sendNotificationToRoles(tenantId, ['housekeeping', 'head_housekeeping'],
      '🛏️ Room Assigned',
      `Room ${roomNumber} assigned to ${guestName}.`,
      'room_assigned'
    ).catch(console.error)

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

  // ==================== CHECK‑OUT / FOLIO CLOSE + FINANCIAL EVENT + ROOM CLEANING ====================

  eventBus.on('*', 'guest.checked_out', async (payload: any) => {
    const { tenantId, stayId, guestName, roomNumber } = payload

    sendNotificationToRoles(tenantId, ['admin', 'manager', 'frontdesk'],
      '🏁 Guest Checked Out',
      `${guestName} checked out of Room ${roomNumber}.`,
      'info'
    ).catch(console.error)

    logAudit({
      tenantId,
      action: 'guest.checked_out',
      entity: 'stay', entityId: stayId,
      details: { guestName, roomNumber }
    }).catch(console.error)

    // Close folio & create financial event
    try {
      await closeFolio(stayId)
      console.log(`Folio closed for stay ${stayId}`)
      await createFinancialEvent(tenantId, stayId)
      console.log(`Financial event created for stay ${stayId}`)
    } catch (err) {
      console.error('Failed to process checkout financial workflow:', err)
    }

    // ✅ Mark room dirty and create cleaning request
    try {
      // Update room status to dirty
      await db.execute(sql`
        UPDATE rooms SET cleaning_status = 'dirty', last_cleaning_update = NOW()
        WHERE room_number = ${roomNumber}
      `)

      // Create a cleaning request if not already exists
      const existing = await db.execute(sql`
        SELECT id FROM cleaning_requests
        WHERE room_id = (SELECT id FROM rooms WHERE room_number = ${roomNumber})
          AND status IN ('pending','assigned','in_progress')
        LIMIT 1
      `)
      if (existing.rows.length === 0) {
        await db.execute(sql`
          INSERT INTO cleaning_requests (room_id, requested_by, request_type, notes, status)
          VALUES (
            (SELECT id FROM rooms WHERE room_number = ${roomNumber}),
            (SELECT id FROM staff WHERE tenant_id = ${tenantId} AND role = 'head_housekeeping' LIMIT 1),
            'checkout',
            'Auto-created after check-out',
            'pending'
          )
        `)
      }

      // Notify housekeeping
      sendNotificationToRoles(tenantId, ['housekeeping', 'head_housekeeping'],
        '🧹 Checkout Cleaning Needed',
        `Room ${roomNumber} is now dirty after guest check‑out.`,
        'cleaning'
      ).catch(console.error)

      console.log(`Room ${roomNumber} marked dirty and cleaning request created`)
    } catch (err) {
      console.error('Failed to mark room dirty on checkout:', err)
    }
  })

  // ==================== CLEANING EVENTS ====================

  eventBus.on('*', 'cleaning.requested', (payload: any) => {
    const { tenantId, roomId, roomNumber, requestType, staffId } = payload
    sendNotificationToRoles(tenantId, ['housekeeping', 'head_housekeeping'],
      '🧹 New Cleaning Request',
      `Room ${roomNumber} needs cleaning (${requestType}).`,
      'cleaning'
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

  // ==================== ATTENDANCE CLOCK‑IN AUTO‑ASSIGN ====================

  eventBus.on('*', 'attendance.clock_in', async (payload: any) => {
    const { staffId, tenantId, role } = payload;
    // Only for housekeeping staff
    if (role !== 'housekeeping' && role !== 'head_housekeeping') return;

    const today = new Date().toISOString().split('T')[0];
    const scheduled = await db.execute(sql`
      SELECT id, room_id FROM cleaning_requests 
      WHERE assigned_to = ${staffId}
        AND status = 'scheduled'
        AND DATE(assigned_at) = ${today}
    `);

    for (const row of scheduled.rows) {
      await db.execute(sql`
        UPDATE cleaning_requests SET status = 'assigned' WHERE id = ${row.id}
      `);
      await db.execute(sql`
        UPDATE rooms SET assigned_cleaner_id = ${staffId}, cleaning_status = 'dirty' WHERE id = ${row.room_id}
      `);
    }

    if (scheduled.rows.length > 0) {
      console.log(`Auto-assigned ${scheduled.rows.length} rooms to staff ${staffId} on clock-in.`);
    }
  });
}