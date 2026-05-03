import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { sendNotificationToTenant } from '../notifications/notification.service'
import { createTask } from '../tasks/tasks.service'

// Helper: Send in-app notification to all housekeeping staff (including head)
async function notifyAllHousekeepingStaff(tenantId: string, title: string, message: string, type: string, data?: any) {
    const staffList = await db.execute(sql`
        SELECT id FROM staff
        WHERE tenant_id = ${tenantId}
          AND role IN ('housekeeping', 'head_housekeeping')
          AND active = true
    `);
    for (const staff of staffList.rows) {
        await db.execute(sql`
            INSERT INTO notifications (staff_id, title, message, type, data, is_read)
            VALUES (${staff.id}, ${title}, ${message}, ${type}, ${JSON.stringify(data || {})}, false)
        `);
    }
}

// ============ GET DATA ============

export async function getRoomsWithCleaning(tenantId: string) {
    const today = new Date().toISOString().split('T')[0];

    const result = await db.execute(sql`
        WITH 
        active_bookings AS (
            SELECT DISTINCT ON (b.room_id)
                b.room_id,
                b.guest_name,
                b.check_in_date,
                b.check_out_date
            FROM bookings b
            WHERE b.tenant_id = ${tenantId}
              AND b.check_in_date <= ${today}
              AND b.check_out_date > ${today}
            ORDER BY b.room_id, b.check_out_date DESC
        ),
        checkout_bookings AS (
            SELECT DISTINCT ON (b.room_id)
                b.room_id,
                b.guest_name,
                b.check_out_date
            FROM bookings b
            WHERE b.tenant_id = ${tenantId}
              AND b.check_out_date = ${today}
            ORDER BY b.room_id, b.check_in_date DESC
        )
        SELECT 
            r.id,
            r.room_number,
            r.floor,
            r.room_type,
            r.cleaning_status,
            r.last_cleaning_update,
            r.status as room_status,
            r.do_not_disturb,
            r.assigned_cleaner_id,
            assigned_cleaner.name as assigned_cleaner_name,
            COALESCE(ab.guest_name, cb.guest_name, 'Vacant') as guest_name,
            cr.id as cleaning_request_id,
            cr.status as request_status,
            cr.request_type,
            cr.assigned_to,
            cr.started_at,
            cr.duration_seconds,
            assigned.name as assigned_to_name,
            assigned.role as assigned_to_role,
            -- Determine request type based on guest presence for dirty rooms
            CASE 
                WHEN cr.request_type IS NOT NULL THEN cr.request_type
                WHEN ab.room_id IS NOT NULL THEN 'stay_over'
                WHEN cb.room_id IS NOT NULL THEN 'checkout'
                WHEN r.cleaning_status = 'dirty' AND COALESCE(ab.guest_name, cb.guest_name, 'Vacant') != 'Vacant' THEN 'stay_over'
                WHEN r.cleaning_status = 'dirty' THEN 'checkout'
                ELSE NULL
            END as effective_type
        FROM rooms r
        LEFT JOIN active_bookings ab ON r.id = ab.room_id
        LEFT JOIN checkout_bookings cb ON r.id = cb.room_id
        LEFT JOIN cleaning_requests cr ON r.id = cr.room_id AND cr.status != 'completed'
        LEFT JOIN staff assigned ON cr.assigned_to = assigned.id
        LEFT JOIN staff assigned_cleaner ON r.assigned_cleaner_id = assigned_cleaner.id
        WHERE r.tenant_id = ${tenantId}
        ORDER BY r.floor, r.room_number
    `);

    return result.rows.map(row => ({
        ...row,
        guest_name: row.guest_name === 'Vacant' ? 'Vacant' : row.guest_name,
        request_type: row.effective_type
    }));
}

export async function getHousekeepingStaff(tenantId: string) {
    const result = await db.execute(sql`
        SELECT id, name, email, role, sub_role
        FROM staff
        WHERE tenant_id = ${tenantId}
            AND role IN ('housekeeping', 'head_housekeeping')
            AND active = true
        ORDER BY name
    `)
    return result.rows
}

