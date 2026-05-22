import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { eventBus } from '../../events/eventBus'

// Get all rooms that need maintenance (out of order)
export async function getMaintenanceRooms(tenantId: string) {
  const result = await db.execute(sql`
    SELECT 
      r.id,
      r.room_number,
      r.floor,
      r.room_type,
      r.out_of_order_reason,
      r.out_of_order_since,
      r.cleaning_status,
      t.id as task_id,
      t.status as task_status,
      t.priority as task_priority,
      t.assigned_to_staff_id,
      t.title as task_title,
      t.description as task_description,
      assigned.name as assigned_to_name,
      reporter.name as created_by_name
    FROM rooms r
    LEFT JOIN tasks t ON t.room_id = r.id 
      AND t.status IN ('pending', 'in_progress')
      AND t.title LIKE 'Maintenance:%'
    LEFT JOIN staff assigned ON t.assigned_to_staff_id = assigned.id
    LEFT JOIN staff reporter ON t.created_by_staff_id = reporter.id
    WHERE r.tenant_id = ${tenantId}
      AND r.out_of_order = true
    ORDER BY r.out_of_order_since DESC
  `)
  return result.rows
}

// Create a maintenance task when a room is marked out of order
export async function createMaintenanceTask(
  roomId: string,
  roomNumber: string,
  reason: string,
  tenantId: string,
  reportedByStaffId: string
) {
  const taskResult = await db.execute(sql`
    INSERT INTO tasks (tenant_id, title, description, status, priority, room_id, created_by_staff_id)
    VALUES (
      ${tenantId},
      ${`Maintenance: Room ${roomNumber}`},
      ${reason},
      'pending',
      'medium',
      ${roomId},
      ${reportedByStaffId}
    )
    RETURNING id
  `)
  return taskResult.rows[0]
}

// Assign a maintenance task to a staff member
export async function assignMaintenanceTask(taskId: string, staffId: string) {
  await db.execute(sql`
    UPDATE tasks 
    SET assigned_to_staff_id = ${staffId}, status = 'assigned', updated_at = NOW()
    WHERE id = ${taskId}
  `)
}

// Update task status (start / complete)
export async function updateMaintenanceTaskStatus(taskId: string, status: string, staffId: string) {
  if (status === 'in_progress') {
    await db.execute(sql`
      UPDATE tasks SET status = 'in_progress', updated_at = NOW()
      WHERE id = ${taskId} AND assigned_to_staff_id = ${staffId}
    `)
  } else if (status === 'completed') {
    await db.execute(sql`
      UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE id = ${taskId} AND assigned_to_staff_id = ${staffId}
    `)
  } else {
    throw new Error('Invalid status')
  }
}

// Return room to housekeeping after repair
export async function returnRoomToHousekeeping(roomId: string, staffId: string) {
  // Get room info
  const room = await db.execute(sql`
    SELECT room_number, tenant_id FROM rooms WHERE id = ${roomId}
  `)
  if (room.rows.length === 0) throw new Error('Room not found')

  // Set room back to available (dirty, needs cleaning)
  await db.execute(sql`
    UPDATE rooms 
    SET out_of_order = false,
        out_of_order_reason = NULL,
        out_of_order_since = NULL,
        out_of_order_set_by = NULL,
        cleaning_status = 'dirty'
    WHERE id = ${roomId}
  `)

  // Create a cleaning request
  const existing = await db.execute(sql`
    SELECT id FROM cleaning_requests
    WHERE room_id = ${roomId}
      AND status IN ('pending','assigned','in_progress')
  `)
  if (existing.rows.length === 0) {
    await db.execute(sql`
      INSERT INTO cleaning_requests (room_id, requested_by, request_type, notes, status)
      VALUES (${roomId}, ${staffId}, 'checkout', 'Room back in service after maintenance', 'pending')
    `)
  }

  // Emit event
  eventBus.emit(room.rows[0].tenant_id, 'room.back_in_service', {
    tenantId: room.rows[0].tenant_id,
    roomId,
    roomNumber: room.rows[0].room_number,
    staffId,
  })

  return { success: true }
}