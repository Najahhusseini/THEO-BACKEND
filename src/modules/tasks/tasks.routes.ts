import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { createTask, getTasksForTenant, updateTaskStatus, getMentionsForTask } from './tasks.service'

const tasks = new Hono()

// Create a new task
tasks.post('/', async (c) => {
    const user = c.get('user')
    const { title, description, assignedTo, priority, dueDate, mentions } = await c.req.json()
    const task = await createTask(
        user.tenantId,
        title,
        description,
        user.staffId,
        assignedTo,
        priority,
        dueDate ? new Date(dueDate) : undefined,
        mentions
    )
    return c.json(task)
})

// Get all tasks for tenant
tasks.get('/', async (c) => {
    const user = c.get('user')
    let assignedTo = c.req.query('assignedTo')
    const status = c.req.query('status')
    
    if (assignedTo === 'me') {
        assignedTo = user.staffId
    }
    if (assignedTo === 'all' || assignedTo === '') {
        assignedTo = undefined
    }
    
    const tasksList = await getTasksForTenant(user.tenantId, { assignedTo, status, currentStaffId: user.staffId })
    return c.json(tasksList)
})

// Update task status – with auto‑return for maintenance tasks
tasks.patch('/:taskId/status', async (c) => {
    const user = c.get('user')
    const { taskId } = c.req.param()
    const { status } = await c.req.json()

    // First, update the task status
    const task = await updateTaskStatus(taskId, status, user.staffId)

    // ✅ NEW: Auto‑return room from maintenance if task completed and has room_id
    if (status === 'completed' && task && task.room_id) {
        // Check if the room is currently out of order
        const roomCheck = await db.execute(sql`
            SELECT out_of_order FROM rooms WHERE id = ${task.room_id}
        `)
        if (roomCheck.rows[0]?.out_of_order === true) {
            // Return room to service: remove OOO flag, set status to dirty, create cleaning request
            await db.transaction(async (tx) => {
                await tx.execute(sql`
                    UPDATE rooms 
                    SET out_of_order = false, 
                        out_of_order_reason = NULL, 
                        out_of_order_since = NULL,
                        status = 'dirty',
                        last_status_change = NOW()
                    WHERE id = ${task.room_id}
                `)
                // Create a cleaning request for this room
                await tx.execute(sql`
                    INSERT INTO cleaning_requests (room_id, status, priority, requested_by, created_at)
                    VALUES (${task.room_id}, 'pending', 'high', ${user.staffId}, NOW())
                `)
            })
            console.log(`🔧 Room ${task.room_id} returned to service after maintenance task ${taskId}`)
        }
    }

    return c.json(task)
})

// Get mentions for a task
tasks.get('/:taskId/mentions', async (c) => {
    const { taskId } = c.req.param()
    const mentions = await getMentionsForTask(taskId)
    return c.json(mentions)
})

// Complete inspection task (marks task done AND updates room status to inspected)
tasks.patch('/:taskId/inspect-complete', async (c) => {
    try {
        const user = c.get('user')
        const { taskId } = c.req.param()
        
        const task = await db.execute(sql`
            SELECT * FROM tasks WHERE id = ${taskId} AND assigned_to = ${user.staffId}
        `)
        if (task.rows.length === 0) {
            return c.json({ error: 'Task not found or not assigned to you' }, 404)
        }
        
        const match = task.rows[0].title.match(/Inspect Room (\d+)/)
        if (match) {
            const roomNumber = match[1]
            await db.execute(sql`
                UPDATE rooms SET cleaning_status = 'inspected' 
                WHERE room_number = ${roomNumber} AND tenant_id = ${user.tenantId}
            `)
        }
        
        await db.execute(sql`
            UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = ${taskId}
        `)
        
        return c.json({ success: true, message: 'Inspection completed' })
    } catch (error) {
        console.error('Error completing inspection:', error)
        return c.json({ error: 'Failed to complete inspection' }, 500)
    }
})

export default tasks