// ============ CREATE OR UPDATE CLEANING REQUEST ============

export async function upsertCleaningRequest(roomId: string, requestedBy: string | null, requestType: string, notes?: string) {
    const roomCheck = await db.execute(sql`
        SELECT do_not_disturb FROM rooms WHERE id = ${roomId}
    `)
    if (roomCheck.rows.length > 0 && roomCheck.rows[0].do_not_disturb) {
        throw new Error('Room has Do Not Disturb active – cannot create cleaning request. Please remove DND first.')
    }

    const existing = await db.execute(sql`
        SELECT id, status, request_type 
        FROM cleaning_requests 
        WHERE room_id = ${roomId} AND status IN ('pending', 'assigned', 'in_progress')
        LIMIT 1
    `)

    if (existing.rows.length > 0) {
        const updated = await db.execute(sql`
            UPDATE cleaning_requests 
            SET request_type = ${requestType},
                notes = ${notes || null},
                requested_by = ${requestedBy},
                requested_at = NOW(),
                status = 'pending',
                assigned_to = NULL,
                assigned_at = NULL
            WHERE id = ${existing.rows[0].id}
            RETURNING *
        `)
        return updated.rows[0]
    } else {
        const result = await db.execute(sql`
            INSERT INTO cleaning_requests (room_id, requested_by, request_type, notes)
            VALUES (${roomId}, ${requestedBy}, ${requestType}, ${notes || null})
            RETURNING *
        `)
        return result.rows[0]
    }
}

// ============ AUTO-CREATE CHECKOUT REQUESTS & MARK DIRTY ============

export async function ensureCheckoutRequests(tenantId: string) {
    const today = new Date().toISOString().split('T')[0];
    
    await db.execute(sql`
        UPDATE rooms
        SET cleaning_status = 'dirty', last_cleaning_update = NOW()
        FROM bookings b
        WHERE rooms.id = b.room_id
          AND rooms.tenant_id = ${tenantId}
          AND b.check_out_date = ${today}
          AND rooms.cleaning_status NOT IN ('dirty', 'cleaning')
    `);
    
    const result = await db.execute(sql`
        INSERT INTO cleaning_requests (room_id, request_type, notes, status)
        SELECT r.id, 'checkout', 'Auto-created for checkout', 'pending'
        FROM rooms r
        JOIN bookings b ON r.id = b.room_id
        WHERE r.tenant_id = ${tenantId}
          AND b.check_out_date = ${today}
          AND (r.do_not_disturb IS NULL OR r.do_not_disturb = false)
          AND r.cleaning_status = 'dirty'
          AND NOT EXISTS (
              SELECT 1 FROM cleaning_requests cr 
              WHERE cr.room_id = r.id 
                AND cr.status != 'completed'
          )
        RETURNING room_id
    `);
    
    return { created: result.rows.length };
}

// ============ AUTO-CREATE CLEANING REQUESTS FOR ALL DIRTY ROOMS ============

export async function ensureCleaningRequestsForDirtyRooms(tenantId: string) {
    try {
        const result = await db.execute(sql`
            INSERT INTO cleaning_requests (room_id, request_type, notes, status)
            SELECT 
                r.id,
                CASE 
                    WHEN b.room_id IS NOT NULL THEN 'stay_over'
                    ELSE 'checkout'
                END as request_type,
                'Auto-created from dirty status',
                'pending'
            FROM rooms r
            LEFT JOIN bookings b ON r.id = b.room_id 
                AND b.check_in_date <= CURRENT_DATE 
                AND b.check_out_date >= CURRENT_DATE
            WHERE r.tenant_id = ${tenantId}
              AND r.cleaning_status = 'dirty'
              AND r.out_of_order = false
              AND NOT EXISTS (
                  SELECT 1 FROM cleaning_requests cr 
                  WHERE cr.room_id = r.id 
                    AND cr.status != 'completed'
              )
            RETURNING room_id
        `);
        
        return { created: result.rows.length };
    } catch (error: any) {
        // If error is about duplicate requests, that's fine - they already exist
        if (error.message?.includes('already exists') || error.code === 'P0001') {
            console.log('Cleaning requests already exist for dirty rooms');
            return { created: 0, message: 'Requests already exist' };
        }
        console.error('Error ensuring cleaning requests:', error);
        return { created: 0, error: error.message };
    }
}

