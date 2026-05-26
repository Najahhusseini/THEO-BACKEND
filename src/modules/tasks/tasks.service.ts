import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { sendNotificationToTenant } from '../notifications/notification.service'

export async function createTask(
    tenantId: string,
    title: string,
    description: string,
    createdBy: string,
    assignedTo?: string,
    priority?: string,
    dueDate?: Date,
    mentions?: string[]
) {
    // Use transaction to ensure atomic creation
    const result = await db.transaction(async (tx) => {
        const insertResult = await tx.execute(sql`
            INSERT INTO tasks (tenant_id, title, description, created_by_staff_id, assigned_to_staff_id, priority, due_at, status)
            VALUES (${tenantId}, ${title}, ${description}, ${createdBy}, ${assignedTo || null}, ${priority || 'normal'}, ${dueDate || null}, 'pending')
            RETURNING *
        `)
        const task = insertResult.rows[0]

        if (mentions && mentions.length > 0) {
            for (const staffId of mentions) {
                await tx.execute(sql`
                    INSERT INTO task_mentions (task_id, staff_id)
                    VALUES (${task.id}, ${staffId})
                `)
                await sendNotificationToTenant(
                    tenantId,
                    '📋 You were mentioned in a task',
                    `${title}`,
                    '/task-icon.png',
                    `/dashboard?tab=tasks&taskId=${task.id}`
                )
            }
        }

        if (assignedTo) {
            await sendNotificationToTenant(
                tenantId,
                '✅ New task assigned to you',
                `${title}`,
                '/task-icon.png',
                `/dashboard?tab=tasks&taskId=${task.id}`
            )
        }
        return task
    })
    return result
}

export async function getTasksForTenant(tenantId: string, filters?: { assignedTo?: string; status?: string; currentStaffId?: string }) {
    let query = sql`
        SELECT t.*, 
               creator.name as created_by_name,
               assignee.name as assigned_to_name,
               assignee.role as assigned_to_role
        FROM tasks t
        LEFT JOIN staff creator ON t.created_by_staff_id = creator.id
        LEFT JOIN staff assignee ON t.assigned_to_staff_id = assignee.id
        WHERE t.tenant_id = ${tenantId}
    `
    if (filters?.assignedTo) {
        if (filters.assignedTo === 'me' && filters.currentStaffId) {
            query = sql`${query} AND t.assigned_to_staff_id = ${filters.currentStaffId}`
        } else if (filters.assignedTo !== 'all' && filters.assignedTo !== 'me') {
            query = sql`${query} AND t.assigned_to_staff_id = ${filters.assignedTo}`
        }
    }
    if (filters?.status && filters.status !== 'all') {
        query = sql`${query} AND t.status = ${filters.status}`
    }
    query = sql`${query} ORDER BY t.created_at DESC`
    const result = await db.execute(query)
    return result.rows
}

// Hardened update with transaction and optional room auto‑return
export async function updateTaskStatus(taskId: string, newStatus: string, staffId: string): Promise<any> {
    return await db.transaction(async (tx) => {
        // Lock the task row
        const taskResult = await tx.execute(sql`
            SELECT * FROM tasks WHERE id = ${taskId} FOR UPDATE
        `)
        if (taskResult.rows.length === 0) throw new Error('Task not found')
        const task = taskResult.rows[0]

        // Validate status transition (prevent completed -> pending, etc.)
        const allowedTransitions: Record<string, string[]> = {
            pending: ['in_progress', 'cancelled'],
            in_progress: ['completed', 'cancelled'],
            completed: [],
            cancelled: [],
            escalated: ['in_progress', 'completed']
        }
        if (!allowedTransitions[task.status]?.includes(newStatus)) {
            throw new Error(`Invalid status transition from ${task.status} to ${newStatus}`)
        }

        // Update task
        const updateResult = await tx.execute(sql`
            UPDATE tasks
            SET status = ${newStatus}, updated_at = NOW(),
                completed_at = CASE WHEN ${newStatus} = 'completed' THEN NOW() ELSE completed_at END
            WHERE id = ${taskId}
            RETURNING *
        `)
        const updatedTask = updateResult.rows[0]

        // If task completed and has a roomId, attempt to auto‑return from OOO
        if (newStatus === 'completed' && task.room_id) {
            const roomResult = await tx.execute(sql`
                SELECT out_of_order FROM rooms WHERE id = ${task.room_id} FOR UPDATE
            `)
            if (roomResult.rows.length > 0 && roomResult.rows[0].out_of_order) {
                await tx.execute(sql`
                    UPDATE rooms 
                    SET out_of_order = false, 
                        out_of_order_reason = NULL, 
                        status = 'dirty',
                        last_status_change = NOW()
                    WHERE id = ${task.room_id}
                `)
                // Create cleaning request
                await tx.execute(sql`
                    INSERT INTO cleaning_requests (room_id, status, priority, requested_by, created_at)
                    VALUES (${task.room_id}, 'pending', 'high', ${staffId}, NOW())
                    ON CONFLICT (room_id, status) DO NOTHING
                `)
            }
        }

        return updatedTask
    })
}

export async function getMentionsForTask(taskId: string) {
    const result = await db.execute(sql`
        SELECT s.name, s.email
        FROM task_mentions tm
        JOIN staff s ON tm.staff_id = s.id
        WHERE tm.task_id = ${taskId}
    `)
    return result.rows
}