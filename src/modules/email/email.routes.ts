import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { getEmails, updateEmailParsedData, markEmailProcessed, storeEmail } from './email.service'
import { z } from 'zod'

const emailRouter = new Hono()

// Get all emails (with optional status filter)
emailRouter.get('/', async (c) => {
    const user = c.get('user')
    if (!['admin', 'manager', 'reservation_manager'].includes(user?.role)) {
        return c.json({ error: 'Unauthorized' }, 403)
    }
    const status = c.req.query('status')
    const emails = await getEmails(status)
    return c.json(emails)
})

// Manually add a test email (useful for development)
emailRouter.post('/', async (c) => {
    const user = c.get('user')
    if (!['admin', 'manager', 'reservation_manager'].includes(user?.role)) {
        return c.json({ error: 'Unauthorized' }, 403)
    }
    const { sender, subject, body } = await c.req.json()
    const result = await storeEmail(sender, subject, body)
    return c.json(result, 201)
})

// Update parsed data for an email
emailRouter.put('/:id/parsed', async (c) => {
    const user = c.get('user')
    if (!['admin', 'manager', 'reservation_manager'].includes(user?.role)) {
        return c.json({ error: 'Unauthorized' }, 403)
    }
    const { id } = c.req.param()
    const parsedData = await c.req.json()
    await updateEmailParsedData(id, parsedData)
    return c.json({ success: true })
})

// Mark email as processed and optionally create a reservation
emailRouter.post('/:id/process', async (c) => {
    const user = c.get('user')
    if (!['admin', 'manager', 'reservation_manager'].includes(user?.role)) {
        return c.json({ error: 'Unauthorized' }, 403)
    }
    const { id } = c.req.param()
    const { createReservation, reservationData } = await c.req.json()

    const result = await markEmailProcessed(id, createReservation, reservationData)

    // ✨ Create notification for reservation manager when a reservation is created
    if (createReservation && result && result.id) {
        await db.execute(sql`
            INSERT INTO notifications (id, tenant_id, staff_id, type, title, message, reference_type, reference_id, created_at, updated_at)
            VALUES (
                gen_random_uuid(),
                ${user.tenantId},
                NULL,
                'new_reservation',
                'New Email Reservation',
                ${`Reservation for ${result.guest_name || 'guest'} created from email`},
                'reservation',
                ${result.id},
                NOW(),
                NOW()
            )
        `)
    }

    return c.json(result)
})

export default emailRouter