// ============ ASSIGN CLEANING (FIXED - Updates rooms.assigned_cleaner_id) ============

export async function assignCleaning(requestId: string, assignedTo: string) {
    const reqCheck = await db.execute(sql`
        SELECT cr.id, cr.room_id, cr.request_type, r.do_not_disturb, r.tenant_id, r.room_number
        FROM cleaning_requests cr
        JOIN rooms r ON cr.room_id = r.id
        WHERE cr.id = ${requestId}
    `)
    if (reqCheck.rows.length === 0) throw new Error('Cleaning request not found')
    if (reqCheck.rows[0].do_not_disturb) {
        throw new Error('Cannot assign cleaning – Room has Do Not Disturb active. Ask staff to remove DND first.')
    }

    const roomId = reqCheck.rows[0].room_id
    const tenantId = reqCheck.rows[0].tenant_id
    const roomNumber = reqCheck.rows[0].room_number

    // Update cleaning request
    await db.execute(sql`
        UPDATE cleaning_requests 
        SET assigned_to = ${assignedTo}, 
            status = 'assigned',
            assigned_at = NOW()
        WHERE id = ${requestId}
    `)

    // CRITICAL FIX: Update rooms table with assigned cleaner
    await db.execute(sql`
        UPDATE rooms 
        SET assigned_cleaner_id = ${assignedTo}
        WHERE id = ${roomId}
    `)

    // Get assigned staff name for notification
    const staffInfo = await db.execute(sql`
        SELECT name FROM staff WHERE id = ${assignedTo}
    `)
    const staffName = staffInfo.rows[0]?.name || 'staff member'

    // Send notification to assigned cleaner
    await db.execute(sql`
        INSERT INTO notifications (staff_id, title, message, type, data, is_read)
        VALUES (${assignedTo}, '🧹 New Room Assignment', ${`You have been assigned to clean Room ${roomNumber}.`}, 'cleaning', ${JSON.stringify({ requestId, roomId, roomNumber })}, false)
    `)

    // Also send push notification if available
    try {
        await sendNotificationToTenant(
            tenantId,
            '🧹 New Cleaning Assignment',
            `${staffName} has been assigned to clean Room ${roomNumber}`,
            '/cleaning-icon.png',
            '/dashboard?tab=staff-rooms'
        );
    } catch (err) {
        console.error('Push notification failed:', err)
    }

    const updated = await db.execute(sql`
        SELECT 
            cr.*,
            assigned.name as assigned_to_name,
            r.room_number,
            r.assigned_cleaner_id
        FROM cleaning_requests cr
        LEFT JOIN staff assigned ON cr.assigned_to = assigned.id
        JOIN rooms r ON cr.room_id = r.id
        WHERE cr.id = ${requestId}
    `)
    return updated.rows[0]
}

// ============ UPDATE CLEANING REQUEST STATUS (with timer) ============

