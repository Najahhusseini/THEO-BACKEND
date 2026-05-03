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
    
    // Handle "me" filter – convert to actual staff ID
    if (assignedTo === 'me') {
        assignedTo = user.staffId
    }
    // If assignedTo is 'all' or empty, pass undefined to service (no filter)
    if (assignedTo === 'all' || assignedTo === '') {
        assignedTo = undefined
    }
    
    const tasksList = await getTasksForTenant(user.tenantId, { assignedTo, status, currentStaffId: user.staffId })
    return c.json(tasksList)
})

// Update task status
tasks.patch('/:taskId/status', async (c) => {
    const user = c.get('user')
    const { taskId } = c.req.param()
    const { status } = await c.req.json()
    const task = await updateTaskStatus(taskId, status, user.staffId)
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
        
        // Get task details and verify it's assigned to current user
        const task = await db.execute(sql`
            SELECT * FROM tasks WHERE id = ${taskId} AND assigned_to = ${user.staffId}
        `)
        if (task.rows.length === 0) {
            return c.json({ error: 'Task not found or not assigned to you' }, 404)
        }
        
        // Extract room number from title (format: "Inspect Room 103")
        const match = task.rows[0].title.match(/Inspect Room (\d+)/)
        if (match) {
            const roomNumber = match[1]
            // Update room status to inspected
            await db.execute(sql`
                UPDATE rooms SET cleaning_status = 'inspected' 
                WHERE room_number = ${roomNumber} AND tenant_id = ${user.tenantId}
            `)
        }
        
        // Mark task as completed
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