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
    const result = await db.execute(sql`
        INSERT INTO tasks (tenant_id, title, description, created_by_staff_id, assigned_to_staff_id, priority, due_at, status)
        VALUES (${tenantId}, ${title}, ${description}, ${createdBy}, ${assignedTo || null}, ${priority || 'normal'}, ${dueDate || null}, 'pending')
        RETURNING *
    `)
    const task = result.rows[0]

    if (mentions && mentions.length > 0) {
        for (const staffId of mentions) {
            await db.execute(sql`
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

export async function updateTaskStatus(taskId: string, status: string, staffId: string) {
    const result = await db.execute(sql`
        UPDATE tasks
        SET status = ${status}, updated_at = NOW(),
            completed_at = CASE WHEN ${status} = 'completed' THEN NOW() ELSE completed_at END
        WHERE id = ${taskId}
        RETURNING *
    `)
    return result.rows[0]
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