export async function updateCleaningRequestStatus(requestId: string, status: string, staffId: string) {
    const task = await db.execute(sql`
        SELECT cr.id, cr.status, cr.room_id, cr.started_at, r.room_number, r.tenant_id
        FROM cleaning_requests cr
        JOIN rooms r ON cr.room_id = r.id
        WHERE cr.id = ${requestId} AND cr.assigned_to = ${staffId}
    `);
    if (task.rows.length === 0) throw new Error('Task not found or not assigned to you');

    const currentStatus = task.rows[0].status;
    const roomId = task.rows[0].room_id;
    const roomNumber = task.rows[0].room_number;
    const tenantId = task.rows[0].tenant_id;

    if (status === 'accepted') {
        if (currentStatus !== 'pending') throw new Error('Task already accepted');
        await db.execute(sql`
            UPDATE cleaning_requests SET status = 'assigned' WHERE id = ${requestId}
        `);
    } else if (status === 'in_progress') {
        if (currentStatus !== 'assigned') throw new Error('Task not in assigned state');
        await db.execute(sql`
            UPDATE cleaning_requests 
            SET status = 'in_progress', 
                started_at = NOW() 
            WHERE id = ${requestId}
        `);
        await db.execute(sql`
            UPDATE rooms SET cleaning_status = 'cleaning' WHERE id = ${roomId}
        `);
    } else if (status === 'completed') {
        if (currentStatus !== 'in_progress') throw new Error('Task not in progress');
        const startedAt = task.rows[0].started_at;
        let durationSeconds = null;
        if (startedAt) {
            const durationQuery = await db.execute(sql`
                SELECT EXTRACT(EPOCH FROM (NOW() - ${startedAt})) as seconds
            `);
            durationSeconds = Math.round(parseFloat(durationQuery.rows[0].seconds));
        }
        await db.execute(sql`
            UPDATE cleaning_requests 
            SET status = 'completed', 
                completed_at = NOW(),
                duration_seconds = ${durationSeconds}
            WHERE id = ${requestId}
        `);
        await db.execute(sql`
            UPDATE rooms SET cleaning_status = 'ready' WHERE id = ${roomId}
        `);
        
        // Create inspection task for head
        const head = await db.execute(sql`
            SELECT id FROM staff 
            WHERE tenant_id = ${tenantId}
              AND role = 'head_housekeeping' AND active = true
            LIMIT 1
        `);
        if (head.rows.length) {
            await createTask(
                tenantId,
                `Inspect Room ${roomNumber}`,
                `Room ${roomNumber} is ready for inspection.`,
                staffId,
                head.rows[0].id,
                'medium'
            );
            await db.execute(sql`
                INSERT INTO notifications (staff_id, title, message, type, data, is_read)
                VALUES (${head.rows[0].id}, 'Room Ready for Inspection', ${`Room ${roomNumber} is now ready for your inspection.`}, 'inspection', ${JSON.stringify({ roomId, roomNumber })}, false)
            `);
        }
    } else {
        throw new Error('Invalid status');
    }
    return { success: true };
}

// ============ UPDATE ROOM CLEANING STATUS ============

export async function updateRoomCleaningStatus(roomId: string, cleaningStatus: string, staffId: string) {
    const allowed = ['dirty', 'cleaning', 'ready', 'inspected', 'awaiting']
    if (!allowed.includes(cleaningStatus)) throw new Error('Invalid status')

    const staffCheck = await db.execute(sql`
        SELECT role FROM staff WHERE id = ${staffId}
    `)
    if (staffCheck.rows.length === 0) throw new Error('Staff not found')
    const role = staffCheck.rows[0].role

    if (role === 'head_housekeeping') {
        if (!['dirty', 'inspected', 'awaiting'].includes(cleaningStatus)) {
            throw new Error('Head of housekeeping can only change status to dirty, inspected, or awaiting.')
        }
    } else if (role === 'housekeeping') {
        if (!['cleaning', 'ready'].includes(cleaningStatus)) {
            throw new Error('Cleaning staff can only change status to cleaning or ready.')
        }
    } else {
        throw new Error('Only housekeeping staff can update cleaning status')
    }

    const currentRoom = await db.execute(sql`
        SELECT cleaning_status, room_number, tenant_id FROM rooms WHERE id = ${roomId}
    `)
    if (currentRoom.rows.length === 0) throw new Error('Room not found')
    const previousStatus = currentRoom.rows[0].cleaning_status

    const result = await db.execute(sql`
        UPDATE rooms 
        SET cleaning_status = ${cleaningStatus},
            last_cleaning_update = NOW(),
            last_updated_by = ${staffId}
        WHERE id = ${roomId}
        RETURNING *
    `)

    if (cleaningStatus === 'dirty' && previousStatus !== 'dirty') {
        try {
            const occupancy = await db.execute(sql`
                SELECT EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.room_id = ${roomId}
                      AND b.check_in_date <= CURRENT_DATE
                      AND b.check_out_date > CURRENT_DATE
                ) as is_occupied
            `);
            const isOccupied = occupancy.rows[0]?.is_occupied || false;
            const requestType = isOccupied ? 'stay_over' : 'checkout';
            
            const existing = await db.execute(sql`
                SELECT id FROM cleaning_requests 
                WHERE room_id = ${roomId} AND status IN ('pending', 'assigned', 'in_progress')
                LIMIT 1
            `);
            if (existing.rows.length === 0) {
                await db.execute(sql`
                    INSERT INTO cleaning_requests (room_id, requested_by, request_type, notes, status)
                    VALUES (${roomId}, ${staffId}, ${requestType}, 'Auto-created from dirty status', 'pending')
                `);
            }

            const roomNumber = currentRoom.rows[0].room_number;
            const tenantId = currentRoom.rows[0].tenant_id;
            const typeLabel = requestType === 'stay_over' ? 'In‑House (Stay‑Over)' : 'Checkout';
            await notifyAllHousekeepingStaff(
                tenantId,
                `🧹 Room ${roomNumber} Needs Cleaning`,
                `Room ${roomNumber} is now dirty and requires ${typeLabel} cleaning.`,
                'cleaning',
                { roomId, roomNumber, requestType }
            );
        } catch (err) {
            console.error('Failed to auto-create cleaning request or notify staff:', err);
        }
    }

    return result.rows[0]
}

// ============ COMPLETE CLEANING (for staff from other UI) ============

export async function completeCleaning(requestId: string, completedBy: string) {
    const req = await db.execute(sql`
        SELECT room_id FROM cleaning_requests WHERE id = ${requestId}
    `)
    if (req.rows.length === 0) throw new Error('Request not found')
    const roomId = req.rows[0].room_id

    const currentRoom = await db.execute(sql`
        SELECT cleaning_status, room_number, tenant_id FROM rooms WHERE id = ${roomId}
    `)
    if (currentRoom.rows.length === 0) throw new Error('Room not found')

    await db.execute(sql`
        UPDATE cleaning_requests 
        SET status = 'completed', completed_at = NOW(), completed_by = ${completedBy}
        WHERE id = ${requestId}
    `)
    
    // Update room status to ready if not already
    if (currentRoom.rows[0].cleaning_status !== 'ready' && currentRoom.rows[0].cleaning_status !== 'inspected') {
        await db.execute(sql`
            UPDATE rooms SET cleaning_status = 'ready' WHERE id = ${roomId}
        `)
    }

    return { success: true }
}

// ============ DO NOT DISTURB ============

export async function updateDoNotDisturb(roomId: string, doNotDisturb: boolean, staffName: string) {
    await db.execute(sql`
        UPDATE rooms SET do_not_disturb = ${doNotDisturb} WHERE id = ${roomId}
    `)
    if (doNotDisturb) {
        await db.execute(sql`
            UPDATE cleaning_requests 
            SET status = 'cancelled', 
                notes = CONCAT(COALESCE(notes, ''), ' - DND activated by ${staffName}')
            WHERE room_id = ${roomId} AND status IN ('pending', 'assigned', 'in_progress')
        `)
        const roomNumber = await db.execute(sql`
            SELECT room_number FROM rooms WHERE id = ${roomId}
        `)
        if (roomNumber.rows.length) {
            await db.execute(sql`
                UPDATE tasks 
                SET status = 'cancelled', 
                    description = CONCAT(description, ' - DND activated')
                WHERE title = ${`Inspect Room ${roomNumber.rows[0].room_number}`}
                  AND status IN ('pending', 'in_progress')
            `)
        }
    }
    return { success: true, doNotDisturb }
}

// ============ DAILY STATS ============

export async function getDailyStats(tenantId: string) {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.execute(sql`
        SELECT 
            (SELECT COUNT(*) FROM bookings WHERE tenant_id = ${tenantId} AND check_in_date = ${today}) as arrivals,
            (SELECT COUNT(*) FROM bookings WHERE tenant_id = ${tenantId} AND check_out_date = ${today}) as departures,
            (SELECT COUNT(*) FROM rooms WHERE tenant_id = ${tenantId} AND cleaning_status = 'dirty') as dirty,
            (SELECT COUNT(*) FROM rooms WHERE tenant_id = ${tenantId} AND cleaning_status = 'ready') as ready
    `);
    return result.rows[0];
}

// ============ RELEASE ROOM (cleaner gives up assignment) ============

export async function releaseRoom(roomId: string, staffId: string) {
    // Verify this cleaner is assigned to this room
    const roomCheck = await db.execute(sql`
        SELECT assigned_cleaner_id, room_number FROM rooms WHERE id = ${roomId}
    `)
    if (roomCheck.rows.length === 0) throw new Error('Room not found')
    if (roomCheck.rows[0].assigned_cleaner_id !== staffId) {
        throw new Error('You are not assigned to this room')
    }

    // Clear assignment from room
    await db.execute(sql`
        UPDATE rooms SET assigned_cleaner_id = NULL WHERE id = ${roomId}
    `)

    // Update cleaning request back to pending
    await db.execute(sql`
        UPDATE cleaning_requests 
        SET assigned_to = NULL, status = 'pending'
        WHERE room_id = ${roomId} AND status IN ('assigned', 'in_progress')
    `)

    return { success: true }
}

// ============ REASSIGN ROOM (head of housekeeping) ============

export async function reassignRoom(roomId: string, newStaffId: string, reassignedBy: string) {
    // Verify new staff exists and is housekeeping
    const newStaff = await db.execute(sql`
        SELECT id, role, name FROM staff WHERE id = ${newStaffId} AND active = true
    `)
    if (newStaff.rows.length === 0) throw new Error('Staff not found')
    if (!['housekeeping', 'head_housekeeping'].includes(newStaff.rows[0].role)) {
        throw new Error('Can only reassign to housekeeping staff')
    }

    // Get room info
    const roomInfo = await db.execute(sql`
        SELECT room_number, tenant_id FROM rooms WHERE id = ${roomId}
    `)
    if (roomInfo.rows.length === 0) throw new Error('Room not found')
    const roomNumber = roomInfo.rows[0].room_number
    const tenantId = roomInfo.rows[0].tenant_id

    // Update room assignment
    await db.execute(sql`
        UPDATE rooms SET assigned_cleaner_id = ${newStaffId} WHERE id = ${roomId}
    `)

    // Update cleaning request
    await db.execute(sql`
        UPDATE cleaning_requests 
        SET assigned_to = ${newStaffId}, status = 'assigned'
        WHERE room_id = ${roomId} AND status IN ('pending', 'assigned', 'in_progress')
    `)

    // Notify new cleaner
    await db.execute(sql`
        INSERT INTO notifications (staff_id, title, message, type, data, is_read)
        VALUES (${newStaffId}, '🔄 Room Reassigned', ${`Room ${roomNumber} has been reassigned to you.`}, 'cleaning', ${JSON.stringify({ roomId, roomNumber })}, false)
    `)

    return { success: true }
}

// ============ OUT OF ORDER MANAGEMENT ============

export async function setRoomOutOfOrder(
  roomId: string, 
  reason: string, 
  setByStaffId: string
) {
  // Verify staff has permission (head_housekeeping or admin)
  const staffCheck = await db.execute(sql`
    SELECT role FROM staff WHERE id = ${setByStaffId}
  `)
  if (staffCheck.rows.length === 0) throw new Error('Staff not found')
  const role = staffCheck.rows[0].role
  
  if (!['head_housekeeping', 'admin', 'manager'].includes(role)) {
    throw new Error('Only Head of Housekeeping, Admin, or Manager can mark rooms out of order')
  }

  // Get room info
  const roomInfo = await db.execute(sql`
    SELECT room_number, tenant_id FROM rooms WHERE id = ${roomId}
  `)
  if (roomInfo.rows.length === 0) throw new Error('Room not found')
  const roomNumber = roomInfo.rows[0].room_number
  const tenantId = roomInfo.rows[0].tenant_id

  // Update room to out of order
  await db.execute(sql`
    UPDATE rooms 
    SET out_of_order = true,
        out_of_order_reason = ${reason},
        out_of_order_since = NOW(),
        out_of_order_set_by = ${setByStaffId},
        cleaning_status = 'awaiting'
    WHERE id = ${roomId}
  `)

  // Cancel any pending cleaning requests
  await db.execute(sql`
    UPDATE cleaning_requests 
    SET status = 'cancelled', 
        notes = CONCAT(COALESCE(notes, ''), ' - Room marked out of order')
    WHERE room_id = ${roomId} AND status IN ('pending', 'assigned', 'in_progress')
  `)

  // Clear assigned cleaner
  await db.execute(sql`
    UPDATE rooms SET assigned_cleaner_id = NULL WHERE id = ${roomId}
  `)

  // Notify all housekeeping staff
  await db.execute(sql`
    INSERT INTO notifications (staff_id, title, message, type, data, is_read)
    SELECT id, '🚫 Room Out of Order', ${`Room ${roomNumber} has been marked OUT OF ORDER. Reason: ${reason}`}, 'alert', ${JSON.stringify({ roomId, roomNumber, reason })}, false
    FROM staff
    WHERE tenant_id = ${tenantId} AND role IN ('housekeeping', 'head_housekeeping', 'admin', 'manager') AND active = true
  `)

  return { success: true, roomId, outOfOrder: true, reason }
}

export async function removeRoomOutOfOrder(
  roomId: string, 
  removedByStaffId: string
) {
  // Verify staff has permission
  const staffCheck = await db.execute(sql`
    SELECT role FROM staff WHERE id = ${removedByStaffId}
  `)
  if (staffCheck.rows.length === 0) throw new Error('Staff not found')
  const role = staffCheck.rows[0].role
  
  if (!['head_housekeeping', 'admin', 'manager'].includes(role)) {
    throw new Error('Only Head of Housekeeping, Admin, or Manager can remove out of order status')
  }

  // Get room info
  const roomInfo = await db.execute(sql`
    SELECT room_number, tenant_id FROM rooms WHERE id = ${roomId}
  `)
  if (roomInfo.rows.length === 0) throw new Error('Room not found')
  const roomNumber = roomInfo.rows[0].room_number
  const tenantId = roomInfo.rows[0].tenant_id

  // Update room to available
  await db.execute(sql`
    UPDATE rooms 
    SET out_of_order = false,
        out_of_order_reason = NULL,
        out_of_order_since = NULL,
        out_of_order_set_by = NULL,
        cleaning_status = 'dirty'
    WHERE id = ${roomId}
  `)

  // Auto-create cleaning request
  await db.execute(sql`
    INSERT INTO cleaning_requests (room_id, requested_by, request_type, notes, status)
    VALUES (${roomId}, ${removedByStaffId}, 'checkout', 'Room back in service - needs cleaning', 'pending')
  `)

  // Notify all housekeeping staff
  await db.execute(sql`
    INSERT INTO notifications (staff_id, title, message, type, data, is_read)
    SELECT id, '✅ Room Back in Service', ${`Room ${roomNumber} is now back IN SERVICE and needs cleaning.`}, 'info', ${JSON.stringify({ roomId, roomNumber })}, false
    FROM staff
    WHERE tenant_id = ${tenantId} AND role IN ('housekeeping', 'head_housekeeping', 'admin', 'manager') AND active = true
  `)

  return { success: true, roomId, outOfOrder: false }
}

export async function getOutOfOrderRooms(tenantId: string) {
  const result = await db.execute(sql`
    SELECT 
      r.id,
      r.room_number,
      r.floor,
      r.room_type,
      r.out_of_order_reason,
      r.out_of_order_since,
      s.name as set_by_name,
      r.cleaning_status
    FROM rooms r
    LEFT JOIN staff s ON r.out_of_order_set_by = s.id
    WHERE r.tenant_id = ${tenantId}
      AND r.out_of_order = true
    ORDER BY r.out_of_order_since DESC
  `)
  return result.rows
}